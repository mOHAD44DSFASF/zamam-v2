import { describe, expect, it, vi } from 'vitest'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { BootstrapOwnerService, type OwnerIdentityPort } from '../services/functions/src/organization/bootstrap-service'

/**
 * Enforces the real Firestore transaction rule ("all reads before any writes") that a plain Map-backed
 * fake would silently let slide — this is what actually catches an interleaved get/create regression
 * like the one in bootstrap-service.ts, instead of only exercising the happy path against a fake that
 * doesn't share Firestore's constraints.
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

function identities(userId = 'owner-user'): OwnerIdentityPort & {
  provisionInvitation: ReturnType<typeof vi.fn>
  setPassword: ReturnType<typeof vi.fn>
} {
  return {
    provisionInvitation: vi.fn().mockResolvedValue({ userId, created: true }),
    setPassword: vi.fn().mockResolvedValue(undefined),
  }
}

const input = {
  organizationId: 'org-1', organizationName: 'Zamam', organizationSlug: 'zamam',
  ownerEmail: '  Owner@Example.com ', ownerDisplayName: 'مالك النظام', ownerFirstName: 'مالك',
  ownerPassword: 'a-very-strong-password-1', timezone: 'Asia/Riyadh', locale: 'ar' as const,
}

describe('BootstrapOwnerService', () => {
  it('creates the organization, root department, active membership/employment, Owner role, and role assignment', async () => {
    const store = new MemoryStore()
    const identityPort = identities()
    const service = new BootstrapOwnerService(store, identityPort, () => new Date('2026-01-01T00:00:00.000Z'))

    const result = await service.bootstrap(input)

    expect(result).toMatchObject({
      organizationId: 'org-1', userId: 'owner-user', departmentId: 'root',
      roleId: 'default-owner', roleAssignmentId: 'owner-owner-user',
    })
    expect(result.actions).toEqual({
      organizationCreated: true, departmentCreated: true, membershipCreated: true,
      employmentCreated: true, roleCreated: true, roleAssignmentCreated: true,
      sessionViewCreated: true, passwordSet: true,
    })

    expect(store.records.get('v2Organizations/org-1/organization/org-1')).toMatchObject({ name: 'Zamam', slug: 'zamam', status: 'active' })
    expect(store.records.get('v2Organizations/org-1/department/root')).toMatchObject({ status: 'active' })
    expect(store.records.get('v2Organizations/org-1/organization_membership/owner-user')).toMatchObject({ status: 'active' })
    expect(store.records.get('v2Organizations/org-1/employment_profile/owner-user')).toMatchObject({ status: 'active', primaryDepartmentId: 'root' })
    const role = store.records.get('v2Organizations/org-1/role/default-owner')
    expect(role).toMatchObject({ name: 'Owner', status: 'active' })
    expect((role?.permissions as string[]).length).toBeGreaterThan(50)
    expect((role?.permissions as string[])).not.toContain('platform.health.view')
    expect(store.records.get('v2Organizations/org-1/role_assignment/owner-owner-user')).toMatchObject({
      userId: 'owner-user', roleId: 'default-owner', scopeType: 'organization', scopeId: 'org-1', effect: 'grant', status: 'active',
    })
    // This is what apps/web/src/auth/session-reader.ts reads to decide ProtectedRoute access — without it
    // the owner this run just created could never log in.
    expect(store.records.get('sessionViews/owner-user')).toEqual({
      userId: 'owner-user', displayName: 'مالك النظام', email: 'owner@example.com', accountStatus: 'active',
      memberships: [{ organizationId: 'org-1', status: 'active' }],
    })

    expect(identityPort.provisionInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@example.com' }))
    expect(identityPort.setPassword).toHaveBeenCalledWith('owner-user', input.ownerPassword)

    // Only the normalized email is ever stored (sessionViews), never the raw/dirty input string.
    expect(JSON.stringify([...store.records.values()])).not.toContain('Owner@Example.com')
  })

  it('is idempotent: running it again performs no new actions and does not duplicate or corrupt any record', async () => {
    const store = new MemoryStore()
    const identityPort = identities()
    const service = new BootstrapOwnerService(store, identityPort, () => new Date('2026-01-01T00:00:00.000Z'))

    await service.bootstrap(input)
    const snapshotAfterFirstRun = new Map(store.records)
    const second = await service.bootstrap(input)

    expect(second.actions).toEqual({
      organizationCreated: false, departmentCreated: false, membershipCreated: false,
      employmentCreated: false, roleCreated: false, roleAssignmentCreated: false,
      sessionViewCreated: false, passwordSet: true,
    })
    expect(store.records.size).toBe(snapshotAfterFirstRun.size)
    for (const [path, value] of snapshotAfterFirstRun) {
      expect(store.records.get(path)).toEqual(value)
    }
  })

  it('completes a partially-bootstrapped organization (e.g. org exists but role/assignment do not) without touching what already exists', async () => {
    const store = new MemoryStore()
    store.records.set('v2Organizations/org-1/organization/org-1', {
      organizationId: 'org-1', schemaVersion: 2, version: 5, name: 'Custom Existing Name', slug: 'zamam', status: 'active',
    })
    const identityPort = identities()
    const service = new BootstrapOwnerService(store, identityPort, () => new Date('2026-01-01T00:00:00.000Z'))

    const result = await service.bootstrap(input)

    expect(result.actions.organizationCreated).toBe(false)
    expect(result.actions.roleCreated).toBe(true)
    expect(result.actions.roleAssignmentCreated).toBe(true)
    expect(result.actions.sessionViewCreated).toBe(true)
    // The pre-existing organization record (with its own version/name) must not be overwritten.
    expect(store.records.get('v2Organizations/org-1/organization/org-1')).toMatchObject({ version: 5, name: 'Custom Existing Name' })
  })

  it('does not set a password when none is provided (e.g. the identity already has one)', async () => {
    const store = new MemoryStore()
    const identityPort = identities()
    const service = new BootstrapOwnerService(store, identityPort, () => new Date('2026-01-01T00:00:00.000Z'))
    const result = await service.bootstrap({ ...input, ownerPassword: undefined })
    expect(result.actions.passwordSet).toBe(false)
    expect(identityPort.setPassword).not.toHaveBeenCalled()
  })

  it('never reads after it has started writing within the transaction (real Firestore transactions reject that)', async () => {
    // MemoryStore's transaction fake throws FIRESTORE_TRANSACTION_READ_AFTER_WRITE the moment a get()
    // happens after a create()/update() — the same "all reads before any writes" rule the real Firestore
    // Admin SDK enforces. A full bootstrap touches all eight entities, so this exercises every read/write
    // pair the service performs.
    const store = new MemoryStore()
    const identityPort = identities()
    const service = new BootstrapOwnerService(store, identityPort, () => new Date('2026-01-01T00:00:00.000Z'))
    await expect(service.bootstrap(input)).resolves.toBeDefined()
  })
})
