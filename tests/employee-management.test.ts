import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { evaluateSession, projectEmployeeFields, type SessionAccount } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  EmployeeService,
  type EmployeeAccessReference,
  type EmployeeAuthorizationGate,
  type EmployeeCommandMetadata,
  type EmployeeIdentityPort,
  type EmployeeLifecyclePort,
  type InvitationLookupPort,
} from '../services/functions/src/employee/service'

/**
 * Enforces the real Firestore transaction rule ("all reads before any writes") that a plain Map-backed
 * fake would silently let slide — a plain fake here would never have caught the read-after-write bug that
 * shipped in acceptInvitation/activateInvitation/disable (and AuditCommandService.execute() itself).
 */
class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult> {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => {
        if (writeStarted) {
          throw new Error(
            `FIRESTORE_TRANSACTION_READ_AFTER_WRITE: read of "${path}" occurred after a write was already ` +
            'queued in this transaction; Firestore requires all reads to happen before any writes.',
          )
        }
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

class Gate implements EmployeeAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}

function identityPort(userId = 'new-user'): EmployeeIdentityPort & {
  provisionInvitation: ReturnType<typeof vi.fn>
  compensateInvitation: ReturnType<typeof vi.fn>
  disableIdentity: ReturnType<typeof vi.fn>
  revokeRefreshTokens: ReturnType<typeof vi.fn>
  setPassword: ReturnType<typeof vi.fn>
} {
  return {
    provisionInvitation: vi.fn().mockResolvedValue({ userId, created: true }),
    compensateInvitation: vi.fn().mockResolvedValue(undefined),
    disableIdentity: vi.fn().mockResolvedValue(undefined),
    revokeRefreshTokens: vi.fn().mockResolvedValue(undefined),
    setPassword: vi.fn().mockResolvedValue(undefined),
  }
}

/** Firestore-backed in production (collectionGroup query across all tenants); here just an in-memory
 * index over whatever invitation records the test seeded into the MemoryStore. */
function invitationPort(store: MemoryStore): InvitationLookupPort {
  return {
    async findByTokenHash(tokenHash) {
      for (const [path, record] of store.records) {
        if (!path.includes('/invitation/')) continue
        if (record.tokenHash === tokenHash) {
          const organizationId = String(record.organizationId)
          const invitationId = path.split('/').at(-1)!
          return { organizationId, invitationId }
        }
      }
      return null
    },
  }
}

function lifecyclePort(references: readonly EmployeeAccessReference[] = [], owner = false, ownerCount = 2): EmployeeLifecyclePort {
  return {
    isOwner: vi.fn().mockResolvedValue(owner),
    activeOwnerCount: vi.fn().mockResolvedValue(ownerCount),
    listActiveAccess: vi.fn().mockResolvedValue(references),
    hasOtherActiveMemberships: vi.fn().mockResolvedValue(false),
  }
}

const principal: AuthorizationPrincipal = {
  userId: 'manager-1',
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
const metadata = (): EmployeeCommandMetadata => {
  sequence += 1
  return {
    organizationId: 'org-1',
    principal,
    correlationId: `correlation-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`,
    fingerprint: `fingerprint-${sequence}`,
  }
}

const seedDepartment = (store: MemoryStore) => {
  store.records.set('v2Organizations/org-1/department/dep-1', {
    organizationId: 'org-1', schemaVersion: 2, version: 1, name: 'Operations', code: 'OPS', status: 'active',
  })
  // invite()'s default role is 'Employee' — the role doc must already exist (BootstrapOwnerService seeds
  // the full default-role catalog in production; tests seed just what each invite() call needs).
  store.records.set('v2Organizations/org-1/role/default-employee', {
    organizationId: 'org-1', schemaVersion: 2, version: 1, name: 'Employee', permissions: ['task.view'], status: 'active',
  })
}

const seedRole = (store: MemoryStore, roleDocId: string, name: string) => {
  store.records.set(`v2Organizations/org-1/role/${roleDocId}`, {
    organizationId: 'org-1', schemaVersion: 2, version: 1, name, permissions: ['task.create'], status: 'active',
  })
}

const seedActiveEmployee = (store: MemoryStore, userId = 'user-1') => {
  store.records.set(`v2Organizations/org-1/organization_membership/${userId}`, {
    organizationId: 'org-1', schemaVersion: 2, version: 1, userId, status: 'active',
  })
  store.records.set(`v2Organizations/org-1/employment_profile/${userId}`, {
    organizationId: 'org-1', schemaVersion: 2, version: 1, userId, status: 'active',
    employeeNumber: 'EMP-1', employmentType: 'employee', primaryDepartmentId: 'dep-1', jobTitle: 'Specialist', startDate: '2026-01-01',
  })
  store.records.set(`v2Organizations/org-1/_userAccessState/${userId}`, {
    organizationId: 'org-1', schemaVersion: 2, version: 1, userId, state: 'active',
  })
  // An already-active employee would already have accepted an invitation, which projects this doc.
  store.records.set(`sessionViews/${userId}`, {
    userId, displayName: 'Active Employee', accountStatus: 'active',
    memberships: [{ organizationId: 'org-1', status: 'active' }, { organizationId: 'org-other', status: 'active' }],
  })
}

describe('employee invitation saga', () => {
  it('creates tenant-owned invitation records, a default-Employee role assignment, and no raw email storage', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    const identities = identityPort()
    const gate = new Gate()
    const service = new EmployeeService(store, gate, identities, lifecyclePort(), invitationPort(store))
    const result = await service.invite(metadata(), {
      email: '  Employee@Example.com ',
      displayName: 'موظف جديد',
      firstName: 'موظف',
      employeeNumber: ' emp-10 ',
      employmentType: 'employee',
      primaryDepartmentId: 'dep-1',
      jobTitle: 'كاتب محتوى',
      startDate: '2026-08-01',
      locale: 'ar',
      timezone: 'Africa/Cairo',
    })

    expect(result.result).toMatchObject({ userId: 'new-user', membershipStatus: 'invited' })
    expect(store.records.get('v2Organizations/org-1/organization_membership/new-user')).toMatchObject({ status: 'invited' })
    expect(store.records.get('v2Organizations/org-1/employment_profile/new-user')).toMatchObject({
      employeeNumber: 'EMP-10', status: 'planned', primaryDepartmentId: 'dep-1',
    })
    expect(JSON.stringify([...store.records.values()])).not.toContain('employee@example.com')
    // No role was chosen, so it defaults to Employee at 'self' scope — visibility is per-assignment
    // (see TaskService), not org-wide, for a plain Employee.
    expect(store.records.get('v2Organizations/org-1/role_assignment/role-new-user')).toMatchObject({
      userId: 'new-user', roleId: 'default-employee', scopeType: 'self', scopeId: 'new-user', effect: 'grant', status: 'active',
    })
    expect(gate.requests[0]?.permission).toBe('user.invite')
  })

  it('scopes a Department Lead invite to their own department, and a Manager invite to the organization', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    seedRole(store, 'default-department-lead', 'DepartmentLead')
    seedRole(store, 'default-manager', 'Manager')
    const leadService = new EmployeeService(store, new Gate(), identityPort('lead-user'), lifecyclePort(), invitationPort(store))
    await leadService.invite(metadata(), {
      email: 'lead@example.com', displayName: 'قائد القسم', firstName: 'قائد',
      employeeNumber: 'EMP-11', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'Lead', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo', role: 'DepartmentLead',
    })
    expect(store.records.get('v2Organizations/org-1/role_assignment/role-lead-user')).toMatchObject({
      roleId: 'default-department-lead', scopeType: 'department', scopeId: 'dep-1',
    })

    const managerService = new EmployeeService(store, new Gate(), identityPort('manager-user'), lifecyclePort(), invitationPort(store))
    await managerService.invite(metadata(), {
      email: 'manager@example.com', displayName: 'المدير', firstName: 'المدير',
      employeeNumber: 'EMP-12', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'Manager', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo', role: 'Manager',
    })
    expect(store.records.get('v2Organizations/org-1/role_assignment/role-manager-user')).toMatchObject({
      roleId: 'default-manager', scopeType: 'organization', scopeId: 'org-1',
    })
  })

  it('compensates a newly provisioned identity when the tenant transaction fails', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    store.records.set('v2Organizations/org-1/_employeeNumbers/employee-e4f6bb166aa916fadbb24f75c7bcf91d', {
      organizationId: 'org-1', active: true, userId: 'existing',
    })
    const identities = identityPort('provisioned-user')
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(), invitationPort(store))
    await service.invite(metadata(), {
      email: 'first@example.com', displayName: 'الموظف الأول', firstName: 'الموظف',
      employeeNumber: 'EMP-20', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'كاتب', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
    })
    const secondMetadata = metadata()
    identities.provisionInvitation.mockResolvedValueOnce({ userId: 'second-user', created: true })
    await expect(service.invite(secondMetadata, {
      email: 'second@example.com', displayName: 'الموظف الثاني', firstName: 'الموظف',
      employeeNumber: 'EMP-20', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'كاتب', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
    })).rejects.toThrow('EMPLOYEE_NUMBER_ALREADY_EXISTS')
    expect(identities.compensateInvitation).toHaveBeenCalledWith('second-user', secondMetadata.idempotencyKey)
    expect(store.records.has('v2Organizations/org-1/organization_membership/second-user')).toBe(false)
  })
})

