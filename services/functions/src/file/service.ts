import type {
  AuthorizationPrincipal, AuthorizationRequest, Permission, ResourceAuthorizationContext,
} from '@zamam/authorization'
import { filePurgeAfter, privateObjectKey, SCHEMA_VERSION, validateFileUpload } from '@zamam/domain'
import {
  SERVER_TIMESTAMP, tenantDocumentPath,
  type AtomicStore, type AtomicTransaction, type PageQuery, type StoredDocument,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'
import type { PrivateObjectStorage } from '@zamam/workers'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const version = z.number().int().positive()
const resourceType = z.enum(['task', 'project'])
const visibility = z.enum(['internal', 'client'])
const prepareSchema = z.object({
  fileId: id, fileVersionId: id, resourceType, resourceId: id,
  displayName: z.string(), contentType: z.string(), sizeBytes: z.number(),
  checksumSha256: z.string(), visibility, expectedFileVersion: version.optional(),
}).strict()

export interface FileAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}
export interface FileResourcePort {
  resolve(organizationId: string, type: 'task' | 'project', id: string): Promise<ResourceAuthorizationContext | null>
}
export interface FileLookupPort {
  getAttachment(organizationId: string, fileId: string): Promise<StoredDocument | null>
  getVersion(organizationId: string, fileVersionId: string): Promise<StoredDocument | null>
  listVersions(organizationId: string, fileId: string): Promise<readonly StoredDocument[]>
}
export interface FileClock { now(): string }
export interface FileMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}
export interface ScannerResult { verdict: 'clean' | 'infected' | 'error'; reportHash: string }

const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const owned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}

