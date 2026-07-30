import type { Firestore } from 'firebase-admin/firestore'
import { PubSub } from '@google-cloud/pubsub'
import { FirebaseAtomicStore } from '@zamam/firestore'
import { createLogger } from '@zamam/observability'
import { DisabledAIProvider, type AIProvider } from './ai-gateway.js'
import { LocalEmailProvider, ResendEmailProvider, type EmailProvider } from './notification-delivery.js'
import { createEventHandlerRegistry } from './registry.js'
import { createFirestoreAiResultPort } from './platform/ai-result-port.js'
import { createFirestoreAutomationActionExecutor } from './platform/automation-executor.js'
import { createFileScanCommandPort, createFilePurgeCommandPort, createMalwareScanner } from './platform/file-commands.js'
import { createFirestoreNotificationAudiencePort, createFirestoreNotificationPreferencePort } from './platform/notification-audience.js'
import { createFirestoreNotificationDeliveryStore } from './platform/notification-delivery-store.js'
import { createNotificationRecipientDirectory } from './platform/notification-directory.js'
import { createFirestoreReportExportPort } from './platform/report-export-port.js'
import { assertProductionTransportConfigured, DisabledWorkerTransportPublisher, LocalWorkerTransportPublisher, PubSubWorkerTransportPublisher, type TransportEnv, type WorkerTransportEnvelope, type WorkerTransportPublisher } from './transport.js'

export interface WorkerEnv extends TransportEnv {
  ZAMAM_APP_BASE_URL?: string
  RESEND_API_KEY?: string
  EMAIL_FROM_ADDRESS?: string
  WORKER_INTERNAL_SHARED_SECRET?: string
  MALWARE_SCANNER_PROVIDER?: string
}

export interface WorkerRuntime {
  firestore: Firestore
  handlers: ReturnType<typeof createEventHandlerRegistry>
  automationExecutor: ReturnType<typeof createFirestoreAutomationActionExecutor>
  notificationDeliveryStore: (organizationId: string) => ReturnType<typeof createFirestoreNotificationDeliveryStore>
  emailProvider: EmailProvider
  transport: WorkerTransportPublisher
  sharedSecret: string | null
  logger: ReturnType<typeof createLogger>
  now: () => Date
}

function createEmailProvider(env: WorkerEnv): EmailProvider {
  if (env.RESEND_API_KEY && env.EMAIL_FROM_ADDRESS) return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM_ADDRESS)
  if (env.ZAMAM_ENV === 'production') return new ResendEmailProvider(undefined, '')
  return new LocalEmailProvider()
}

function createAiProvider(): AIProvider {
  // No real OpenAI-compatible client is wired yet (see BLK-002 report, "known gaps") — fails closed with
  // the same typed AI_PROVIDER_NOT_CONFIGURED the API layer already surfaces for AI_DISABLED.
  return new DisabledAIProvider()
}

function createTransport(env: WorkerEnv, onLocalMessage?: (envelope: WorkerTransportEnvelope) => Promise<void>): WorkerTransportPublisher {
  assertProductionTransportConfigured(env)
  const provider = env.WORKER_TRANSPORT_PROVIDER ?? (env.WORKER_PUBSUB_TOPIC ? 'pubsub' : 'local')
  if (provider === 'pubsub') {
    if (!env.WORKER_PUBSUB_TOPIC || !env.GOOGLE_CLOUD_PROJECT) return new DisabledWorkerTransportPublisher()
    const topic = new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT }).topic(env.WORKER_PUBSUB_TOPIC)
    return new PubSubWorkerTransportPublisher(topic, env.WORKER_PUBSUB_TOPIC)
  }
  return new LocalWorkerTransportPublisher(onLocalMessage)
}

export function composeWorkerRuntime(firestore: Firestore, env: WorkerEnv, onLocalMessage?: (envelope: WorkerTransportEnvelope) => Promise<void>): WorkerRuntime {
  const now = () => new Date()
  const logger = createLogger({ write: (record) => console.log(JSON.stringify(record)) })
  const store = new FirebaseAtomicStore(firestore)
  const handlers = createEventHandlerRegistry({
    store,
    malwareScanner: createMalwareScanner(env),
    fileScanCommands: createFileScanCommandPort(firestore),
    filePurgeCommands: createFilePurgeCommandPort(firestore),
    aiProvider: createAiProvider(),
    aiResults: createFirestoreAiResultPort(firestore),
    reportExport: createFirestoreReportExportPort(firestore),
    notificationAudiences: createFirestoreNotificationAudiencePort(firestore),
    notificationPreferences: createFirestoreNotificationPreferencePort(firestore),
    notificationClock: { now: () => now().toISOString() },
  })
  return {
    firestore,
    handlers,
    automationExecutor: createFirestoreAutomationActionExecutor(firestore),
    notificationDeliveryStore: (organizationId: string) => createFirestoreNotificationDeliveryStore(firestore, organizationId),
    emailProvider: createEmailProvider(env),
    transport: createTransport(env, onLocalMessage),
    sharedSecret: env.WORKER_INTERNAL_SHARED_SECRET ?? null,
    logger,
    now,
  }
}

export { createNotificationRecipientDirectory }