describe('invitation acceptance', () => {
  async function seedInvitation(store: MemoryStore, identities: ReturnType<typeof identityPort>, employeeNumber = 'EMP-30', email = 'invitee@example.com') {
    seedDepartment(store)
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(), invitationPort(store))
    const invited = await service.invite(metadata(), {
      email, displayName: 'مدعو جديد', firstName: 'مدعو', employeeNumber,
      employmentType: 'employee', primaryDepartmentId: 'dep-1', jobTitle: 'محلل',
      startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
    })
    return { service, invitationToken: invited.result.invitationToken, userId: invited.result.userId }
  }

  it('accepts a valid invitation: verifies the token, activates membership/employment, sets the password, and consumes the invitation', async () => {
    const store = new MemoryStore()
    const identities = identityPort('new-user')
    const { service, invitationToken, userId } = await seedInvitation(store, identities)
    const result = await service.acceptInvitation({
      invitationToken, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-1', correlationId: 'correlation-accept-1',
    })
    expect(result.result).toEqual({ userId, membershipStatus: 'active' })
    expect(store.records.get(`v2Organizations/org-1/organization_membership/${userId}`)).toMatchObject({ status: 'active' })
    expect(store.records.get(`v2Organizations/org-1/employment_profile/${userId}`)).toMatchObject({ status: 'active' })
    const invitationRecord = [...store.records.entries()].find(([path]) => path.includes('/invitation/'))?.[1]
    expect(invitationRecord).toMatchObject({ status: 'accepted' })
    expect(identities.setPassword).toHaveBeenCalledWith(userId, 'a-very-strong-password-1')
    // This is what apps/web/src/auth/session-reader.ts reads to gate ProtectedRoute — without it the user
    // this invitation just activated could never log in (the bug behind commit 5b1ca23 and this fix).
    expect(store.records.get(`sessionViews/${userId}`)).toEqual({
      userId, displayName: 'مدعو جديد', accountStatus: 'active',
      memberships: [{ organizationId: 'org-1', status: 'active' }],
    })
  })

  it('adds this organization to an existing sessionViews doc without dropping other organizations already there', async () => {
    const store = new MemoryStore()
    const identities = identityPort('new-user')
    store.records.set('sessionViews/new-user', {
      userId: 'new-user', displayName: 'Old Name', accountStatus: 'active',
      memberships: [{ organizationId: 'org-other', status: 'active' }],
    })
    const { service, invitationToken, userId } = await seedInvitation(store, identities)
    await service.acceptInvitation({
      invitationToken, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-multi-org', correlationId: 'correlation-accept-multi-org',
    })
    expect(store.records.get(`sessionViews/${userId}`)).toEqual({
      userId, displayName: 'مدعو جديد', accountStatus: 'active',
      memberships: expect.arrayContaining([
        { organizationId: 'org-other', status: 'active' },
        { organizationId: 'org-1', status: 'active' },
      ]),
    })
    expect((store.records.get(`sessionViews/${userId}`)?.memberships as unknown[]).length).toBe(2)
  })

  it('rejects an expired invitation token', async () => {
    const store = new MemoryStore()
    const { service, invitationToken } = await seedInvitation(store, identityPort())
    const [invitationPath, invitationRecord] = [...store.records.entries()].find(([path]) => path.includes('/invitation/'))!
    store.records.set(invitationPath, { ...invitationRecord, expiresAt: '2020-01-01T00:00:00.000Z' })
    await expect(service.acceptInvitation({
      invitationToken, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-2', correlationId: 'correlation-accept-2',
    })).rejects.toThrow('INVITATION_EXPIRED')
  })

  it('rejects a token that has already been used', async () => {
    const store = new MemoryStore()
    const { service, invitationToken } = await seedInvitation(store, identityPort())
    await service.acceptInvitation({
      invitationToken, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-3', correlationId: 'correlation-accept-3',
    })
    await expect(service.acceptInvitation({
      invitationToken, password: 'another-strong-password-2',
      idempotencyKey: 'accept-key-4', correlationId: 'correlation-accept-4',
    })).rejects.toThrow('INVITATION_ALREADY_USED')
  })

  it('rejects an invalid or unknown token', async () => {
    const store = new MemoryStore()
    const { service } = await seedInvitation(store, identityPort())
    await expect(service.acceptInvitation({
      invitationToken: 'x'.repeat(43), password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-5', correlationId: 'correlation-accept-5',
    })).rejects.toThrow('INVITATION_TOKEN_INVALID')
  })

  it('rejects a tampered token whose hash does not match the stored invitation (wrong token for the record it claims)', async () => {
    const store = new MemoryStore()
    const { service, invitationToken } = await seedInvitation(store, identityPort())
    const [invitationPath, invitationRecord] = [...store.records.entries()].find(([path]) => path.includes('/invitation/'))!
    store.records.set(invitationPath, { ...invitationRecord, tokenHash: createHash('sha256').update('a-different-token').digest('hex') })
    await expect(service.acceptInvitation({
      invitationToken, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-6', correlationId: 'correlation-accept-6',
    })).rejects.toThrow('INVITATION_TOKEN_INVALID')
  })

  it("never activates the wrong user's membership: accepting invitation B's token only ever affects user B, never user A", async () => {
    const store = new MemoryStore()
    const identitiesA = identityPort('user-a')
    const { userId: userA } = await seedInvitation(store, identitiesA, 'EMP-30', 'first@example.com')
    identitiesA.provisionInvitation.mockResolvedValueOnce({ userId: 'user-b', created: true })
    const { service, invitationToken: tokenB, userId: userB } = await seedInvitation(store, identitiesA, 'EMP-31', 'second@example.com')
    expect(userB).toBe('user-b')
    const result = await service.acceptInvitation({
      invitationToken: tokenB, password: 'a-very-strong-password-1',
      idempotencyKey: 'accept-key-7', correlationId: 'correlation-accept-7',
    })
    expect(result.result.userId).toBe(userB)
    expect(store.records.get(`v2Organizations/org-1/organization_membership/${userA}`)).toMatchObject({ status: 'invited' })
    expect(store.records.get(`v2Organizations/org-1/organization_membership/${userB}`)).toMatchObject({ status: 'active' })
  })
})

