import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import {
  assertAllocationPercent,
  normalizeDirectoryCode,
  normalizeDirectoryName,
} from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  OrganizationStructureService,
  type OrganizationAuthorizationGate,
  type OrganizationCommandMetadata,
} from '../services/functions/src/organization/service'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()

  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult> {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
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

class Gate implements OrganizationAuthorizationGate {
  requests: AuthorizationRequest[] = []
  constructor(private readonly allow = true) {}
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
    if (!this.allow) throw new Error('AUTHORIZATION_DENIED')
  }
}

const principal: AuthorizationPrincipal = {
  userId: 'owner-1',
  authenticated: true,
  tokenFresh: true,
  accountStatus: 'active',
  employmentStatus: 'active',
  organizationId: 'org-1',
  membershipStatus: 'active',
  principalType: 'member',
  clientAccountIds: [],
  stepUpSatisfied: true,
  mfaSatisfied: true,
}

let sequence = 0
const metadata = (organizationId = 'org-1'): OrganizationCommandMetadata => {
  sequence += 1
  return {
    organizationId,
    principal,
    correlationId: `correlation-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    fingerprint: `fingerprint-${sequence}`,
  }
}

describe('organization domain invariants', () => {
  it('normalizes names and codes and rejects invalid allocation', () => {
    expect(normalizeDirectoryName('  فريق   المحتوى ')).toBe('فريق المحتوى')
    expect(normalizeDirectoryCode(' seo-team ')).toBe('SEO-TEAM')
    expect(() => normalizeDirectoryCode('x')).toThrow('INVALID_DIRECTORY_CODE')
    expect(() => assertAllocationPercent(0)).toThrow('INVALID_ALLOCATION_PERCENT')
    expect(() => assertAllocationPercent(101)).toThrow('INVALID_ALLOCATION_PERCENT')
  })
})

describe('organization structure service', () => {
  it('updates organization settings with canonical timezone and optimistic concurrency', async () => {
    const store = new MemoryStore()
    const service = new OrganizationStructureService(store, new Gate())
    const first = await service.updateSettings(metadata(), {
      timezone: 'Africa/Cairo', locale: 'ar', weekStartsOn: 6, retentionPolicyId: 'retention-standard', expectedVersion: 0,
    })
    expect(first.result.version).toBe(1)
    await expect(service.updateSettings(metadata(), {
      timezone: 'Invalid/Timezone', locale: 'ar', weekStartsOn: 6, retentionPolicyId: 'retention-standard', expectedVersion: 1,
    })).rejects.toThrow('INVALID_TIMEZONE')
    await expect(service.updateSettings(metadata(), {
      timezone: 'Africa/Cairo', locale: 'ar', weekStartsOn: 6, retentionPolicyId: 'retention-standard', expectedVersion: 0,
    })).rejects.toThrow('VERSION_CONFLICT')
  })

  it('updates and suspends an existing organization through distinct sensitive permissions', async () => {
    const store = new MemoryStore()
    store.records.set('v2Organizations/org-1/organization/org-1', {
      organizationId: 'org-1', schemaVersion: 2, version: 1, name: 'زمام', slug: 'zamam', status: 'active',
    })
    const gate = new Gate()
    const service = new OrganizationStructureService(store, gate)
    await service.updateOrganizationName(metadata(), 'وكالة زمام', 1)
    await service.suspendOrganization(metadata(), 2, 'تعليق اختباري موثق للمؤسسة')
    expect(store.records.get('v2Organizations/org-1/organization/org-1')).toMatchObject({
      name: 'وكالة زمام', status: 'suspended', version: 3,
    })
    expect(gate.requests.map(({ permission }) => permission)).toEqual(['organization.manage', 'organization.suspend'])
  })

  it('creates scoped departments and teams with atomic uniqueness and audit events', async () => {
    const store = new MemoryStore()
    const gate = new Gate()
    const service = new OrganizationStructureService(store, gate)

    await service.createDepartment(metadata(), { id: 'dep-seo', name: 'تحسين محركات البحث', code: 'seo' })
    await expect(service.createDepartment(metadata(), { id: 'dep-copy', name: 'قسم آخر', code: 'SEO' }))
      .rejects.toThrow('DEPARTMENT_CODE_ALREADY_EXISTS')
    await service.createTeam(metadata(), 'dep-seo', { id: 'team-content', name: 'فريق المحتوى', code: 'content' })

    expect(store.records.get('v2Organizations/org-1/department/dep-seo')).toMatchObject({
      organizationId: 'org-1', code: 'SEO', status: 'active', version: 1,
    })
    expect(store.records.get('v2Organizations/org-1/team/team-content')).toMatchObject({
      organizationId: 'org-1', departmentId: 'dep-seo', code: 'CONTENT', status: 'active',
    })
    expect(gate.requests.map(({ permission }) => permission)).toEqual([
      'department.create', 'department.create', 'team.create',
    ])
    expect([...store.records.keys()].filter((path) => path.includes('/_auditEvents/')).length).toBe(3)
  })

  it('supports multi-team membership while enforcing one primary team and total allocation', async () => {
    const store = new MemoryStore()
    const service = new OrganizationStructureService(store, new Gate())
    await service.createDepartment(metadata(), { id: 'dep-ops', name: 'العمليات', code: 'OPS' })
    await service.createTeam(metadata(), 'dep-ops', { id: 'team-a', name: 'الفريق الأول', code: 'TEAM-A' })
    await service.createTeam(metadata(), 'dep-ops', { id: 'team-b', name: 'الفريق الثاني', code: 'TEAM-B' })

    const first = await service.addTeamMember(metadata(), {
      teamId: 'team-a', userId: 'user-1', membershipRole: 'member', isPrimary: true, allocationPercent: 60,
    })
    await expect(service.addTeamMember(metadata(), {
      teamId: 'team-b', userId: 'user-1', membershipRole: 'member', isPrimary: true, allocationPercent: 20,
    })).rejects.toThrow('PRIMARY_TEAM_ALREADY_ASSIGNED')
    await expect(service.addTeamMember(metadata(), {
      teamId: 'team-b', userId: 'user-1', membershipRole: 'member', isPrimary: false, allocationPercent: 50,
    })).rejects.toThrow('TEAM_ALLOCATION_EXCEEDED')
    const second = await service.addTeamMember(metadata(), {
      teamId: 'team-b', userId: 'user-1', membershipRole: 'member', isPrimary: false, allocationPercent: 40,
    })

    expect(first.result.version).toBe(1)
    expect(second.result.version).toBe(1)
    expect(store.records.get('v2Organizations/org-1/_teamAllocationByUser/user-1')).toMatchObject({ value: 100 })
  })

  it('blocks archival while references are active, then archives after membership ends', async () => {
    const store = new MemoryStore()
    const service = new OrganizationStructureService(store, new Gate())
    await service.createDepartment(metadata(), { id: 'dep-design', name: 'التصميم', code: 'DESIGN' })
    await service.createTeam(metadata(), 'dep-design', { id: 'team-design', name: 'فريق التصميم', code: 'DESIGN-T' })
    const membership = await service.addTeamMember(metadata(), {
      teamId: 'team-design', userId: 'user-2', membershipRole: 'leader', isPrimary: true, allocationPercent: 100,
    })

    await expect(service.archiveTeam(metadata(), 'team-design', 1)).rejects.toThrow('TEAM_HAS_ACTIVE_MEMBERS')
    await expect(service.archiveDepartment(metadata(), 'dep-design', 1)).rejects.toThrow('DEPARTMENT_HAS_ACTIVE_TEAMS')
    await service.endTeamMember(metadata(), 'team-design', 'user-2', membership.result.version)
    await service.archiveTeam(metadata(), 'team-design', 1)
    await service.archiveDepartment(metadata(), 'dep-design', 1)

    expect(store.records.get('v2Organizations/org-1/team/team-design')).toMatchObject({ status: 'archived', version: 2 })
    expect(store.records.get('v2Organizations/org-1/department/dep-design')).toMatchObject({ status: 'archived', version: 2 })
  })

  it('authorizes before writes and leaves storage unchanged when denied', async () => {
    const store = new MemoryStore()
    const service = new OrganizationStructureService(store, new Gate(false))
    await expect(service.createDepartment(metadata(), { id: 'dep-denied', name: 'قسم مرفوض', code: 'DENIED' }))
      .rejects.toThrow('AUTHORIZATION_DENIED')
    expect(store.records.size).toBe(0)
  })

  it('replays an idempotent command without duplicating business or audit records', async () => {
    const store = new MemoryStore()
    const service = new OrganizationStructureService(store, new Gate())
    const command = metadata()
    const first = await service.createDepartment(command, { id: 'dep-idem', name: 'قسم ثابت', code: 'IDEM' })
    const replay = await service.createDepartment(command, { id: 'dep-idem', name: 'قسم ثابت', code: 'IDEM' })
    expect(first.replayed).toBe(false)
    expect(replay).toEqual({ ...first, replayed: true })
    expect([...store.records.keys()].filter((path) => path.includes('/_auditEvents/'))).toHaveLength(1)
  })
})
