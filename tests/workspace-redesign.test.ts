import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  WorkspaceService,
  buildLegacyFoundationInventory,
  buildWorkspaceMembershipQuery,
  mapLegacyWorkspaces,
  type WorkspaceAuthorizationGate,
  type WorkspaceCommandMetadata,
  type WorkspaceLifecyclePort,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([key, value]) => [key, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => {
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
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

class Gate implements WorkspaceAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}

const principal: AuthorizationPrincipal = {
  userId: 'owner-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (organizationId = 'org-1'): WorkspaceCommandMetadata => ({
  organizationId, principal: { ...principal, organizationId },
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const lifecycle = (overrides: Partial<WorkspaceLifecyclePort> = {}): WorkspaceLifecyclePort => ({
  openTaskCount: async () => 0,
  hasActiveInternalProjectMembership: async () => true,
  ...overrides,
})
function seed(store: MemoryStore) {
  store.records.set('v2Organizations/org-1/department/dep-1', { organizationId: 'org-1', status: 'active' })
  store.records.set('v2Organizations/org-1/team/team-1', { organizationId: 'org-1', departmentId: 'dep-1', status: 'active' })
  store.records.set('v2Organizations/org-1/project/project-1', { organizationId: 'org-1', departmentId: 'dep-1', status: 'active' })
  for (const userId of ['owner-1', 'user-1']) {
    store.records.set(`v2Organizations/org-1/employment_profile/${userId}`, { organizationId: 'org-1', status: 'active' })
  }
}

describe('workspace redesign service', () => {
  it('creates a scoped workspace and explicit creator membership atomically', async () => {
    const store = new MemoryStore(); seed(store)
    const gate = new Gate()
    const result = await new WorkspaceService(store, gate, lifecycle()).create(metadata(), {
      id: 'workspace-1', name: '  مساحة المشروع ', visibility: 'project',
      projectId: 'project-1', departmentId: 'dep-1', ownerTeamId: 'team-1',
    })
    expect(result.result).toEqual({ workspaceId: 'workspace-1', version: 1 })
    expect(store.records.get('v2Organizations/org-1/workspace/workspace-1')).toMatchObject({
      organizationId: 'org-1', name: 'مساحة المشروع', status: 'active', createdBy: 'owner-1',
    })
    expect([...store.records.values()].find((record) => record.workspaceId === 'workspace-1' && record.userId === 'owner-1'))
      .toMatchObject({ membershipRole: 'manager', status: 'active' })
    expect(gate.requests[0]).toMatchObject({ permission: 'workspace.create', organizationId: 'org-1' })
  })

  it('rejects conflicting project, team and department scope', async () => {
    const store = new MemoryStore(); seed(store)
    store.records.set('v2Organizations/org-1/team/team-2', { organizationId: 'org-1', departmentId: 'dep-2', status: 'active' })
    await expect(new WorkspaceService(store, new Gate(), lifecycle()).create(metadata(), {
      id: 'workspace-2', name: 'مساحة متعارضة', visibility: 'team',
      projectId: 'project-1', departmentId: 'dep-1', ownerTeamId: 'team-2',
    })).rejects.toThrow('WORKSPACE_TEAM_SCOPE_CONFLICT')
  })

  it('requires active employment and project membership when inherited', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new WorkspaceService(store, new Gate(), lifecycle({ hasActiveInternalProjectMembership: async () => false }))
    await service.create(metadata(), {
      id: 'workspace-3', name: 'مساحة المشروع', visibility: 'project', projectId: 'project-1', departmentId: 'dep-1',
    })
    await expect(service.addMember(metadata(), {
      workspaceId: 'workspace-3', userId: 'user-1', membershipRole: 'member', source: 'project',
    })).rejects.toThrow('PROJECT_MEMBERSHIP_REQUIRED')
  })

  it('stores membership as a dedicated entity, never as a workspace array', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new WorkspaceService(store, new Gate(), lifecycle())
    await service.create(metadata(), { id: 'workspace-4', name: 'مساحة خاصة', visibility: 'private' })
    await service.addMember(metadata(), { workspaceId: 'workspace-4', userId: 'user-1', membershipRole: 'supervisor' })
    expect(store.records.get('v2Organizations/org-1/workspace/workspace-4')).not.toHaveProperty('members')
    expect([...store.records.values()].filter((record) => record.workspaceId === 'workspace-4')).toHaveLength(2)
  })

  it('blocks archive while open tasks exist', async () => {
    const store = new MemoryStore(); seed(store)
    const service = new WorkspaceService(store, new Gate(), lifecycle({ openTaskCount: async () => 1 }))
    await service.create(metadata(), { id: 'workspace-5', name: 'مساحة نشطة', visibility: 'private' })
    await expect(service.archive(metadata(), 'workspace-5', 1)).rejects.toThrow('WORKSPACE_HAS_OPEN_TASKS')
  })

  it('builds a bounded membership lookup and rejects oversized pages', () => {
    expect(buildWorkspaceMembershipQuery({ organizationId: 'org-1', userId: 'user-1' })).toMatchObject({
      entityKind: 'workspace_member', limit: 50,
      filters: [{ field: 'userId', value: 'user-1' }, { field: 'status', value: 'active' }],
    })
    expect(() => buildWorkspaceMembershipQuery({ organizationId: 'org-1', userId: 'user-1', limit: 51 }))
      .toThrow('UNBOUNDED_QUERY_DENIED')
  })
})

describe('legacy workspace mapping', () => {
  it('accounts for every workspace and quarantines orphan references without granting access', () => {
    const report = mapLegacyWorkspaces({
      organizationId: 'org-1',
      knownUserIds: new Set(['owner-1', 'member-1']),
      workspaces: [
        { id: 'workspace-a', name: 'A workspace', createdBy: 'owner-1', members: ['member-1', 'missing'], supervisors: ['member-1'] },
        { id: 'workspace-b', name: 'B workspace', createdBy: 'missing-owner', members: [] },
      ],
    })
    expect(report).toMatchObject({ sourceCount: 2, mappedWorkspaceCount: 2, mappedMembershipCount: 2, quarantinedCount: 2 })
    expect(report.issues.map(({ code }) => code).sort()).toEqual(['MISSING_CREATOR', 'ORPHAN_MEMBER'])
    expect(report.records.some(({ data }) => data.userId === 'missing')).toBe(false)
  })

  it('is deterministic for idempotent staging reruns', () => {
    const input = {
      organizationId: 'org-1', knownUserIds: new Set(['user-1']),
      workspaces: [{ id: 'workspace-a', name: 'A workspace', createdBy: 'user-1', members: ['user-1'] }],
    }
    expect(mapLegacyWorkspaces(input)).toEqual(mapLegacyWorkspaces(input))
  })

  it('accounts for users, roles and workspaces and never promotes legacy Admin to Owner', () => {
    const inventory = buildLegacyFoundationInventory({
      organizationId: 'org-1',
      users: [{ id: 'admin-1', role: 'Admin' }],
      roles: [{ id: 'Admin', name: 'Administrator' }],
      workspaces: [{ id: 'workspace-a', name: 'A workspace', createdBy: 'admin-1', supervisors: ['admin-1'] }],
    })
    expect(inventory.sourceCounts).toEqual(inventory.accountedCounts)
    expect(inventory.roleInventory[0]).toMatchObject({ proposedRole: 'GeneralManager', grantsApplied: false })
    expect(inventory.hasUnknownPrivilegedMapping).toBe(false)
    expect(inventory.hasUnclassifiedOrphan).toBe(false)
  })
})