describe('employee disable and departure', () => {
  it('protects the last Owner before mutating membership or identity', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    const identities = identityPort()
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort([], true, 1), invitationPort(store))
    await expect(service.disable(metadata(), 'user-1', 1, 'سبب تعطيل موثق للاختبار')).rejects.toThrow('LAST_OWNER_PROTECTED')
    expect(store.records.get('v2Organizations/org-1/organization_membership/user-1')).toMatchObject({ status: 'active' })
    expect(identities.disableIdentity).not.toHaveBeenCalled()
  })

  it('blocks an active session in data first and revokes identity tokens', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    const identities = identityPort()
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(), invitationPort(store))
    await service.disable(metadata(), 'user-1', 1, 'إيقاف إداري موثق للاختبار')
    expect(store.records.get('v2Organizations/org-1/organization_membership/user-1')).toMatchObject({ status: 'suspended', version: 2 })
    expect(identities.disableIdentity).toHaveBeenCalledWith('user-1')
    expect(identities.revokeRefreshTokens).toHaveBeenCalledWith('user-1')
    // org-1's entry is removed from sessionViews so the next login sees no active membership there — the
    // still-active org-other entry is left untouched (a user can belong to more than one organization).
    expect(store.records.get('sessionViews/user-1')).toMatchObject({
      memberships: [{ organizationId: 'org-other', status: 'active' }],
    })
    const session: SessionAccount = {
      identity: { userId: 'user-1', email: null, emailVerified: true, tokenIssuedAt: 10 },
      accountStatus: 'active',
      memberships: [{ organizationId: 'org-1', userId: 'user-1', status: 'suspended' }],
      tokensValidAfter: 0,
    }
    expect(evaluateSession(session)).toEqual({ kind: 'deny', reason: 'NO_ACTIVE_MEMBERSHIP' })
  })

  it('keeps access denied and reports pending revocation if the identity provider fails', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    const identities = identityPort()
    identities.revokeRefreshTokens.mockRejectedValueOnce(new Error('provider unavailable'))
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(), invitationPort(store))
    await expect(service.disable(metadata(), 'user-1', 1, 'إيقاف آمن رغم تعطل المزود')).rejects.toThrow('IDENTITY_REVOCATION_PENDING')
    expect(store.records.get('v2Organizations/org-1/_userAccessState/user-1')).toMatchObject({ state: 'disabled' })
  })

  it('revokes tokens but preserves a shared global identity with another active tenant membership', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    const identities = identityPort()
    const lifecycle = lifecyclePort()
    vi.mocked(lifecycle.hasOtherActiveMemberships).mockResolvedValue(true)
    const service = new EmployeeService(store, new Gate(), identities, lifecycle, invitationPort(store))
    await service.disable(metadata(), 'user-1', 1, 'تعطيل العضوية داخل مؤسسة واحدة')
    expect(identities.disableIdentity).not.toHaveBeenCalled()
    expect(identities.revokeRefreshTokens).toHaveBeenCalledWith('user-1')
  })

  it('ends membership, employment, role, team, and project access atomically on departure', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    store.records.set('v2Organizations/org-1/role_assignment/role-ref', {
      organizationId: 'org-1', version: 3, userId: 'user-1', status: 'active',
    })
    store.records.set('v2Organizations/org-1/team_membership/team-ref', {
      organizationId: 'org-1', version: 2, userId: 'user-1', teamId: 'team-1',
      status: 'active', allocationPercent: 60, isPrimary: true,
    })
    store.records.set('v2Organizations/org-1/project_member/project-ref', {
      organizationId: 'org-1', version: 1, userId: 'user-1', projectId: 'project-1', status: 'active',
    })
    store.records.set('v2Organizations/org-1/_teamActiveMemberCounts/team-1', {
      organizationId: 'org-1', value: 1,
    })
    store.records.set('v2Organizations/org-1/_teamAllocationByUser/user-1', {
      organizationId: 'org-1', value: 60,
    })
    store.records.set('v2Organizations/org-1/_primaryTeamByUser/user-1', {
      organizationId: 'org-1', active: true, teamId: 'team-1',
    })
    const references: EmployeeAccessReference[] = [
      { kind: 'role_assignment', id: 'role-ref', expectedVersion: 3 },
      { kind: 'team_membership', id: 'team-ref', expectedVersion: 2 },
      { kind: 'project_member', id: 'project-ref', expectedVersion: 1 },
    ]
    const identities = identityPort()
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(references), invitationPort(store))
    const result = await service.depart(metadata(), 'user-1', 1, '2026-08-31', 'انتهاء علاقة العمل وفق الإجراء')

    expect(result.result.revokedAccessCount).toBe(3)
    expect(store.records.get('v2Organizations/org-1/organization_membership/user-1')).toMatchObject({ status: 'left' })
    expect(store.records.get('v2Organizations/org-1/employment_profile/user-1')).toMatchObject({ status: 'ended', endDate: '2026-08-31' })
    expect(store.records.get('v2Organizations/org-1/role_assignment/role-ref')).toMatchObject({ status: 'revoked', version: 4 })
    expect(store.records.get('v2Organizations/org-1/team_membership/team-ref')).toMatchObject({ status: 'ended', version: 3 })
    expect(store.records.get('v2Organizations/org-1/project_member/project-ref')).toMatchObject({ status: 'ended', version: 2 })
    expect(store.records.get('v2Organizations/org-1/_teamAllocationByUser/user-1')).toMatchObject({ value: 0 })
    expect(store.records.get('v2Organizations/org-1/_primaryTeamByUser/user-1')).toMatchObject({ active: false })
    expect(store.records.get('sessionViews/user-1')).toMatchObject({
      memberships: [{ organizationId: 'org-other', status: 'active' }],
    })
  })
})

