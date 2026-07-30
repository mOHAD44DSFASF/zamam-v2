import { describe, expect, it } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { simulateWorkflowPaths, validateWorkflowDefinition, type WorkflowDefinition } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import { WorkflowBuilderService, type WorkflowBuilderAuthorizationGate, type WorkflowBuilderMetadata } from '../services/functions/src'

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
class Gate implements WorkflowBuilderAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
const principal: AuthorizationPrincipal = {
  userId: 'owner-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (): WorkflowBuilderMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
})
const definition: WorkflowDefinition = {
  startStageKey: 'brief',
  stages: [
    { key: 'brief', name: 'الملخص', type: 'work', terminal: false, slaMinutes: 60 },
    { key: 'review', name: 'المراجعة', type: 'review', terminal: false },
    { key: 'done', name: 'مكتمل', type: 'work', terminal: true },
  ],
  transitions: [
    { key: 'submit', from: 'brief', to: 'review', requiredPermission: 'task.transition' },
    { key: 'approve', from: 'review', to: 'done', requiredPermission: 'review.perform' },
    { key: 'rework', from: 'review', to: 'brief', requiredPermission: 'review.perform', condition: { field: 'review.result', operator: 'equals', value: 'changes_requested' } },
  ],
}

describe('workflow graph validation', () => {
  it('accepts reachable graphs with a terminal path and bounded rework loop simulation', () => {
    expect(validateWorkflowDefinition(definition)).toMatchObject({ valid: true, terminalStageKeys: ['done'] })
    expect(simulateWorkflowPaths(definition)).toContainEqual(['brief', 'review', 'done'])
  })

  it.each([
    [{ ...definition, startStageKey: 'missing' }, 'WORKFLOW_START_INVALID'],
    [{ ...definition, stages: [...definition.stages, { ...definition.stages[0]! }] }, 'WORKFLOW_STAGE_KEY_DUPLICATE'],
    [{ ...definition, stages: definition.stages.map((stage) => stage.key === 'review' ? { ...stage, terminal: true } : stage) }, 'WORKFLOW_TERMINAL_HAS_OUTGOING'],
    [{ ...definition, stages: [...definition.stages, { key: 'orphan', name: 'يتيم', type: 'work' as const, terminal: true }] }, 'WORKFLOW_STAGE_UNREACHABLE'],
  ])('rejects invalid graph invariant %#', (candidate, code) => {
    expect(validateWorkflowDefinition(candidate).errors).toContain(code)
  })
})

describe('workflow builder service', () => {
  it('creates a draft with validation evidence, then publishes an immutable snapshot', async () => {
    const store = new MemoryStore(); const gate = new Gate()
    const service = new WorkflowBuilderService(store, gate)
    await service.createDraft(metadata(), {
      templateId: 'template-1', draftVersionId: 'draft-1', name: 'سير المقال', definition,
    })
    const result = await service.publish(metadata(), {
      templateId: 'template-1', draftVersionId: 'draft-1', expectedTemplateVersion: 1,
      expectedDraftVersion: 1, publishedVersionId: 'version-1',
    })
    expect(result.result).toMatchObject({ publishedVersionId: 'version-1', versionNumber: 1 })
    expect(store.records.get('v2Organizations/org-1/workflow_version/version-1')).toMatchObject({
      status: 'published', versionNumber: 1, publishedBy: 'owner-1',
    })
    expect([...store.records.values()].filter((record) => record.workflowVersionId === 'version-1')).toHaveLength(6)
    expect(gate.requests.at(-1)).toMatchObject({ permission: 'workflow.publish', requireStepUp: true })
  })

  it('never permits editing a published workflow version', async () => {
    const store = new MemoryStore()
    store.records.set('v2Organizations/org-1/workflow_version/version-1', {
      organizationId: 'org-1', templateId: 'template-1', status: 'published', version: 1, definition,
    })
    await expect(new WorkflowBuilderService(store, new Gate()).updateDraft(metadata(), 'version-1', 1, definition))
      .rejects.toThrow('PUBLISHED_WORKFLOW_IMMUTABLE')
  })

  it('refuses invalid draft publication without partial stage records', async () => {
    const store = new MemoryStore(); const service = new WorkflowBuilderService(store, new Gate())
    const invalid = { ...definition, startStageKey: 'missing' }
    await service.createDraft(metadata(), { templateId: 'template-2', draftVersionId: 'draft-2', name: 'غير صالح', definition: invalid })
    await expect(service.publish(metadata(), {
      templateId: 'template-2', draftVersionId: 'draft-2', expectedTemplateVersion: 1,
      expectedDraftVersion: 1, publishedVersionId: 'version-2',
    })).rejects.toThrow('WORKFLOW_START_INVALID')
    expect([...store.records.keys()].some((path) => path.includes('version-2'))).toBe(false)
  })

  it('uses optimistic concurrency on draft edits', async () => {
    const store = new MemoryStore(); const service = new WorkflowBuilderService(store, new Gate())
    await service.createDraft(metadata(), { templateId: 'template-3', draftVersionId: 'draft-3', name: 'مسودة', definition })
    await service.updateDraft(metadata(), 'draft-3', 1, definition)
    await expect(service.updateDraft(metadata(), 'draft-3', 1, definition)).rejects.toThrow('VERSION_CONFLICT')
  })
})

