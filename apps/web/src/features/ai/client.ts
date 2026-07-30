import { appCheckHeaders, auth } from '../../lib/firebase'

export type AIPurpose = 'summarize' | 'draft' | 'suggest_actions'
export type AIClassification = 'operational_public' | 'internal' | 'client_confidential'
export interface AIProposalSummary {
  id: string
  actionType: string
  description: string
  riskLevel: 'low' | 'medium' | 'high'
  status: 'proposed' | 'approved' | 'rejected'
  argumentsHash: string
  version: number
}
export interface AIRequestSummary {
  id: string
  purpose: AIPurpose
  status: 'queued' | 'processing' | 'completed' | 'failed'
  summary: string | null
  createdAt: string
  proposals: readonly AIProposalSummary[]
}
export interface AISnapshot {
  provider: { configured: boolean; mode: 'disabled' | 'demo' | 'live'; name: string }
  policy: { enabled: boolean; proposalOnly: true; retentionHours: number; allowedClassifications: readonly AIClassification[] }
  capabilities: { request: boolean; approveProposal: boolean; viewHistory: boolean }
  requests: readonly AIRequestSummary[]
}
export interface AIClient {
  load(organizationId: string): Promise<AISnapshot>
  request(organizationId: string, input: { id: string; purpose: AIPurpose; content: string; classification: AIClassification }): Promise<void>
  decide(organizationId: string, input: { proposalId: string; expectedVersion: number; decision: 'approved' | 'rejected'; expectedHash: string }): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(),
      'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'AI_REQUEST_FAILED')
  return envelope.data
}
export const aiClient: AIClient = {
  load: (organizationId) => post('/v1/ai/query', { organizationId, limit: 20 }),
  request: (organizationId, input) => post('/v1/ai/request', { organizationId, ...input }),
  decide: (organizationId, input) => post('/v1/ai/proposals/decide', { organizationId, ...input }),
}