describe('Area 1: direct member creation', () => {
  it('creates an active membership immediately (no invitation/token step), returns a strong one-time temporary password, and marks mustChangePassword', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    const identities = identityPort('direct-user')
    const gate = new Gate()
    const service = new EmployeeService(store, gate, identities, lifecyclePort(), invitationPort(store))
    const result = await service.createDirect(metadata(), {
      email: 'direct@example.com', displayName: 'عضو مباشر', firstName: 'عضو',
      employeeNumber: 'EMP-40', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'محلل', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
      whatsappPhone: '+966501234567',
    })

    expect(result.result.userId).toBe('direct-user')
    expect(result.result.membershipStatus).toBe('active')
    // The plaintext password is only ever handed back in this response — it is never written onto the
    // membership/employment/profile records themselves (it does land inside the command's own idempotency
    // replay record, same as every other command's result, which is how replaying a retried request works).
    expect(typeof result.result.temporaryPassword).toBe('string')
    expect(result.result.temporaryPassword.length).toBeGreaterThanOrEqual(20)
    expect(identities.setPassword).toHaveBeenCalledWith('direct-user', result.result.temporaryPassword)

    expect(store.records.get('v2Organizations/org-1/organization_membership/direct-user')).toMatchObject({ status: 'active' })
    expect(store.records.get('v2Organizations/org-1/employment_profile/direct-user')).toMatchObject({
      status: 'active', mustChangePassword: true,
    })
    expect(store.records.get('v2Organizations/org-1/user_profile/direct-user')).toMatchObject({
      whatsappPhone: '+966501234567',
    })
    // Immediately loginable — sessionViews is projected right away (no separate accept step), with the
    // force-password-change flag ProtectedRoute's gate reads (apps/web/src/auth/ProtectedRoute.tsx).
    expect(store.records.get('sessionViews/direct-user')).toMatchObject({
      userId: 'direct-user', accountStatus: 'active', mustChangePassword: true,
      memberships: [{ organizationId: 'org-1', status: 'active' }],
    })
    expect(gate.requests[0]?.permission).toBe('user.invite')
  })

  it('rejects a malformed WhatsApp number instead of silently storing garbage', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    const service = new EmployeeService(store, new Gate(), identityPort(), lifecyclePort(), invitationPort(store))
    await expect(service.createDirect(metadata(), {
      email: 'bad@example.com', displayName: 'رقم خاطئ', firstName: 'رقم',
      employeeNumber: 'EMP-41', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'محلل', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
      whatsappPhone: 'not-a-phone',
    })).rejects.toThrow('INVALID_WHATSAPP_PHONE')
  })

  it('compensates the provisioned identity if the creation transaction fails (e.g. a duplicate employee number)', async () => {
    const store = new MemoryStore()
    seedDepartment(store)
    const firstIdentities = identityPort('direct-user-1')
    const firstService = new EmployeeService(store, new Gate(), firstIdentities, lifecyclePort(), invitationPort(store))
    await firstService.createDirect(metadata(), {
      email: 'first@example.com', displayName: 'الأول', firstName: 'الأول',
      employeeNumber: 'EMP-50', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'محلل', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
      whatsappPhone: '+966501234567',
    })

    const identities = identityPort('direct-user-2')
    const service = new EmployeeService(store, new Gate(), identities, lifecyclePort(), invitationPort(store))
    await expect(service.createDirect(metadata(), {
      email: 'dupe@example.com', displayName: 'مكرر', firstName: 'مكرر',
      employeeNumber: 'EMP-50', employmentType: 'employee', primaryDepartmentId: 'dep-1',
      jobTitle: 'محلل', startDate: '2026-08-01', locale: 'ar', timezone: 'Africa/Cairo',
      whatsappPhone: '+966501234568',
    })).rejects.toThrow('EMPLOYEE_NUMBER_ALREADY_EXISTS')
    expect(identities.compensateInvitation).toHaveBeenCalledWith('direct-user-2', expect.any(String))
    expect(store.records.has('v2Organizations/org-1/organization_membership/direct-user-2')).toBe(false)
  })
})

