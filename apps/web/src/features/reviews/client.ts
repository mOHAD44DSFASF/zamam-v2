import { appCheckHeaders, auth } from '../../lib/firebase'

export interface ReviewInboxItem {
  approvalId: string
  approvalVersion: number
  reviewRequestId: string
  taskId: string
  taskTitle: string
  projectName: string
  requestedByName: string
  reviewedVersion: number
  round: number
  policy: 'single' | 'any' | 'all' | 'ordered'
  visibility: 'internal' | 'client'
  dueAt: string | null
  orderReady: boolean
}
export interface ReviewInboxSnapshot {
  items: readonly ReviewInboxItem[]
  capabilities: { decide: boolean; delegate: boolean }
}
export interface ReviewInboxClient {
  load(organizationId: string): Promise<ReviewInboxSnapshot>
  decide(organizationId: string, input: {
    approvalId: string
    expectedApprovalVersion: number
    decision: 'approved' | 'rejected' | 'changes_requested'
    reason?: string
  }): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL; const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'REVIEW_REQUEST_FAILED')
  return envelope.data
}
export const reviewInboxClient: ReviewInboxClient = {
  load: (organizationId) => post('/v1/reviews/inbox', { organizationId, limit: 50 }),
  decide: (organizationId, input) => post('/v1/reviews/decide', { organizationId, ...input }),
}
