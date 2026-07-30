import { appCheckHeaders } from '../lib/firebase'
interface ApiErrorBody { code?: string }

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!apiBaseUrl) throw new Error('AUTH_API_NOT_CONFIGURED')
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(), ...await appCheckHeaders() },
    body: JSON.stringify(body),
    credentials: 'omit',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as ApiErrorBody
    throw new Error(error.code ?? 'AUTH_REQUEST_FAILED')
  }
  return response.json() as Promise<T>
}

export function requestPasswordReset(email: string) {
  return post<{ accepted: true; messageCode: 'REQUEST_ACCEPTED' }>('/v1/auth/password-reset', { email })
}

export function acceptInvitation(invitationToken: string, password: string) {
  return post<{ accepted: true; messageCode: 'REQUEST_ACCEPTED' }>('/v1/auth/invitations/accept', {
    invitationToken,
    password,
    idempotencyKey: crypto.randomUUID(),
  })
}
