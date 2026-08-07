import { getAuth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import { FirebaseAtomicStore, FirestorePageQueryStore } from '@zamam/firestore'
import { TrustedAuthorizationService } from '../authorization/service.js'
import { FirestorePolicyStore, FirestoreAuthorizationAuditPort } from '../authorization/firestore-policy-store.js'
import { FirestoreIdentityResolver } from '../platform/identity.js'
import { LocalPrivateStorage, S3CompatiblePrivateStorage, R2SigV4Signer } from '@zamam/workers'
import type { Deps } from './deps.js'
import type { HandlerRegistry } from './registry.js'
import { ComposedFeatureCommandDispatcher } from './dispatcher.js'
import { createOrganizationHandlers } from './handlers/organization.js'
import { createEmployeeHandlers } from './handlers/employee.js'
import { createClientHandlers } from './handlers/client.js'
import { createProjectHandlers } from './handlers/project.js'
import { createWorkspaceHandlers } from './handlers/workspace.js'
import { createTaskHandlers } from './handlers/task.js'
import { createWorkflowHandlers } from './handlers/workflow.js'
import { createReviewHandlers } from './handlers/review.js'
import { createTemplateHandlers } from './handlers/template.js'
import { createCollaborationHandlers } from './handlers/collaboration.js'
import { createFileHandlers } from './handlers/file.js'
import { createNotificationHandlers } from './handlers/notification.js'
import { createWorkloadHandlers } from './handlers/workload.js'
import { createTimeHandlers } from './handlers/time.js'
import { createAttendanceLeaveHandlers } from './handlers/attendance-leave.js'
import { createReportingHandlers } from './handlers/reporting.js'
import { createAutomationHandlers } from './handlers/automation.js'
import { createAiHandlers } from './handlers/ai.js'
import { createPortalHandlers } from './handlers/portal.js'
import { createAuthHandlers } from './handlers/auth.js'
import { createDashboardHandlers } from './handlers/dashboard.js'

function createStorage() {
  const accountId = process.env.R2_ACCOUNT_ID
  const bucketName = process.env.R2_BUCKET_NAME
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (accountId && bucketName && accessKeyId && secretAccessKey) {
    return new S3CompatiblePrivateStorage('r2', new R2SigV4Signer({ accountId, bucketName, accessKeyId, secretAccessKey }), true)
  }
  return new LocalPrivateStorage()
}

export function createDeps(firestore: Firestore): Deps {
  const policyStore = new FirestorePolicyStore(firestore)
  const auditPort = new FirestoreAuthorizationAuditPort(firestore)
  return {
    firestore,
    store: new FirebaseAtomicStore(firestore),
    queries: new FirestorePageQueryStore(firestore),
    authorization: new TrustedAuthorizationService(policyStore, auditPort),
    storage: createStorage(),
    now: () => new Date(),
  }
}

export function composeFeatureCommandDispatcher(firestore: Firestore) {
  const deps = createDeps(firestore)
  const registry: HandlerRegistry = {
    ...createOrganizationHandlers(deps),
    ...createEmployeeHandlers(deps),
    ...createClientHandlers(deps),
    ...createProjectHandlers(deps),
    ...createWorkspaceHandlers(deps),
    ...createTaskHandlers(deps),
    ...createWorkflowHandlers(deps),
    ...createReviewHandlers(deps),
    ...createTemplateHandlers(deps),
    ...createCollaborationHandlers(deps),
    ...createFileHandlers(deps),
    ...createNotificationHandlers(deps),
    ...createWorkloadHandlers(deps),
    ...createTimeHandlers(deps),
    ...createAttendanceLeaveHandlers(deps),
    ...createReportingHandlers(deps),
    ...createAutomationHandlers(deps),
    ...createAiHandlers(deps),
    ...createPortalHandlers(deps),
    ...createAuthHandlers(deps),
    ...createDashboardHandlers(deps),
  }
  const identity = new FirestoreIdentityResolver(firestore, getAuth())
  return new ComposedFeatureCommandDispatcher(registry, identity)
}
