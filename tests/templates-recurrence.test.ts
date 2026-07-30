import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { nextRecurrenceOccurrence, planRecurrenceCatchUp } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  TemplateService, buildDueRecurrenceQuery,
  type TemplateAuthorizationGate, type TemplateMaterializer, type TemplateMetadata,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    let writeStarted = false
    const transaction: AtomicTransaction = {
      get: async (path) => { if (writeStarted) throw new Error(`FIRESTORE_TRANSACTION_READ_AFTER_WRITE: ${path}`); return working.get(path) ?? null },
      create: (path, data) => { writeStarted = true; if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, { ...data }) },
      update: (path, data) => { writeStarted = true; const current = working.get(path); if (!current) throw new Error('NOT_FOUND'); working.set(path, { ...current, ...data }) },
    }
    const result = await operation(transaction); this.records = working; return result
  }
}
class Gate implements TemplateAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
const principal: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): TemplateMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const materializer: TemplateMaterializer = {
  materialize: async (transaction, input) => {
    const resourceId = `generated-${input.runId}`
    transaction.create(`v2Organizations/${input.organizationId}/task/${resourceId}`, {
      organizationId: input.organizationId, templatePayload: input.templatePayload, occurrenceAt: input.occurrenceAt,
    })
    return { resourceType: input.templateType, resourceId }
  },
}
async function published(store: MemoryStore, gate = new Gate()) {
  const service = new TemplateService(store, gate, materializer)
  await service.create(metadata(), { id: 'template-1', name: 'مهمة أسبوعية', templateType: 'task', payload: { title: 'تقرير' } })
  await service.publish(metadata(), 'template-1', 1)
  return { service, gate }
}

describe('recurrence time model', () => {
  it('keeps a local daily time across a daylight-saving offset change', () => {
    const rule = { timezone: 'America/New_York', frequency: 'daily' as const, interval: 1, timeLocal: '09:00' }
    expect(nextRecurrenceOccurrence(rule, '2026-03-07T15:00:00.000Z')).toBe('2026-03-08T13:00:00.000Z')
  })

  it('supports weekly selected weekdays and strictly future occurrences', () => {
    const rule = { timezone: 'Africa/Cairo', frequency: 'weekly' as const, interval: 1, timeLocal: '09:00', daysOfWeek: [0, 4] }
    const next = nextRecurrenceOccurrence(rule, '2026-07-30T07:00:00.000Z')
    expect(Date.parse(next)).toBeGreaterThan(Date.parse('2026-07-30T07:00:00.000Z'))
  })

  it('bounds catch-up to ten logical occurrences', () => {
    const rule = { timezone: 'UTC', frequency: 'daily' as const, interval: 1, timeLocal: '09:00' }
    const plan = planRecurrenceCatchUp(rule, '2026-01-01T09:00:00.000Z', '2026-02-01T09:00:00.000Z')
    expect(plan.due).toHaveLength(10)
    expect(plan.truncated).toBe(true)
  })
})

describe('template and recurrence service', () => {
  it('publishes a versioned template only through step-up permission', async () => {
    const store = new MemoryStore(); const { gate } = await published(store)
    expect(store.records.get('v2Organizations/org-1/work_template/template-1')).toMatchObject({ status: 'published', version: 2 })
    expect(gate.requests.at(-1)).toMatchObject({ permission: 'template.publish', requireStepUp: true })
  })

  it('creates a schedule only from a published template', async () => {
    const store = new MemoryStore(); const { service } = await published(store)
    const result = await service.createSchedule(metadata(), {
      id: 'schedule-1', templateId: 'template-1',
      rule: { timezone: 'Africa/Cairo', frequency: 'daily', interval: 1, timeLocal: '09:00' },
      firstRunAfter: '2026-07-30T00:00:00.000Z', runAsUserId: 'service-1',
      scope: { type: 'project', id: 'project-1' },
    })
    expect(result.result.nextRunAt).toMatch(/Z$/)
    expect(store.records.get('v2Organizations/org-1/recurrence_schedule/schedule-1')).toMatchObject({
      status: 'active', runAsUserId: 'service-1', scopeType: 'project', scopeId: 'project-1',
    })
  })

  it('materializes one resource for one occurrence and advances the schedule', async () => {
    const store = new MemoryStore(); const { service } = await published(store)
    const scheduled = await service.createSchedule(metadata(), {
      id: 'schedule-2', templateId: 'template-1',
      rule: { timezone: 'UTC', frequency: 'daily', interval: 1, timeLocal: '09:00' },
      firstRunAfter: '2026-07-30T00:00:00.000Z', runAsUserId: 'service-1',
      scope: { type: 'project', id: 'project-1' },
    })
    const command = metadata()
    const first = await service.runOccurrence(command, 'schedule-2', scheduled.result.nextRunAt)
    const replay = await service.runOccurrence(command, 'schedule-2', scheduled.result.nextRunAt)
    expect(replay).toEqual({ ...first, replayed: true })
    expect([...store.records.keys()].filter((path) => path.includes('/recurrence_run/'))).toHaveLength(1)
    expect([...store.records.keys()].filter((path) => path.includes('/task/generated-'))).toHaveLength(1)
  })

  it('does not run a paused schedule and recomputes future time on resume', async () => {
    const store = new MemoryStore(); const { service } = await published(store)
    const scheduled = await service.createSchedule(metadata(), {
      id: 'schedule-3', templateId: 'template-1',
      rule: { timezone: 'UTC', frequency: 'daily', interval: 1, timeLocal: '09:00' },
      firstRunAfter: '2026-07-30T00:00:00.000Z', runAsUserId: 'service-1',
      scope: { type: 'organization', id: 'org-1' },
    })
    await service.setScheduleStatus(metadata(), 'schedule-3', 1, 'paused')
    await expect(service.runOccurrence(metadata(), 'schedule-3', scheduled.result.nextRunAt)).rejects.toThrow('RECURRENCE_NOT_ACTIVE')
    const resumed = await service.setScheduleStatus(metadata(), 'schedule-3', 2, 'active', '2026-08-01T10:00:00.000Z')
    expect(Date.parse(resumed.result.nextRunAt)).toBeGreaterThan(Date.parse('2026-08-01T10:00:00.000Z'))
  })

  it('builds a bounded oldest-first scheduler query', () => {
    expect(buildDueRecurrenceQuery({ organizationId: 'org-1', now: '2026-08-01T00:00:00.000Z' })).toMatchObject({
      entityKind: 'recurrence_schedule', limit: 50, orderBy: [{ field: 'nextRunAt', direction: 'asc' }],
    })
  })
})

