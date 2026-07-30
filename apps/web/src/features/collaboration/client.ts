import { auth } from '../../lib/firebase'

export interface CollaborationComment {
  id: string
  authorName: string
  authorUserId: string
  body: string
  visibility: 'internal' | 'client'
  status: 'active' | 'deleted'
  createdAt: string
  editedAt: string | null
  version: number
  mine: boolean
  locked: boolean
  mentions: readonly { userId: string; displayName: string }[]
  reactions: readonly { type: 'like' | 'celebrate' | 'support' | 'insightful'; count: number; selected: boolean }[]
}
export interface CollaborationSnapshot {
  resource: { type: 'task' | 'project'; id: string; title: string; clientVisible: boolean }
  comments: readonly CollaborationComment[]
  mentionCandidates: readonly { userId: string; displayName: string }[]
  watched: boolean
  capabilities: {
    createInternal: boolean
    createClient: boolean
    updateOwn: boolean
    deleteOwn: boolean
    react: boolean
    watch: boolean
  }
}
export interface CollaborationClient {
  load(organizationId: string, resourceType: 'task' | 'project', resourceId: string): Promise<CollaborationSnapshot>
  create(organizationId: string, input: {
    resourceType: 'task' | 'project'; resourceId: string; body: string;
    visibility: 'internal' | 'client'; mentionedUserIds: readonly string[]
  }): Promise<void>
  tombstone(organizationId: string, commentId: string, expectedVersion: number): Promise<void>
  setReaction(organizationId: string, commentId: string, type: CollaborationComment['reactions'][number]['type'], active: boolean): Promise<void>
  setWatch(organizationId: string, taskId: string, active: boolean): Promise<void>
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
      ...(import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
        ? { 'x-firebase-appcheck': 'emulator-app-check' }
        : {}),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    throw new Error(envelope.error?.code ?? 'COLLABORATION_REQUEST_FAILED')
  }
  return envelope.data
}
export const collaborationClient: CollaborationClient = {
  load: (organizationId, resourceType, resourceId) =>
    post('/v1/collaboration/query', { organizationId, resourceType, resourceId, limit: 50 }),
  create: (organizationId, input) =>
    post('/v1/comments/create', { organizationId, id: crypto.randomUUID(), ...input }),
  tombstone: (organizationId, commentId, expectedVersion) =>
    post('/v1/comments/delete', { organizationId, commentId, expectedVersion }),
  setReaction: (organizationId, commentId, type, active) =>
    post('/v1/reactions/set', { organizationId, commentId, type, active }),
  setWatch: (organizationId, taskId, active) =>
    post('/v1/tasks/watch', { organizationId, taskId, active }),
}