describe('Area 1: self-service password change and WhatsApp number', () => {
  it('changeOwnPassword clears mustChangePassword on both employment_profile and sessionViews, with no RBAC gate (self-service)', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store, 'user-1')
    store.records.set('v2Organizations/org-1/employment_profile/user-1', {
      ...store.records.get('v2Organizations/org-1/employment_profile/user-1'), mustChangePassword: true,
    })
    store.records.set('sessionViews/user-1', {
      userId: 'user-1', displayName: 'Active Employee', accountStatus: 'active', mustChangePassword: true,
      memberships: [{ organizationId: 'org-1', status: 'active' }],
    })
    const identities = identityPort()
    const gate = new Gate()
    const service = new EmployeeService(store, gate, identities, lifecyclePort(), invitationPort(store))
    const selfPrincipal: AuthorizationPrincipal = { ...principal, userId: 'user-1' }
    const result = await service.changeOwnPassword(
      { organizationId: 'org-1', principal: selfPrincipal, correlationId: 'c-1', idempotencyKey: 'idempotency-key-1', fingerprint: 'f-1' },
      { newPassword: 'a-brand-new-strong-password' },
    )
    expect(result.result).toEqual({ userId: 'user-1', mustChangePassword: false })
    expect(identities.setPassword).toHaveBeenCalledWith('user-1', 'a-brand-new-strong-password')
    expect(store.records.get('v2Organizations/org-1/employment_profile/user-1')).toMatchObject({ mustChangePassword: false })
    expect(store.records.get('sessionViews/user-1')).toMatchObject({ mustChangePassword: false })
    expect(gate.requests).toHaveLength(0)
  })

  it('updateOwnWhatsappPhone normalizes and stores the caller\'s own number', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store, 'user-1')
    store.records.set('v2Organizations/org-1/user_profile/user-1', {
      organizationId: 'org-1', schemaVersion: 2, version: 1, userId: 'user-1', displayName: 'Active Employee',
    })
    const service = new EmployeeService(store, new Gate(), identityPort(), lifecyclePort(), invitationPort(store))
    const selfPrincipal: AuthorizationPrincipal = { ...principal, userId: 'user-1' }
    const result = await service.updateOwnWhatsappPhone(
      { organizationId: 'org-1', principal: selfPrincipal, correlationId: 'c-2', idempotencyKey: 'idempotency-key-2', fingerprint: 'f-2' },
      { whatsappPhone: '966 50 123 4567' },
    )
    expect(result.result.whatsappPhone).toBe('+966501234567')
    expect(store.records.get('v2Organizations/org-1/user_profile/user-1')).toMatchObject({ whatsappPhone: '+966501234567' })
  })
})

