import { randomUUID } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { SENSITIVE_PERMISSIONS, type Permission } from '@zamam/authorization'
import { SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, type AtomicStore, type AtomicTransaction, type StoredDocument } from '@zamam/firestore'

export const SENSITIVE_COMMAND_AUDIT_MAP = Object.fromEntries(
  [...SENSITIVE_PERMISSIONS].map((permission) => [permission, `security.${permission}.executed`]),
) as Readonly<Record<Permission, string>>

export interface AuditedCommandContext {
  organizationId: string
  actorUserId: string
  permission: Permission
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

export interface AuditedMutation<TResult> {
  result: TResult
  resourceType: string
  resourceId: string
  beforeHash?: string
  afterHash?: string
  outbox: { type: string; version: number; payload: StoredDocument }
}

const tenantSystemPath = (organizationId: string, collection: string, id: string) => {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId) || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('INVALID_SYSTEM_RECORD_ID')
  return `v2Organizations/${organizationId}/${collection}/${id}`
}

function auditRecord(context: AuditedCommandContext, mutation: Omit<AuditedMutation<unknown>, 'result' | 'outbox'>, outcome: 'succeeded' | 'failed', sequence: number) {
  const hashes = {
    ...(mutation.beforeHash ? { beforeHash: mutation.beforeHash } : {}),
    ...(mutation.afterHash ? { afterHash: mutation.afterHash } : {}),
  }
  return {
    organizationId: context.organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
    sequence, eventType: SENSITIVE_COMMAND_AUDIT_MAP[context.permission] ?? `command.${context.permission}`,
    actorUserId: context.actorUserId, correlationId: context.correlationId,
    resourceType: mutation.resourceType, resourceId: mutation.resourceId, outcome,
    ...hashes,
    occurredAt: SERVER_TIMESTAMP, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
  }
}

async function nextAuditSequence(transaction: AtomicTransaction, organizationId: string) {
  const path = tenantSystemPath(organizationId, '_counters', 'audit-sequence')
  const current = await transaction.get(path)
  const sequence = typeof current?.value === 'number' ? current.value + 1 : 1
  const data = { organizationId, schemaVersion: SCHEMA_VERSION, value: sequence, updatedAt: SERVER_TIMESTAMP }
  if (current) transaction.update(path, data)
  else transaction.create(path, { ...data, createdAt: SERVER_TIMESTAMP })
  return sequence
}

export class AuditCommandService {
  constructor(private readonly store: AtomicStore, private readonly now: () => Date = () => new Date()) {}

  async replay<TResult>(context: Omit<AuditedCommandContext, 'permission'> & { permission?: Permission }) {
    const idempotencyPath = tenantSystemPath(context.organizationId, '_idempotency', context.idempotencyKey)
    return this.store.runTransaction(async (transaction) => {
      const existing = await transaction.get(idempotencyPath)
      if (!existing) return null
      if (existing.fingerprint !== context.fingerprint || existing.actorUserId !== context.actorUserId
        || (context.permission && existing.permission !== context.permission)) {
        throw new Error('IDEMPOTENCY_CONFLICT')
      }
      if (typeof existing.responseJson !== 'string') throw new Error('IDEMPOTENCY_IN_PROGRESS')
      return { result: JSON.parse(existing.responseJson) as TResult, replayed: true as const }
    })
  }

  async execute<TResult>(context: AuditedCommandContext, operation: (transaction: AtomicTransaction) => Promise<AuditedMutation<TResult>>): Promise<{ result: TResult; replayed: boolean }> {
    const idempotencyPath = tenantSystemPath(context.organizationId, '_idempotency', context.idempotencyKey)
    const sequencePath = tenantSystemPath(context.organizationId, '_counters', 'audit-sequence')
    try {
      return await this.store.runTransaction(async (transaction) => {
        const existing = await transaction.get(idempotencyPath)
        if (existing) {
          if (existing.fingerprint !== context.fingerprint || existing.actorUserId !== context.actorUserId || existing.permission !== context.permission) {
            throw new Error('IDEMPOTENCY_CONFLICT')
          }
          if (typeof existing.responseJson !== 'string') throw new Error('IDEMPOTENCY_IN_PROGRESS')
          return { result: JSON.parse(existing.responseJson) as TResult, replayed: true }
        }
        // Read the counter BEFORE calling operation() — operation's own callback (e.g. EmployeeService
        // commands) performs its own writes before returning, and Firestore transactions reject any read
        // that happens after a write has already been queued anywhere in the same transaction.
        const currentSequence = await transaction.get(sequencePath)

        const mutation = await operation(transaction)
        const sequence = typeof currentSequence?.value === 'number' ? currentSequence.value + 1 : 1
        const sequenceData = { organizationId: context.organizationId, schemaVersion: SCHEMA_VERSION, value: sequence, updatedAt: SERVER_TIMESTAMP }
        if (currentSequence) transaction.update(sequencePath, sequenceData)
        else transaction.create(sequencePath, { ...sequenceData, createdAt: SERVER_TIMESTAMP })
        const auditId = randomUUID()
        const outboxId = randomUUID()
        transaction.create(tenantSystemPath(context.organizationId, '_auditEvents', auditId), auditRecord(context, mutation, 'succeeded', sequence))
        transaction.create(tenantSystemPath(context.organizationId, '_outboxEvents', outboxId), {
          organizationId: context.organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          type: mutation.outbox.type, eventVersion: mutation.outbox.version, payload: mutation.outbox.payload,
          actorUserId: context.actorUserId, correlationId: context.correlationId, idempotencyKey: context.idempotencyKey,
          status: 'pending', attemptCount: 0, availableAt: SERVER_TIMESTAMP, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
        transaction.create(idempotencyPath, {
          organizationId: context.organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          permission: context.permission, fingerprint: context.fingerprint, actorUserId: context.actorUserId,
          responseJson: JSON.stringify(mutation.result), status: 'completed',
          expiresAt: Timestamp.fromDate(new Date(this.now().getTime() + 86_400_000)),
          createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
        return { result: mutation.result, replayed: false }
      })
    } catch (error) {
      if (error instanceof Error && (error.message === 'IDEMPOTENCY_CONFLICT' || error.message === 'IDEMPOTENCY_IN_PROGRESS')) throw error
      await this.appendFailure(context)
      throw error
    }
  }

  private appendFailure(context: AuditedCommandContext) {
    return this.store.runTransaction(async (transaction) => {
      const sequence = await nextAuditSequence(transaction, context.organizationId)
      const auditId = randomUUID()
      transaction.create(tenantSystemPath(context.organizationId, '_auditEvents', auditId), auditRecord(context, {
        resourceType: 'command', resourceId: context.idempotencyKey,
      }, 'failed', sequence))
    })
  }
}
