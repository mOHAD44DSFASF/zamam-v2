import { FileScanHandler, FilePurgeHandler, type FileScanCommandPort, type FilePurgeCommandPort, type MalwareScanner } from './file-processing.js'
import { AIGatewayJob, type AIProvider, type AIResultPort } from './ai-gateway.js'
import { ReportExportHandler, type ReportExportPort } from './report-export.js'
import { NotificationProjectionService, createNotificationProjectionHandlers, type NotificationAudiencePort, type NotificationPreferencePort, type NotificationClock } from './notification-projection.js'
import type { EventHandler } from './worker.js'
import type { AtomicStore } from '@zamam/firestore'

const NOTIFICATION_EVENT_TYPES = [
  'task.created', 'task.assigned', 'task.transitioned', 'task.overdue',
  'task.step_arrived', 'task.step_sent_back', 'task.step_reassigned',
  'review.requested', 'approval.requested', 'approval.completed',
  'comment.created', 'file.available', 'file.quarantined',
  'leave.requested', 'user.disabled', 'digest.daily',
] as const

export interface EventHandlerDeps {
  store: AtomicStore
  malwareScanner: MalwareScanner
  fileScanCommands: FileScanCommandPort
  filePurgeCommands: FilePurgeCommandPort
  aiProvider: AIProvider
  aiResults: AIResultPort
  reportExport: ReportExportPort
  notificationAudiences: NotificationAudiencePort
  notificationPreferences: NotificationPreferencePort
  notificationClock: NotificationClock
}

/** All outbox-event consumers wired to the worker transport (file scan/purge, AI gateway, report export,
 * notification projection). Automation execution is NOT here — it is trigger-matched against every event
 * regardless of type (see dispatch.ts), which the fixed eventType→handler lookup below cannot express. */
export function createEventHandlerRegistry(deps: EventHandlerDeps): readonly EventHandler[] {
  const notificationProjection = new NotificationProjectionService(
    deps.store, deps.notificationAudiences, deps.notificationPreferences, deps.notificationClock,
  )
  const aiJob = new AIGatewayJob(deps.aiProvider, deps.aiResults)
  return [
    new FileScanHandler(deps.malwareScanner, deps.fileScanCommands),
    new FilePurgeHandler(deps.filePurgeCommands),
    new ReportExportHandler(deps.reportExport),
    { eventType: 'ai.requested', handle: (event) => aiJob.handle(event) },
    ...createNotificationProjectionHandlers(notificationProjection, NOTIFICATION_EVENT_TYPES),
  ]
}