describe('employee scheduling and field projections', () => {
  it('upserts a bounded work schedule and links it to active employment', async () => {
    const store = new MemoryStore()
    seedActiveEmployee(store)
    const service = new EmployeeService(store, new Gate(), identityPort(), lifecyclePort(), invitationPort(store))
    await service.upsertWorkSchedule(metadata(), {
      userId: 'user-1', timezone: 'Africa/Cairo', weeklyMinutes: 2400,
      effectiveFrom: '2026-08-01', expectedVersion: 0,
    })
    expect(store.records.get('v2Organizations/org-1/work_schedule/user-1')).toMatchObject({
      weeklyMinutes: 2400, timezone: 'Africa/Cairo', version: 1,
    })
    expect(store.records.get('v2Organizations/org-1/employment_profile/user-1')).toMatchObject({ workScheduleId: 'user-1', version: 2 })
  })

  it('keeps PII and compensation out of directory and HR projections by default', () => {
    const source = {
      userId: 'user-1', displayName: 'موظف', jobTitle: 'كاتب', departmentId: 'dep-1',
      employmentType: 'employee' as const, employmentStatus: 'active', managerUserId: 'manager-1',
      startDate: '2026-01-01', email: 'employee@example.com', phone: 'private-phone',
      compensation: { currency: 'EGP', amount: 100 },
    }
    expect(projectEmployeeFields(source, 'directory')).toEqual({
      userId: 'user-1', displayName: 'موظف', jobTitle: 'كاتب', departmentId: 'dep-1',
      employmentType: 'employee', employmentStatus: 'active',
    })
    expect(projectEmployeeFields(source, 'hr')).not.toHaveProperty('compensation')
    expect(projectEmployeeFields(source, 'compensation')).toHaveProperty('compensation')
  })
})
