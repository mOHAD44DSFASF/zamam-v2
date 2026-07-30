import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { projectProjectFields } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  ProjectService,
  buildProjectListQuery,
  type ProjectAuthorizationGate,
  type ProjectCommandMetadata,
  type ProjectLifecyclePort,
} from '../services/functions/src/project/service'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult> {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    // Enforces Firestore's "all reads before all writes" rule so an interleaved get-after-write in a
    // service transaction is caught here instead of only against the real emulator.
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => {
        if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: read of "${path}" after a write`)
        return working.get(path) ?? null
      },
      create: (path, data) => {
        writeStarted = true
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        writeStarted = true
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}

class Gate implements ProjectAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
    if (principal.organizationId !== request.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  }
}

function lifecycle(workspaces = 0, tasks = 0): ProjectLifecyclePort {
  return {
    activeWorkspaceCount: async () => workspaces,
    openTaskCount: async () => tasks,
  }
}

const principal: AuthorizationPrincipal = {
  userId: 'manager-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): ProjectCommandMetadata => {
  sequence += 1
  return {
    organizationId: 'org-1', principal, correlationId: `correlation-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
  }
}

function seedDependencies(store: MemoryStore) {
  store.records.set('v2Organizations/org-1/client/client-1', {
    organizationId: 'org-1', version: 1, status: 'active', name: 'Client', code: 'CLIENT',
  })
  store.records.set('v2Organizations/org-1/department/dep-1', {
    organizationId: 'org-1', version: 1, status: 'active', name: 'Department', code: 'DEP',
  })
  for (const userId of ['manager-1', 'member-1']) {
    store.records.set(`v2Organizations/org-1/employment_profile/${userId}`, {
      organizationId: 'org-1', version: 1, status: 'active', userId,
    })
  }
}

async function createProject(service: ProjectService) {
  return service.create(metadata(), {
    id: 'project-1', clientId: 'client-1', name: 'الموقع الجديد', code: 'web-1',
    departmentId: 'dep-1', managerUserId: 'manager-1',
    startsOn: '2026-08-01', dueOn: '2026-10-01', clientVisible: false,
  })
}

