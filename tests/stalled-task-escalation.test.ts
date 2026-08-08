import { describe, expect, it } from 'vitest'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { StalledTaskEscalationService, type EscalationRecipientPort, type StalledTaskLookupPort, type StalledTaskRow } from '../services/workers/src/stalled-task-escalation'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => { if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}

const NOW = '2026-08-08T00:00:00.000Z' // isTaskStalled's default threshold is 3 days
const STALE_ENTERED = '2026-08-04T00:00:00.000Z' // 4 days before NOW -> stalled with no explicit due date
const FRESH_ENTERED = '2026-08-07T12:00:00.000Z' // ~12h before NOW -> not stalled

function tasks(rows: readonly StalledTaskRow[]): StalledTaskLookupPort {
  return { listInProgress: async () => rows }
}
function recipients(leadIds: readonly string[] = ['lead-1'], ownerIds: readonly string[] = ['owner-1', 'manager-1']): EscalationRecipientPort {
  return {
    activeDepartmentLeadIds: async () => leadIds,
    activeOrgOwnerAndManagerIds: async () => ownerIds,
  }
}
const clock = { now: () => NOW }

describe('StalledTaskEscalationService', () => {
  it('escalates a task stalled past the default 3-day threshold with no due date set', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-1', status: 'in_progress', currentStepOrder: 2, currentStepEnteredAt: STALE_ENTERED, currentStepAssigneeDepartmentId: 'dept-1' },
    ]), recipients(), clock)
    const result = await service.scan('org-1')
    expect(result).toMatchObject({ scanned: 1, alreadyStalled: 1, escalated: 1, skippedNoRecipients: 0 })
    const outbox = [...store.records.entries()].find(([path]) => path.includes('_outboxEvents'))?.[1]
    expect(outbox).toMatchObject({
      type: 'task.overdue',
      payload: { taskId: 'task-1', stepOrder: 2, recipientUserIds: expect.arrayContaining(['lead-1', 'owner-1', 'manager-1']), resourceType: 'task', resourceId: 'task-1' },
    })
    const marker = [...store.records.entries()].find(([path]) => path.includes('task_stall_escalation'))?.[1]
    expect(marker).toMatchObject({ taskId: 'task-1', stepOrder: 2 })
  })

  it('does not escalate a task still within the threshold', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-2', status: 'in_progress', currentStepOrder: 0, currentStepEnteredAt: FRESH_ENTERED },
    ]), recipients(), clock)
    const result = await service.scan('org-1')
    expect(result).toMatchObject({ scanned: 1, alreadyStalled: 0, escalated: 0 })
    expect(store.records.size).toBe(0)
  })

  it('escalates immediately once the step\'s own due date has passed, regardless of how long it has been current', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-3', status: 'in_progress', currentStepOrder: 0, currentStepEnteredAt: FRESH_ENTERED, currentStepDueAt: '2026-08-07T23:00:00.000Z' },
    ]), recipients(), clock)
    const result = await service.scan('org-1')
    expect(result.escalated).toBe(1)
  })

  it('fires only once per (task, step) — a second scan of the same still-stalled step is a no-op', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-4', status: 'in_progress', currentStepOrder: 1, currentStepEnteredAt: STALE_ENTERED },
    ]), recipients(), clock)
    expect((await service.scan('org-1')).escalated).toBe(1)
    expect((await service.scan('org-1')).escalated).toBe(0)
    const outboxCount = [...store.records.keys()].filter((path) => path.includes('_outboxEvents')).length
    expect(outboxCount).toBe(1)
  })

  it('escalates again if the SAME task stalls on a later step after the first escalation', async () => {
    const store = new MemoryStore()
    const serviceStep1 = new StalledTaskEscalationService(store, tasks([
      { id: 'task-5', status: 'in_progress', currentStepOrder: 1, currentStepEnteredAt: STALE_ENTERED },
    ]), recipients(), clock)
    expect((await serviceStep1.scan('org-1')).escalated).toBe(1)
    // task advances to step 2, and step 2 itself later stalls too
    const serviceStep2 = new StalledTaskEscalationService(store, tasks([
      { id: 'task-5', status: 'in_progress', currentStepOrder: 2, currentStepEnteredAt: STALE_ENTERED },
    ]), recipients(), clock)
    expect((await serviceStep2.scan('org-1')).escalated).toBe(1)
    const outboxCount = [...store.records.keys()].filter((path) => path.includes('_outboxEvents')).length
    expect(outboxCount).toBe(2)
  })

  it('skips (does not write anything) when there are no eligible recipients', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-6', status: 'in_progress', currentStepOrder: 0, currentStepEnteredAt: STALE_ENTERED },
    ]), recipients([], []), clock)
    const result = await service.scan('org-1')
    expect(result).toMatchObject({ escalated: 0, skippedNoRecipients: 1 })
    expect(store.records.size).toBe(0)
  })

  it('never escalates a task that is not in_progress (draft/blocked/completed/etc)', async () => {
    const store = new MemoryStore()
    const service = new StalledTaskEscalationService(store, tasks([
      { id: 'task-7', status: 'blocked', currentStepOrder: 0, currentStepEnteredAt: STALE_ENTERED },
    ]), recipients(), clock)
    expect((await service.scan('org-1')).escalated).toBe(0)
  })
})
