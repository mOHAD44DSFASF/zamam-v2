import { tenantDocumentPath } from '@zamam/firestore'
import { PortalService, type PortalDataPort } from '../../portal/service.js'
import { FileService, type FileClock, type FileLookupPort, type FileResourcePort } from '../../file/service.js'
import { ReviewService, type ReviewClock, type ReviewEligibilityPort } from '../../review/service.js'
import type { Deps } from '../deps.js'
import { listQuery, readDoc, resolveTaskOrProjectResource } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

// v1 simplification: pending client approvals are resolved by joining review_request (visibility) with
// its approval records for a bounded set of the project's most-recent tasks, rather than a dedicated projection.
function createDataPort(deps: Deps): PortalDataPort {
  return {
    async contactForUser(organizationId, userId) {
      const page = await listQuery(deps, organizationId, 'client_contact', {
        filters: [{ field: 'userId', operator: '==', value: userId }], orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 1,
      })
      return page.items[0] ?? null
    },
    async projectMemberships(organizationId, userId) {
      const page = await listQuery(deps, organizationId, 'project_member', {
        filters: [{ field: 'userId', operator: '==', value: userId }], orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
      })
      return page.items
    },
    async projects(organizationId, projectIds) {
      if (!projectIds.length) return []
      const docs = await Promise.all(projectIds.map((id) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'project', id))))
      return docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null)
    },
    async projectItems(organizationId, projectId) {
      const [tasks, comments, files, deliveries] = await Promise.all([
        listQuery(deps, organizationId, 'task', {
          filters: [{ field: 'projectId', operator: '==', value: projectId }],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
        }),
        listQuery(deps, organizationId, 'comment', {
          filters: [
            { field: 'resourceType', operator: '==', value: 'project' }, { field: 'resourceId', operator: '==', value: projectId },
            { field: 'visibility', operator: '==', value: 'client' }, { field: 'status', operator: '==', value: 'active' },
          ],
          orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 100,
        }),
        listQuery(deps, organizationId, 'attachment', {
          filters: [
            { field: 'resourceType', operator: '==', value: 'project' }, { field: 'resourceId', operator: '==', value: projectId },
            { field: 'visibility', operator: '==', value: 'client' }, { field: 'status', operator: '==', value: 'available' },
          ],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100,
        }),
        listQuery(deps, organizationId, 'client_delivery', {
          filters: [{ field: 'projectId', operator: '==', value: projectId }, { field: 'status', operator: '==', value: 'available' }],
          orderBy: [{ field: 'deliveredAt', direction: 'desc' }], limit: 50,
        }),
      ])
      const taskIds = tasks.items.map((task) => String(task.id)).slice(0, 30)
      const approvals: Record<string, unknown>[] = []
      if (taskIds.length) {
        const requests = await listQuery<Record<string, unknown>>(deps, organizationId, 'review_request', {
          filters: [
            { field: 'taskId', operator: 'in', value: taskIds }, { field: 'visibility', operator: '==', value: 'client' },
            { field: 'status', operator: 'in', value: ['requested', 'in_review'] },
          ],
          orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
        })
        for (const request of requests.items) {
          const approvalIds = Array.isArray(request.approvalIds) ? request.approvalIds : []
          const approvalDocs = await Promise.all(approvalIds.map((id: string) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'approval', id))))
          for (const approval of approvalDocs) if (approval) approvals.push({
            ...approval, organizationId, visibility: 'client', title: request.subject ?? '', dueAt: request.dueAt ?? null,
          })
        }
      }
      return { tasks: tasks.items, comments: comments.items, files: files.items, approvals, deliveries: deliveries.items }
    },
  }
}

export function createPortalHandlers(deps: Deps): HandlerRegistry {
  const service = new PortalService(deps.store, deps.authorization, createDataPort(deps))
  const fileService = new FileService(
    deps.store, deps.authorization,
    { resolve: (organizationId, type, id) => resolveTaskOrProjectResource(deps, organizationId, type, id) } satisfies FileResourcePort,
    {
      getAttachment: (organizationId, fileId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'attachment', fileId)),
      getVersion: (organizationId, fileVersionId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'file_version', fileVersionId)),
      async listVersions() { return [] },
    } satisfies FileLookupPort,
    deps.storage,
    { now: () => new Date().toISOString() } satisfies FileClock,
  )
  const reviewEligibility: ReviewEligibilityPort = { async validateReviewers() { return { valid: true, errors: [] } } }
  const reviewService = new ReviewService(deps.store, deps.authorization, reviewEligibility, { now: () => new Date().toISOString() } satisfies ReviewClock)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.dashboard>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/portal/dashboard': (context) => service.dashboard(metadata(context)),
    '/v1/portal/projects/get': (context, input) => service.project(metadata(context), requireString(input, 'projectId')),
    '/v1/portal/requests/create': (context, input) => service.createRequest(metadata(context), {
      id: requireString(input, 'id'), projectId: requireString(input, 'projectId'),
      subject: requireString(input, 'subject'), description: requireString(input, 'description'),
    }),
    '/v1/portal/approvals/decide': (context, input) => reviewService.decide({
      organizationId: context.organizationId, principal: context.principal,
      correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
    }, {
      approvalId: requireString(input, 'approvalId'), expectedApprovalVersion: requireNumber(input, 'expectedApprovalVersion'),
      decision: requireString(input, 'decision') as 'approved' | 'rejected' | 'changes_requested',
      ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
    }),
    '/v1/portal/files/download': (context, input) => fileService.download(metadata(context), requireString(input, 'fileId')),
  }
}