describe('project lifecycle', () => {
  it('creates scoped projects with validated references, unique code, and client counter', async () => {
    const store = new MemoryStore()
    seedDependencies(store)
    const gate = new Gate()
    const service = new ProjectService(store, gate, lifecycle())
    await createProject(service)
    expect(store.records.get('v2Organizations/org-1/project/project-1')).toMatchObject({
      clientId: 'client-1', code: 'WEB-1', status: 'draft', clientVisible: false, version: 1,
    })
    expect(store.records.get('v2Organizations/org-1/_clientActiveProjectCounts/client-1')).toMatchObject({ value: 1 })
    expect(gate.requests[0]).toMatchObject({ permission: 'project.create', organizationId: 'org-1' })
  })

  it('enforces status transitions and audited reopen with a reason', async () => {
    const store = new MemoryStore()
    seedDependencies(store)
    const service = new ProjectService(store, new Gate(), lifecycle())
    await createProject(service)
    await service.transition(metadata(), 'project-1', 1, 'planned')
    await service.transition(metadata(), 'project-1', 2, 'active')
    await service.transition(metadata(), 'project-1', 3, 'completed')
    await expect(service.transition(metadata(), 'project-1', 4, 'planned')).rejects.toThrow('INVALID_PROJECT_STATUS_TRANSITION')
    await service.reopen(metadata(), 'project-1', 4, 'إعادة فتح موثقة لإكمال نطاق إضافي')
    expect(store.records.get('v2Organizations/org-1/project/project-1')).toMatchObject({ status: 'active', version: 5 })
  })

  it('adds active internal members and only viewer portal users from the same client', async () => {
    const store = new MemoryStore()
    seedDependencies(store)
    const service = new ProjectService(store, new Gate(), lifecycle())
    await createProject(service)
    const internal = await service.addMember(metadata(), {
      projectId: 'project-1', principalId: 'member-1', principalType: 'member', access: 'contributor',
    })
    store.records.set('v2Organizations/org-1/client_contact/contact-1', {
      organizationId: 'org-1', version: 1, clientId: 'client-1', portalStatus: 'active', userId: 'portal-user',
    })
    await expect(service.addMember(metadata(), {
      projectId: 'project-1', principalId: 'contact-1', principalType: 'client', access: 'contributor',
    })).rejects.toThrow('CLIENT_PROJECT_ACCESS_EXCESSIVE')
    const portal = await service.addMember(metadata(), {
      projectId: 'project-1', principalId: 'contact-1', principalType: 'client', access: 'viewer',
    })
    expect(store.records.get(`v2Organizations/org-1/project_member/${internal.result.memberId}`)).toMatchObject({
      userId: 'member-1', access: 'contributor', principalType: 'member',
    })
    expect(store.records.get(`v2Organizations/org-1/project_member/${portal.result.memberId}`)).toMatchObject({
      userId: 'portal-user', contactId: 'contact-1', access: 'viewer', principalType: 'client',
    })
  })

  it('stores financial data separately and requires its dedicated permission', async () => {
    const store = new MemoryStore()
    seedDependencies(store)
    const gate = new Gate()
    const service = new ProjectService(store, gate, lifecycle())
    await createProject(service)
    await service.updateFinancials(metadata(), {
      projectId: 'project-1', currency: 'EGP', budgetMinor: 500_000,
      billingModel: 'fixed', status: 'approved', expectedVersion: 0,
    })
    expect(store.records.get('v2Organizations/org-1/project/project-1')).not.toHaveProperty('budgetMinor')
    expect(store.records.get('v2Organizations/org-1/project_financials/project-1')).toMatchObject({
      currency: 'EGP', budgetMinor: 500_000, status: 'approved',
    })
    expect(gate.requests.at(-1)?.permission).toBe('project.financial.manage')
  })

  it('requires explicit publication and strips internal/financial fields from client projection', () => {
    const source = {
      id: 'project-1', clientId: 'client-1', name: 'الموقع', code: 'WEB',
      status: 'active', clientVisible: false, managerUserId: 'manager-1', departmentId: 'dep-1',
      financial: { budgetMinor: 500_000 },
    }
    expect(() => projectProjectFields(source, 'client')).toThrow('PROJECT_NOT_CLIENT_VISIBLE')
    const visible = projectProjectFields({ ...source, clientVisible: true }, 'client')
    expect(visible).not.toHaveProperty('managerUserId')
    expect(visible).not.toHaveProperty('financial')
    expect(projectProjectFields({ ...source, clientVisible: true }, 'financial')).toHaveProperty('financial')
  })

  it('builds bounded tenant and client scoped query plans', () => {
    expect(buildProjectListQuery({
      organizationId: 'org-1', viewer: 'client', clientId: 'client-1', limit: 25,
    })).toMatchObject({
      organizationId: 'org-1', entityKind: 'project', limit: 25,
      filters: [
        { field: 'clientId', operator: '==', value: 'client-1' },
        { field: 'clientVisible', operator: '==', value: true },
      ],
    })
    expect(() => buildProjectListQuery({ organizationId: 'org-1', viewer: 'client' })).toThrow('CLIENT_SCOPE_REQUIRED')
    expect(() => buildProjectListQuery({ organizationId: 'org-1', viewer: 'internal', limit: 51 })).toThrow('UNBOUNDED_QUERY_DENIED')
  })

  it('blocks archive with active work and archives terminal projects while fixing client counters', async () => {
    const store = new MemoryStore()
    seedDependencies(store)
    const blocked = new ProjectService(store, new Gate(), lifecycle(1, 0))
    await createProject(blocked)
    await blocked.transition(metadata(), 'project-1', 1, 'cancelled')
    await expect(blocked.archive(metadata(), 'project-1', 2)).rejects.toThrow('PROJECT_HAS_ACTIVE_WORK')
    const service = new ProjectService(store, new Gate(), lifecycle())
    await service.archive(metadata(), 'project-1', 2)
    expect(store.records.get('v2Organizations/org-1/project/project-1')).toMatchObject({ status: 'archived', version: 3 })
    expect(store.records.get('v2Organizations/org-1/_clientActiveProjectCounts/client-1')).toMatchObject({ value: 0 })
  })
})
