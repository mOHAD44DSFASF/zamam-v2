import { randomUUID } from 'node:crypto'
import { isTaskStalled, SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore } from '@zamam/firestore'

/**
 * Part 3A — automatic escalation for stalled tasks. Reuses isTaskStalled() (the exact same threshold logic
 * the dashboard already uses to compute stalled/summary.stalledCount at query time) and the existing
 * outbox → NotificationProjectionService → in-app/push pipeline (Part 2) rather than inventing a second
 * delivery path — this only decides WHEN to fire and WHO beyond the current-step holder should hear about
 * it, then emits one ordinary task.overdue outbox event exactly like any command-driven event.
 *
 * "Fire once" is a deterministic-create on a dedicated per-(task,step) doc, not a version bump on the task
 * itself — bumping the task's version here would race a user's own concurrent edit (VERSION_CONFLICT) for
 * no reason; task_stall_escalation is a marker collection nothing else ever touches.
 *
 * There is no cron/Cloud Scheduler wired to call scan() periodically, matching the exact same gap already
 * present for reconcileOutbox()/reconcileNotificationDeliveries() (see reconcile.ts) — provisioning that is
 * an infra/deploy decision outside this change, not new scheduling code to build from scratch. scan() is
 * exposed as a worker HTTP endpoint (POST /internal/scheduled/escalate-stalled-tasks) using the exact same
 * shared-secret auth as those two existing endpoints, ready for whatever external scheduler gets set up.
 */

export interface StalledTaskRow {
  id: string
  status: string
  currentStepOrder: number
  currentStepDueAt?: string | null
  currentStepEnteredAt?: string | null
  currentStepAssigneeDepartmentId?: string | null
  departmentId?: string | null
}
export interface StalledTaskLookupPort {
  listInProgress(organizationId: string, limit: number): Promise<readonly StalledTaskRow[]>
}
export interface EscalationRecipientPort {
  activeDepartmentLeadIds(organizationId: string, departmentId: string): Promise<readonly string[]>
  activeOrgOwnerAndManagerIds(organizationId: string): Promise<readonly string[]>
}
export interface EscalationClock { now(): string }

export interface StalledTaskEscalationResult { scanned: number; alreadyStalled: number; escalated: number; skippedNoRecipients: number }

export class StalledTaskEscalationService {
  constructor(
    private readonly store: AtomicStore,
    private readonly tasks: StalledTaskLookupPort,
    private readonly recipients: EscalationRecipientPort,
    private readonly clock: EscalationClock,
  ) {}

  async scan(organizationId: string, limit = 50): Promise<StalledTaskEscalationResult> {
    const now = Date.parse(this.clock.now())
    const rows = await this.tasks.listInProgress(organizationId, limit)
    const result: StalledTaskEscalationResult = { scanned: rows.length, alreadyStalled: 0, escalated: 0, skippedNoRecipients: 0 }
    for (const task of rows) {
      const stalled = isTaskStalled({
        status: task.status as never,
        currentStepDueAt: task.currentStepDueAt ?? null, currentStepEnteredAt: task.currentStepEnteredAt ?? null,
      }, now)
      if (!stalled) continue
      result.alreadyStalled += 1
      const departmentId = task.currentStepAssigneeDepartmentId ?? task.departmentId ?? null
      const [leadIds, ownerIds] = await Promise.all([
        departmentId ? this.recipients.activeDepartmentLeadIds(organizationId, departmentId) : Promise.resolve([]),
        this.recipients.activeOrgOwnerAndManagerIds(organizationId),
      ])
      const recipientUserIds = [...new Set([...leadIds, ...ownerIds])]
      if (recipientUserIds.length === 0) { result.skippedNoRecipients += 1; continue }
      const escalationId = `${task.id}-step-${task.currentStepOrder}`
      const escalated = await this.store.runTransaction(async (transaction) => {
        const escalationPath = tenantDocumentPath(organizationId, 'task_stall_escalation', escalationId)
        if (await transaction.get(escalationPath)) return false
        transaction.create(escalationPath, {
          organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          taskId: task.id, stepOrder: task.currentStepOrder,
          createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
        const outboxId = randomUUID()
        // _outboxEvents is a system collection, not a regular tenant entity kind — tenantDocumentPath()'s
        // second parameter is typed to TenantEntityKind, so this path is built the same way
        // AuditCommandService's own tenantSystemPath() builds it (services/functions/src/audit/service.ts).
        transaction.create(`v2Organizations/${organizationId}/_outboxEvents/${outboxId}`, {
          organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
          type: 'task.overdue', eventVersion: 1,
          payload: { taskId: task.id, stepOrder: task.currentStepOrder, recipientUserIds, resourceType: 'task', resourceId: task.id },
          actorUserId: 'system:stalled-task-escalation', correlationId: escalationId, idempotencyKey: escalationId,
          status: 'pending', attemptCount: 0, availableAt: SERVER_TIMESTAMP, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
        })
        return true
      })
      if (escalated) result.escalated += 1
    }
    return result
  }
}
