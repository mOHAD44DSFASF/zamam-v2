import { tenantDocumentPath } from '@zamam/firestore'
import { FileService, buildFileLibraryQuery, type FileClock, type FileLookupPort, type FileResourcePort } from '../../file/service.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, readDoc, resolveTaskOrProjectResource } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createResourcePort(deps: Deps): FileResourcePort {
  return { resolve: (organizationId, type, id) => resolveTaskOrProjectResource(deps, organizationId, type, id) }
}

function createLookupPort(deps: Deps): FileLookupPort {
  return {
    getAttachment: (organizationId, fileId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'attachment', fileId)),
    getVersion: (organizationId, fileVersionId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'file_version', fileVersionId)),
    async listVersions(organizationId, fileId) {
      const page = await listQuery(deps, organizationId, 'file_version', {
        filters: [{ field: 'fileId', operator: '==', value: fileId }],
        orderBy: [{ field: 'versionNumber', direction: 'desc' }], limit: 50,
      })
      return page.items
    },
  }
}

const clock: FileClock = { now: () => new Date().toISOString() }

export function createFileHandlers(deps: Deps): HandlerRegistry {
  const service = new FileService(deps.store, deps.authorization, createResourcePort(deps), createLookupPort(deps), deps.storage, clock)
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.prepareUpload>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/files/query': async (context, input) => {
      const resourceType = typeof input.resourceType === 'string' ? (input.resourceType as 'task' | 'project') : undefined
      const resourceId = typeof input.resourceId === 'string' ? input.resourceId : undefined
      await deps.authorization.require(context.principal, {
        permission: context.principal.principalType === 'client' ? 'file.view' : 'file.internal.view',
        organizationId: context.organizationId,
      })
      const query = buildFileLibraryQuery({
        organizationId: context.organizationId,
        principalType: context.principal.principalType === 'client' ? 'client' : 'member',
        ...(resourceType ? { resourceType } : {}), ...(resourceId ? { resourceId } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(Array.isArray(input.cursor) ? { cursor: input.cursor } : {}),
      })
      const page = await deps.queries.list<Record<string, unknown>>(`v2Organizations/${context.organizationId}/attachment`, query)
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        upload: 'file.upload', shareWithClient: 'file.client.share', restore: 'file.restore',
      })
      return { items: page.items, nextCursor: page.nextCursor, capabilities }
    },
    '/v1/files/upload/prepare': (context, input) => service.prepareUpload(metadata(context), {
      fileId: requireString(input, 'fileId'), fileVersionId: requireString(input, 'fileVersionId'),
      resourceType: requireString(input, 'resourceType') as 'task' | 'project', resourceId: requireString(input, 'resourceId'),
      displayName: requireString(input, 'displayName'), contentType: requireString(input, 'contentType'),
      sizeBytes: requireNumber(input, 'sizeBytes'), checksumSha256: requireString(input, 'checksumSha256'),
      visibility: requireString(input, 'visibility') as 'internal' | 'client',
      ...(typeof input.expectedFileVersion === 'number' ? { expectedFileVersion: input.expectedFileVersion } : {}),
    }),
    '/v1/files/upload/finalize': (context, input) => service.finalizeUpload(
      metadata(context), requireString(input, 'fileVersionId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/files/delete': (context, input) => service.delete(
      metadata(context), requireString(input, 'fileId'), requireNumber(input, 'expectedVersion'),
    ),
    '/v1/files/download': (context, input) => service.download(metadata(context), requireString(input, 'fileId')),
  }
}
