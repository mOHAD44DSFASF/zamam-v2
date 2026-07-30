import { auth } from '../../lib/firebase'

export interface WorkflowStageInput {
  key: string; name: string; type: 'work' | 'review' | 'approval' | 'automation'; terminal: boolean; slaMinutes?: number
}
export interface WorkflowTransitionInput {
  key: string; from: string; to: string; requiredPermission: string
}
export interface WorkflowDefinitionInput {
  startStageKey: string; stages: readonly WorkflowStageInput[]; transitions: readonly WorkflowTransitionInput[]
}
export interface WorkflowBuilderSnapshot {
  template: { id: string; name: string; status: 'draft' | 'published'; version: number; latestVersionNumber: number }
  draft: { id: string; version: number; definition: WorkflowDefinitionInput; valid: boolean; errors: readonly string[] }
  capabilities: { manage: boolean; publish: boolean; simulate: boolean }
}
export interface WorkflowBuilderClient {
  load(organizationId: string, templateId: string): Promise<WorkflowBuilderSnapshot>
  updateDraft(organizationId: string, draftVersionId: string, expectedVersion: number, definition: WorkflowDefinitionInput): Promise<void>
  publish(organizationId: string, input: {
    templateId: string; draftVersionId: string; expectedTemplateVersion: number; expectedDraftVersion: number
  }): Promise<void>
  simulate(organizationId: string, definition: WorkflowDefinitionInput): Promise<{ paths: readonly (readonly string[])[]; errors: readonly string[] }>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL; const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      ...(import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ? { 'x-firebase-appcheck': 'emulator-app-check' } : {}),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'WORKFLOW_REQUEST_FAILED')
  return envelope.data
}
export const workflowBuilderClient: WorkflowBuilderClient = {
  load: (organizationId, templateId) => post('/v1/workflows/builder/query', { organizationId, templateId }),
  updateDraft: (organizationId, draftVersionId, expectedVersion, definition) =>
    post('/v1/workflows/drafts/update', { organizationId, draftVersionId, expectedVersion, definition }),
  publish: (organizationId, input) =>
    post('/v1/workflows/publish', { organizationId, ...input, publishedVersionId: crypto.randomUUID() }),
  simulate: (organizationId, definition) => post('/v1/workflows/simulate', { organizationId, definition }),
}