export function buildFileLibraryQuery(input: {
  organizationId: string; principalType: 'member' | 'client';
  resourceType?: 'task' | 'project'; resourceId?: string;
  limit?: number; cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId)
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'attachment',
    filters: [
      { field: 'status', operator: '==', value: 'available' },
      { field: 'retentionState', operator: '==', value: 'active' },
      ...(input.principalType === 'client'
        ? [{ field: 'visibility', operator: '==', value: 'client' } as const] : []),
      ...(input.resourceType
        ? [{ field: 'resourceType', operator: '==', value: input.resourceType } as const] : []),
      ...(input.resourceId
        ? [{ field: 'resourceId', operator: '==', value: input.resourceId } as const] : []),
    ],
    orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export function buildFileCleanupQuery(input: {
  organizationId: string; now: string; limit?: number; cursor?: readonly unknown[]
}): PageQuery {
  id.parse(input.organizationId); z.string().datetime().parse(input.now)
  const limit = input.limit ?? 25
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('UNBOUNDED_QUERY_DENIED')
  return {
    organizationId: input.organizationId, entityKind: 'attachment',
    filters: [
      { field: 'retentionState', operator: '==', value: 'deleted' },
      { field: 'purgeAfter', operator: '<=', value: input.now },
    ],
    orderBy: [{ field: 'purgeAfter', direction: 'asc' }], limit,
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }
}

export class FileService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: FileAuthorizationGate,
    private readonly resources: FileResourcePort,
    private readonly lookup: FileLookupPort,
    private readonly storage: PrivateObjectStorage,
    private readonly clock: FileClock,
    audit?: AuditCommandService,
  ) { this.audit = audit ?? new AuditCommandService(store) }

  private async resource(metadata: FileMetadata, type: 'task' | 'project', resourceId: string) {
    const resource = await this.resources.resolve(metadata.organizationId, type, resourceId)
    if (!resource) throw new Error('ENTITY_NOT_FOUND')
    if (resource.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    return resource
  }
  private async context(
    metadata: FileMetadata, permission: Permission,
    resource: ResourceAuthorizationContext, requestedVisibility: 'internal' | 'client',
  ) {
    if (metadata.principal.principalType === 'client' && requestedVisibility !== 'client') {
      throw new Error('CLIENT_INTERNAL_FILE_DENIED')
    }
    if (requestedVisibility === 'client' && resource.visibility !== 'client') {
      throw new Error('CLIENT_FILE_RESOURCE_NOT_VISIBLE')
    }
    await this.authorization.require(metadata.principal, {
      permission, organizationId: metadata.organizationId,
      resource: { ...resource, visibility: requestedVisibility },
    })
    if (requestedVisibility === 'internal') {
      await this.authorization.require(metadata.principal, {
        permission: 'file.internal.view', organizationId: metadata.organizationId,
        resource: { ...resource, visibility: 'internal' },
      })
    }
    return {
      organizationId: metadata.organizationId, actorUserId: metadata.principal.userId,
      permission, correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
  }

  async prepareUpload(metadata: FileMetadata, raw: z.input<typeof prepareSchema>) {
    const input = prepareSchema.parse(raw)
    const descriptor = validateFileUpload(input)
    const resource = await this.resource(metadata, input.resourceType, input.resourceId)
    const existing = await this.lookup.getAttachment(metadata.organizationId, input.fileId)
    const permission: Permission = existing && Number(existing.latestVersionNumber) > 0
      ? 'file.version'
      : 'file.upload'
    const context = await this.context(metadata, permission, resource, input.visibility)
    const replay = await this.audit.replay<{
      fileId: string; fileVersionId: string; objectKey: string; versionNumber: number
    }>(context)
    if (replay) {
      const grant = await this.storage.issueUploadGrant({
        objectKey: replay.result.objectKey, contentType: descriptor.contentType,
        sizeBytes: descriptor.sizeBytes, checksumSha256: descriptor.checksumSha256,
        expiresInSeconds: 600,
      })
      return { ...replay, result: { ...replay.result, grant } }
    }
    if (existing) {
      if (
        existing.organizationId !== metadata.organizationId
        || existing.resourceType !== input.resourceType || existing.resourceId !== input.resourceId
        || existing.visibility !== input.visibility
      ) throw new Error('FILE_AGGREGATE_SCOPE_CONFLICT')
      if (existing.retentionState !== 'active') throw new Error('FILE_NOT_ACTIVE')
      if (
        existing.pendingVersionId !== input.fileVersionId
        && existing.version !== input.expectedFileVersion
      ) throw new Error('VERSION_CONFLICT')
    } else if (input.expectedFileVersion !== undefined) {
      throw new Error('FILE_AGGREGATE_NOT_FOUND')
    }
    const nextVersion = existing ? Number(existing.latestVersionNumber) + 1 : 1
    const objectKey = privateObjectKey(metadata.organizationId, input.fileId, nextVersion, input.fileVersionId)
    const command = await this.audit.execute(context, async (transaction) => {
      await owned(transaction, tenantDocumentPath(metadata.organizationId, input.resourceType, input.resourceId), metadata.organizationId)
      const attachmentPath = tenantDocumentPath(metadata.organizationId, 'attachment', input.fileId)
      const versionPath = tenantDocumentPath(metadata.organizationId, 'file_version', input.fileVersionId)
      if (await transaction.get(versionPath)) throw new Error('ENTITY_ALREADY_EXISTS')
      const current = await transaction.get(attachmentPath)
      if (current) {
        if (current.version !== input.expectedFileVersion) throw new Error('VERSION_CONFLICT')
        if (current.pendingVersionId) throw new Error('FILE_UPLOAD_ALREADY_PENDING')
        transaction.update(attachmentPath, {
          pendingVersionId: input.fileVersionId, status: 'pending_upload',
          version: Number(current.version) + 1, updatedAt: SERVER_TIMESTAMP,
        })
      } else {
        transaction.create(attachmentPath, {
          ...base(metadata.organizationId), resourceType: input.resourceType,
          resourceId: input.resourceId, fileId: input.fileId, displayName: descriptor.displayName,
          visibility: input.visibility, status: 'pending_upload', retentionState: 'active',
          latestVersionNumber: 0, pendingVersionId: input.fileVersionId,
          createdBy: metadata.principal.userId,
        })
      }
      transaction.create(versionPath, {
        ...base(metadata.organizationId), fileId: input.fileId, versionNumber: nextVersion,
        provider: this.storage.provider, objectKey, displayName: descriptor.displayName,
        sizeBytes: descriptor.sizeBytes, contentType: descriptor.contentType,
        checksumSha256: descriptor.checksumSha256, scanStatus: 'pending',
        status: 'pending_upload', uploadedBy: metadata.principal.userId,
      })
      return {
        result: { fileId: input.fileId, fileVersionId: input.fileVersionId, objectKey, versionNumber: nextVersion },
        resourceType: 'attachment', resourceId: input.fileId,
        outbox: { type: 'file.upload_prepared', version: 1, payload: { fileId: input.fileId, fileVersionId: input.fileVersionId } },
      }
    })
    const grant = await this.storage.issueUploadGrant({
      objectKey: command.result.objectKey, contentType: descriptor.contentType,
      sizeBytes: descriptor.sizeBytes, checksumSha256: descriptor.checksumSha256,
      expiresInSeconds: 600,
    })
    return { ...command, result: { ...command.result, grant } }
  }

  async finalizeUpload(metadata: FileMetadata, fileVersionId: string, expectedVersion: number) {
    id.parse(fileVersionId); version.parse(expectedVersion)
    const candidate = await this.lookup.getVersion(metadata.organizationId, fileVersionId)
    if (!candidate) throw new Error('ENTITY_NOT_FOUND')
    if (candidate.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    const attachment = await this.lookup.getAttachment(metadata.organizationId, String(candidate.fileId))
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const type = resourceType.parse(attachment.resourceType)
    const fileVisibility = visibility.parse(attachment.visibility)
    const resource = await this.resource(metadata, type, String(attachment.resourceId))
    const context = await this.context(metadata, 'file.upload', resource, fileVisibility)
    const replay = await this.audit.replay<{
      fileId: string; fileVersionId: string; status: 'scanning'
    }>(context)
    if (replay) return replay
    const object = await this.storage.inspect(String(candidate.objectKey))
    if (!object) throw new Error('FILE_OBJECT_NOT_FOUND')
    if (
      object.objectKey !== candidate.objectKey || object.sizeBytes !== candidate.sizeBytes
      || object.contentType !== candidate.contentType
      || object.checksumSha256.toLowerCase() !== String(candidate.checksumSha256).toLowerCase()
    ) throw new Error('FILE_OBJECT_METADATA_MISMATCH')
    return this.audit.execute(context, async (transaction) => {
      const versionPath = tenantDocumentPath(metadata.organizationId, 'file_version', fileVersionId)
      const current = await owned(transaction, versionPath, metadata.organizationId)
      if (current.version !== expectedVersion || current.status !== 'pending_upload') {
        throw new Error('FILE_FINALIZE_STATE_INVALID')
      }
      const attachmentPath = tenantDocumentPath(metadata.organizationId, 'attachment', String(current.fileId))
      const aggregate = await owned(transaction, attachmentPath, metadata.organizationId)
      if (aggregate.pendingVersionId !== fileVersionId) throw new Error('FILE_PENDING_VERSION_CONFLICT')
      transaction.update(versionPath, {
        status: 'scanning', scanStatus: 'pending',
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(attachmentPath, {
        status: 'scanning', version: Number(aggregate.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId: String(current.fileId), fileVersionId, status: 'scanning' as const },
        resourceType: 'file_version', resourceId: fileVersionId,
        outbox: {
          type: 'file.scan_requested', version: 1,
          payload: { fileId: String(current.fileId), fileVersionId, objectKey: String(current.objectKey) },
        },
      }
    })
  }

  async recordScanResult(
    metadata: FileMetadata, fileVersionId: string, expectedVersion: number, result: ScannerResult,
  ) {
    id.parse(fileVersionId); version.parse(expectedVersion)
    if (!/^[a-f0-9]{64}$/i.test(result.reportHash)) throw new Error('SCAN_REPORT_HASH_INVALID')
    const candidate = await this.lookup.getVersion(metadata.organizationId, fileVersionId)
    if (!candidate) throw new Error('ENTITY_NOT_FOUND')
    const attachment = await this.lookup.getAttachment(metadata.organizationId, String(candidate.fileId))
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const fileVisibility = visibility.parse(attachment.visibility)
    const context = await this.context(metadata, 'file.scan', resource, fileVisibility)
    return this.audit.execute(context, async (transaction) => {
      const versionPath = tenantDocumentPath(metadata.organizationId, 'file_version', fileVersionId)
      const current = await owned(transaction, versionPath, metadata.organizationId)
      if (current.version !== expectedVersion || current.status !== 'scanning') {
        throw new Error('FILE_SCAN_STATE_INVALID')
      }
      const attachmentPath = tenantDocumentPath(metadata.organizationId, 'attachment', String(current.fileId))
      const aggregate = await owned(transaction, attachmentPath, metadata.organizationId)
      const clean = result.verdict === 'clean'
      transaction.update(versionPath, {
        scanStatus: result.verdict, scanReportHash: result.reportHash.toLowerCase(),
        status: clean ? 'available' : 'quarantined',
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      const previousAvailable = typeof aggregate.latestVersionId === 'string'
      transaction.update(attachmentPath, {
        status: clean || previousAvailable ? 'available' : 'quarantined',
        pendingVersionId: null,
        ...(clean
          ? { latestVersionId: fileVersionId, latestVersionNumber: current.versionNumber }
          : { lastQuarantinedVersionId: fileVersionId }),
        version: Number(aggregate.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: {
          fileId: String(current.fileId), fileVersionId,
          status: clean ? 'available' as const : 'quarantined' as const,
        },
        resourceType: 'file_version', resourceId: fileVersionId,
        outbox: {
          type: clean ? 'file.available' : 'file.quarantined', version: 1,
          payload: { fileId: String(current.fileId), fileVersionId, verdict: result.verdict },
        },
      }
    })
  }

  async download(metadata: FileMetadata, fileId: string) {
    id.parse(fileId)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    if (attachment.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
    const fileVisibility = visibility.parse(attachment.visibility)
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const context = await this.context(metadata, 'file.download', resource, fileVisibility)
    const command = await this.audit.execute(context, async (transaction) => {
      const current = await owned(
        transaction, tenantDocumentPath(metadata.organizationId, 'attachment', fileId),
        metadata.organizationId,
      )
      if (current.status !== 'available' || current.retentionState !== 'active') {
        throw new Error('FILE_NOT_AVAILABLE')
      }
      const fileVersionId = String(current.latestVersionId)
      const currentVersion = await owned(
        transaction, tenantDocumentPath(metadata.organizationId, 'file_version', fileVersionId),
        metadata.organizationId,
      )
      if (currentVersion.status !== 'available' || currentVersion.scanStatus !== 'clean') {
        throw new Error('FILE_VERSION_NOT_AVAILABLE')
      }
      return {
        result: {
          fileId, fileVersionId, objectKey: String(currentVersion.objectKey),
          displayName: String(current.displayName),
        },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: 'file.downloaded', version: 1, payload: { fileId, fileVersionId } },
      }
    })
    const grant = await this.storage.issueDownloadGrant({
      objectKey: command.result.objectKey, displayName: command.result.displayName,
      expiresInSeconds: 300,
    })
    return { ...command, result: { fileId, fileVersionId: command.result.fileVersionId, grant } }
  }

  async delete(metadata: FileMetadata, fileId: string, expectedVersion: number) {
    id.parse(fileId); version.parse(expectedVersion)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const fileVisibility = visibility.parse(attachment.visibility)
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const context = await this.context(metadata, 'file.delete', resource, fileVisibility)
    if (attachment.createdBy !== metadata.principal.userId && metadata.principal.principalType === 'client') {
      throw new Error('FILE_OWNER_REQUIRED')
    }
    const purgeAfter = filePurgeAfter(this.clock.now())
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attachment', fileId)
      const current = await owned(transaction, path, metadata.organizationId)
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (current.retentionState === 'legal_hold') throw new Error('FILE_LEGAL_HOLD')
      if (current.status === 'purged') throw new Error('FILE_ALREADY_PURGED')
      transaction.update(path, {
        status: 'deleted', retentionState: 'deleted', deletedAt: SERVER_TIMESTAMP, purgeAfter,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId, status: 'deleted' as const, purgeAfter },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: 'file.deleted', version: 1, payload: { fileId, purgeAfter } },
      }
    })
  }

  async restore(metadata: FileMetadata, fileId: string, expectedVersion: number) {
    id.parse(fileId); version.parse(expectedVersion)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const fileVisibility = visibility.parse(attachment.visibility)
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const context = await this.context(metadata, 'file.restore', resource, fileVisibility)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attachment', fileId)
      const current = await owned(transaction, path, metadata.organizationId)
      if (current.version !== expectedVersion || current.retentionState !== 'deleted') {
        throw new Error('FILE_RESTORE_STATE_INVALID')
      }
      if (Date.parse(this.clock.now()) >= Date.parse(String(current.purgeAfter))) {
        throw new Error('FILE_RETENTION_EXPIRED')
      }
      transaction.update(path, {
        status: 'available', retentionState: 'active', deletedAt: null, purgeAfter: null,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId, status: 'available' as const },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: 'file.restored', version: 1, payload: { fileId } },
      }
    })
  }

  async setLegalHold(metadata: FileMetadata, fileId: string, expectedVersion: number, active: boolean) {
    id.parse(fileId); version.parse(expectedVersion)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const fileVisibility = visibility.parse(attachment.visibility)
    const context = await this.context(metadata, 'file.retention.manage', resource, fileVisibility)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attachment', fileId)
      const current = await owned(transaction, path, metadata.organizationId)
      if (current.version !== expectedVersion || ['purging', 'purged'].includes(String(current.retentionState))) {
        throw new Error('FILE_RETENTION_STATE_INVALID')
      }
      const nextState = active
        ? 'legal_hold'
        : current.status === 'deleted' ? 'deleted' : 'active'
      transaction.update(path, {
        retentionState: nextState, legalHoldAt: active ? SERVER_TIMESTAMP : null,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId, retentionState: nextState },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: `file.legal_hold.${active ? 'enabled' : 'disabled'}`, version: 1, payload: { fileId } },
      }
    })
  }

  async beginPurge(metadata: FileMetadata, fileId: string, expectedVersion: number) {
    id.parse(fileId); version.parse(expectedVersion)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const fileVisibility = visibility.parse(attachment.visibility)
    const context = await this.context(metadata, 'file.purge', resource, fileVisibility)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attachment', fileId)
      const current = await owned(transaction, path, metadata.organizationId)
      if (
        current.version !== expectedVersion || current.retentionState !== 'deleted'
        || Date.parse(this.clock.now()) < Date.parse(String(current.purgeAfter))
      ) throw new Error('FILE_PURGE_NOT_DUE')
      transaction.update(path, {
        retentionState: 'purging', purgeStartedAt: SERVER_TIMESTAMP,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId, status: 'purging' as const, version: expectedVersion + 1 },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: 'file.purge_requested', version: 1, payload: { fileId } },
      }
    })
  }

  async completePurge(metadata: FileMetadata, fileId: string, expectedVersion: number) {
    id.parse(fileId); version.parse(expectedVersion)
    const attachment = await this.lookup.getAttachment(metadata.organizationId, fileId)
    if (!attachment) throw new Error('ENTITY_NOT_FOUND')
    if (attachment.retentionState !== 'purging') throw new Error('FILE_PURGE_STATE_INVALID')
    const resource = await this.resource(
      metadata, resourceType.parse(attachment.resourceType), String(attachment.resourceId),
    )
    const fileVisibility = visibility.parse(attachment.visibility)
    const context = await this.context(metadata, 'file.purge', resource, fileVisibility)
    const replay = await this.audit.replay<{
      fileId: string; status: 'purged'; objectCount: number
    }>(context)
    if (replay) return replay
    const versions = await this.lookup.listVersions(metadata.organizationId, fileId)
    for (const item of versions) await this.storage.deleteObject(String(item.objectKey))
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'attachment', fileId)
      const current = await owned(transaction, path, metadata.organizationId)
      if (current.version !== expectedVersion || current.retentionState !== 'purging') {
        throw new Error('FILE_PURGE_STATE_INVALID')
      }
      transaction.update(path, {
        status: 'purged', retentionState: 'purged', purgeCompletedAt: SERVER_TIMESTAMP,
        version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { fileId, status: 'purged' as const, objectCount: versions.length },
        resourceType: 'attachment', resourceId: fileId,
        outbox: { type: 'file.purged', version: 1, payload: { fileId, objectCount: versions.length } },
      }
    })
  }
}
