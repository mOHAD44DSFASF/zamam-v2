import { getApps, initializeApp } from 'firebase-admin/app'
import { getAppCheck } from 'firebase-admin/app-check'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { createLogger } from '@zamam/observability'
import { createApi } from './api.js'
import { composeFeatureCommandDispatcher } from './compose.js'
import { createFeatureRoutes } from './feature-routes.js'
import { FirestoreIdempotencyStore, FirestoreOutboxPublisher, FirestoreRateLimiter } from '../platform/firestore-runtime.js'

if (getApps().length === 0) initializeApp()

const allowedOrigins = new Set(
  (process.env.ZAMAM_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
)

const firestore = getFirestore()
const apiHandler = createApi({
  allowedOrigins,
  routes: createFeatureRoutes(composeFeatureCommandDispatcher(firestore)),
  logger: createLogger({ write: (record) => console.log(JSON.stringify(record)) }),
  idempotencyStore: new FirestoreIdempotencyStore(firestore),
  outbox: new FirestoreOutboxPublisher(firestore),
  rateLimiter: new FirestoreRateLimiter(firestore),
  tokenVerifier: {
    async verify(token) {
      const decoded = await getAuth().verifyIdToken(token, true)
      return { userId: decoded.uid, tokenIssuedAt: decoded.iat, emailVerified: decoded.email_verified === true }
    },
  },
  appCheckVerifier: {
    async verify(token) {
      if (process.env.FUNCTIONS_EMULATOR === 'true' && token === 'emulator-app-check') return
      await getAppCheck().verifyToken(token)
    },
  },
})

export const api = onRequest({ region: 'us-central1', cors: false, timeoutSeconds: 30, memory: '256MiB' }, async (request, response) => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  const host = request.get('host') ?? 'localhost'
  const url = `https://${host}${request.originalUrl}`
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {})
  const init: RequestInit = { method: request.method, headers }
  if (body !== undefined) init.body = body
  const webResponse = await apiHandler(new Request(url, init))
  webResponse.headers.forEach((value, name) => response.setHeader(name, value))
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.status(webResponse.status).send(await webResponse.text())
})
