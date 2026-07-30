import { Timestamp } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'
import { ENTITY_DESCRIPTORS, SCHEMA_VERSION, asUtcIsoString, type TenantEntity } from '@zamam/domain'
import { SENSITIVE_PERMISSIONS } from '@zamam/authorization'
import {
  SERVER_TIMESTAMP,
  TenantRepository,
  createTenantBackup,
  decodeTenantDocument,
  encodeTenantDocument,
  projectFields,
  tenantDocumentPath,
  validateTenantRestore,
  type AtomicStore,
  type AtomicTransaction,
  type StoredDocument,
} from '@zamam/firestore'
import { AuditCommandService, SENSITIVE_COMMAND_AUDIT_MAP } from '../services/functions/src/audit/service'

class MemoryAtomicStore implements AtomicStore {
  records = new Map<string, StoredDocument>()

  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult> {
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

const timestamp = Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'))

describe('canonical schema and converters', () => {
  it('decodes Firestore Timestamps to canonical UTC and round-trips them', () => {
    const decoded = decodeTenantDocument<TenantEntity>('entity-1', {
      organizationId: 'org-1', schemaVersion: 2, version: 1, createdAt: timestamp, updatedAt: timestamp,
      completedAt: timestamp,
    }) as TenantEntity & { completedAt: string }
    expect(decoded.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(decoded.completedAt).toBe('2026-01-01T00:00:00.000Z')
    const encoded = encodeTenantDocument(decoded)
    expect(encoded.createdAt).toBeInstanceOf(Timestamp)
    expect(encoded.completedAt).toBeInstanceOf(Timestamp)
  })

  it('rejects Date objects, noncanonical timestamps, and missing tenant boundaries', () => {
    expect(() => asUtcIsoString('2026-01-01')).toThrow('INVALID_UTC_TIMESTAMP')
    expect(() => decodeTenantDocument('entity-1', { schemaVersion: 2, version: 1, createdAt: timestamp, updatedAt: timestamp })).toThrow()
    expect(() => encodeTenantDocument({
      id: 'entity-1', organizationId: 'org-1', schemaVersion: SCHEMA_VERSION, version: 1,
      createdAt: asUtcIsoString('2026-01-01T00:00:00.000Z'), updatedAt: asUtcIsoString('2026-01-01T00:00:00.000Z'),
      unsafe: new Date(),
    } as TenantEntity & { unsafe: Date })).toThrow('NON_CANONICAL_DATE')
  })

  it.each(ENTITY_DESCRIPTORS)('%s fixture is organization-bound and schema-versioned', (kind) => {
    const decoded = decodeTenantDocument(`${kind}-1`, {
      organizationId: 'org-1', schemaVersion: 2, version: 1, createdAt: timestamp, updatedAt: timestamp, kind,
    })
    expect(decoded.organizationId).toBe('org-1')
    expect(decoded.schemaVersion).toBe(2)
  })
})

describe('tenant repository invariants', () => {
  it('creates, version-checks, updates, and soft-archives without hard delete', async () => {
    const store = new MemoryAtomicStore()
    const repository = new TenantRepository(store)
    await repository.create('org-1', 'task', 'task-1', { title: 'Task' })
    const path = tenantDocumentPath('org-1', 'task', 'task-1')
    expect(store.records.get(path)).toMatchObject({ organizationId: 'org-1', schemaVersion: 2, version: 1, createdAt: SERVER_TIMESTAMP })
    await expect(repository.update('org-1', 'task', 'task-1', 2, { title: 'Wrong' })).rejects.toThrow('VERSION_CONFLICT')
    await repository.update('org-1', 'task', 'task-1', 1, { title: 'Updated' })
    expect(store.records.get(path)).toMatchObject({ title: 'Updated', version: 2 })
    await repository.archive('org-1', 'task', 'task-1', 2)
    expect(store.records.get(path)).toMatchObject({ deletedAt: SERVER_TIMESTAMP, version: 3 })
    await expect(repository.update('org-1', 'task', 'task-1', 3, { title: 'No' })).rejects.toThrow('ENTITY_ARCHIVED')
  })

  it('rejects immutable field changes and unbounded queries', async () => {
    const repository = new TenantRepository(new MemoryAtomicStore(), { list: async () => ({ items: [], nextCursor: null }) })
    await expect(repository.update('org-1', 'task', 'task-1', 1, { organizationId: 'org-2' })).rejects.toThrow('IMMUTABLE_FIELD')
    await expect(repository.list({ organizationId: 'org-1', entityKind: 'task', orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 101 })).rejects.toThrow('UNBOUNDED_QUERY_DENIED')
  })
})

describe('field projections', () => {
  it('returns allowlisted fields only and blocks secret-shaped fields', () => {
    const document = { id: 'task-1', title: 'Task', internalNotes: 'private', credentialReference: 'managed-reference' }
    expect(projectFields(document, ['id', 'title'])).toEqual({ id: 'task-1', title: 'Task' })
    expect(() => projectFields(document, ['credentialReference'])).toThrow('SENSITIVE_FIELD_PROJECTION_DENIED')
  })
})

describe('backup and restore rehearsal', () => {
  it('round-trips a bounded tenant export and rejects tampering/cross-tenant records', () => {
    const records = [{ path: 'v2Organizations/org-1/task/task-1', organizationId: 'org-1', data: { title: 'Task' } }]
    const bundle = createTenantBackup('org-1', records)
    expect(validateTenantRestore(bundle)).toEqual(records)
    expect(() => validateTenantRestore({ ...bundle, payload: `${bundle.payload}x` })).toThrow('BACKUP_CHECKSUM_MISMATCH')
    expect(() => createTenantBackup('org-1', [{ ...records[0], organizationId: 'org-2' }])).toThrow('BACKUP_TENANT_BOUNDARY_VIOLATION')
  })
})

describe('atomic audit/outbox foundation', () => {
  const context = {
    organizationId: 'org-1', actorUserId: 'user-1', permission: 'task.delete' as const,
    correlationId: 'correlation-1', idempotencyKey: 'idempotency-1', fingerprint: 'fingerprint-1',
  }

  it('covers every sensitive permission with an audit event type', () => {
    expect(Object.keys(SENSITIVE_COMMAND_AUDIT_MAP).sort()).toEqual([...SENSITIVE_PERMISSIONS].sort())
    expect(Object.values(SENSITIVE_COMMAND_AUDIT_MAP).every(Boolean)).toBe(true)
  })

  it('commits business mutation, audit, outbox, counter and idempotency atomically', async () => {
    const store = new MemoryAtomicStore()
    const service = new AuditCommandService(store, () => new Date('2026-01-01T00:00:00.000Z'))
    const operation = async (transaction: AtomicTransaction) => {
      transaction.create('v2Organizations/org-1/task/task-1', { organizationId: 'org-1', title: 'Task' })
      return {
        result: { taskId: 'task-1' }, resourceType: 'task', resourceId: 'task-1',
        outbox: { type: 'task.deleted', version: 1, payload: { taskId: 'task-1' } },
      }
    }
    expect(await service.execute(context, operation)).toEqual({ result: { taskId: 'task-1' }, replayed: false })
    expect(await service.execute(context, operation)).toEqual({ result: { taskId: 'task-1' }, replayed: true })
    const paths = [...store.records.keys()]
    expect(paths.filter((path) => path.includes('/_auditEvents/'))).toHaveLength(1)
    expect(paths.filter((path) => path.includes('/_outboxEvents/'))).toHaveLength(1)
    expect(paths.filter((path) => path.includes('/_idempotency/'))).toHaveLength(1)
    expect([...store.records.values()].filter((record) => record.organizationId !== 'org-1')).toHaveLength(0)
  })

  it('rolls back a failed business write and appends a separate failure audit', async () => {
    const store = new MemoryAtomicStore()
    const service = new AuditCommandService(store)
    await expect(service.execute({ ...context, idempotencyKey: 'idempotency-fail' }, async (transaction) => {
      transaction.create('v2Organizations/org-1/task/task-fail', { organizationId: 'org-1' })
      throw new Error('BUSINESS_FAILURE')
    })).rejects.toThrow('BUSINESS_FAILURE')
    expect(store.records.has('v2Organizations/org-1/task/task-fail')).toBe(false)
    const auditRecords = [...store.records.entries()].filter(([path]) => path.includes('/_auditEvents/'))
    expect(auditRecords).toHaveLength(1)
    expect(auditRecords[0]?.[1]).toMatchObject({ outcome: 'failed', organizationId: 'org-1' })
  })
})
