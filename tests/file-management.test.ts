import { describe, expect, it } from 'vitest'
import type {
  AuthorizationPrincipal, AuthorizationRequest, ResourceAuthorizationContext,
} from '@zamam/authorization'
import { privateObjectKey, validateFileUpload } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  FileService, LocalPrivateStorage, buildFileCleanupQuery, buildFileLibraryQuery,
  type FileAuthorizationGate, type FileLookupPort, type FileMetadata, type FileResourcePort,
} from '../services/functions/src'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => {
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}
class Gate implements FileAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
  }
}
const member: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
const client: AuthorizationPrincipal = {
  ...member, userId: 'client-user-1', principalType: 'client',
  employmentStatus: 'not_applicable', clientAccountIds: ['client-1'],
}
let sequence = 0
const metadata = (principal = member): FileMetadata => ({
  organizationId: 'org-1', principal,
  correlationId: `correlation-${++sequence}`, idempotencyKey: `idempotency-${sequence}`,
  fingerprint: `fingerprint-${sequence}`,
})
const checksum = 'a'.repeat(64)
const upload = {
  fileId: 'file-1', fileVersionId: 'file-version-1',
  resourceType: 'task' as const, resourceId: 'task-1',
  displayName: 'brief.pdf', contentType: 'application/pdf',
  sizeBytes: 2048, checksumSha256: checksum, visibility: 'internal' as const,
}
function fixture(now = '2026-07-30T10:00:00.000Z') {
  const store = new MemoryStore()
  store.records.set('v2Organizations/org-1/task/task-1', {
    organizationId: 'org-1', version: 1, clientVisible: true,
  })
  const resources: FileResourcePort = {
    resolve: async (organizationId, type, resourceId) => {
      if (organizationId !== 'org-1' || type !== 'task' || resourceId !== 'task-1') return null
      const value: ResourceAuthorizationContext = {
        organizationId, type, id: resourceId, projectId: 'project-1',
        visibility: 'client', clientAccountId: 'client-1',
      }
      return value
    },
  }
  const lookup: FileLookupPort = {
    getAttachment: async (organizationId, fileId) =>
      store.records.get(`v2Organizations/${organizationId}/attachment/${fileId}`) ?? null,
    getVersion: async (organizationId, fileVersionId) =>
      store.records.get(`v2Organizations/${organizationId}/file_version/${fileVersionId}`) ?? null,
    listVersions: async (organizationId, fileId) => [...store.records.entries()]
      .filter(([path, item]) => path.startsWith(`v2Organizations/${organizationId}/file_version/`) && item.fileId === fileId)
      .map(([, item]) => item),
  }
  const gate = new Gate()
  const storage = new LocalPrivateStorage()
  return {
    store, resources, lookup, gate, storage,
    service: new FileService(store, gate, resources, lookup, storage, { now: () => now }),
  }
}
async function prepareAndSeed(context = fixture(), raw = upload) {
  const prepared = await context.service.prepareUpload(metadata(), raw)
  context.storage.seed({
    objectKey: prepared.result.objectKey, sizeBytes: raw.sizeBytes,
    contentType: raw.contentType, checksumSha256: raw.checksumSha256,
  })
  return { context, prepared }
}

describe('file domain and upload boundary', () => {
  it('enforces the approved size, MIME/extension, checksum, and opaque key policy', () => {
    expect(validateFileUpload({
      displayName: 'image.png', contentType: 'image/png',
      sizeBytes: 100 * 1024 * 1024, checksumSha256: checksum,
    }).displayName).toBe('image.png')
    expect(() => validateFileUpload({
      displayName: 'payload.exe', contentType: 'application/octet-stream',
      sizeBytes: 100, checksumSha256: checksum,
    })).toThrow('FILE_TYPE_DENIED')
    expect(() => validateFileUpload({
      displayName: 'large.pdf', contentType: 'application/pdf',
      sizeBytes: 100 * 1024 * 1024 + 1, checksumSha256: checksum,
    })).toThrow('FILE_SIZE_DENIED')
    expect(privateObjectKey('org-1', 'file-1', 1, 'version-1')).toBe(
      'tenants/org-1/files/file-1/versions/1/version-1',
    )
  })

  it('creates private metadata and a ten-minute signed upload grant without using the filename as key', async () => {
    const context = fixture()
    const command = metadata()
    const first = await context.service.prepareUpload(command, upload)
    const replay = await context.service.prepareUpload(command, upload)
    expect(replay.replayed).toBe(true)
    expect(first.result.objectKey).not.toContain('brief.pdf')
    expect(first.result.grant).toMatchObject({
      method: 'PUT',
      requiredHeaders: {
        'content-type': 'application/pdf',
        'x-zamam-checksum-sha256': checksum,
      },
    })
    expect(context.store.records.get('v2Organizations/org-1/attachment/file-1')).toMatchObject({
      status: 'pending_upload', retentionState: 'active', visibility: 'internal',
    })
  })

  it('denies an internal upload channel to client principals', async () => {
    const context = fixture()
    await expect(context.service.prepareUpload(metadata(client), upload))
      .rejects.toThrow('CLIENT_INTERNAL_FILE_DENIED')
  })

  it('rejects object metadata mismatches before scan enqueue', async () => {
    const context = fixture()
    const prepared = await context.service.prepareUpload(metadata(), upload)
    context.storage.seed({
      objectKey: prepared.result.objectKey, sizeBytes: upload.sizeBytes + 1,
      contentType: upload.contentType, checksumSha256: checksum,
    })
    await expect(context.service.finalizeUpload(metadata(), 'file-version-1', 1))
      .rejects.toThrow('FILE_OBJECT_METADATA_MISMATCH')
    expect(context.store.records.get('v2Organizations/org-1/file_version/file-version-1'))
      .toMatchObject({ status: 'pending_upload' })
  })
})

describe('scan, access, versions, and retention', () => {
  it('keeps every upload quarantined until a clean scan, then issues only short-lived downloads', async () => {
    const { context } = await prepareAndSeed()
    await context.service.finalizeUpload(metadata(), 'file-version-1', 1)
    await expect(context.service.download(metadata(), 'file-1')).rejects.toThrow('FILE_NOT_AVAILABLE')
    await context.service.recordScanResult(metadata(), 'file-version-1', 2, {
      verdict: 'clean', reportHash: 'b'.repeat(64),
    })
    const download = await context.service.download(metadata(), 'file-1')
    expect(download.result.grant).toMatchObject({ method: 'GET' })
    expect(download.result.grant.url.startsWith('local-download://')).toBe(true)
  })

  it('quarantines infected content and never creates a download grant', async () => {
    const { context } = await prepareAndSeed(fixture(), {
      ...upload, fileId: 'file-2', fileVersionId: 'file-version-2',
    })
    await context.service.finalizeUpload(metadata(), 'file-version-2', 1)
    await context.service.recordScanResult(metadata(), 'file-version-2', 2, {
      verdict: 'infected', reportHash: 'c'.repeat(64),
    })
    await expect(context.service.download(metadata(), 'file-2')).rejects.toThrow('FILE_NOT_AVAILABLE')
    expect(context.store.records.get('v2Organizations/org-1/file_version/file-version-2'))
      .toMatchObject({ status: 'quarantined', scanStatus: 'infected' })
  })

  it('retains the last clean version when a replacement is infected', async () => {
    const { context } = await prepareAndSeed()
    await context.service.finalizeUpload(metadata(), 'file-version-1', 1)
    await context.service.recordScanResult(metadata(), 'file-version-1', 2, {
      verdict: 'clean', reportHash: 'b'.repeat(64),
    })
    const second = {
      ...upload, fileVersionId: 'file-version-2', displayName: 'brief-v2.pdf',
      checksumSha256: 'd'.repeat(64), expectedFileVersion: 3,
    }
    const prepared = await context.service.prepareUpload(metadata(), second)
    context.storage.seed({
      objectKey: prepared.result.objectKey, sizeBytes: second.sizeBytes,
      contentType: second.contentType, checksumSha256: second.checksumSha256,
    })
    await context.service.finalizeUpload(metadata(), 'file-version-2', 1)
    await context.service.recordScanResult(metadata(), 'file-version-2', 2, {
      verdict: 'infected', reportHash: 'e'.repeat(64),
    })
    expect(context.store.records.get('v2Organizations/org-1/attachment/file-1')).toMatchObject({
      status: 'available', latestVersionId: 'file-version-1',
      lastQuarantinedVersionId: 'file-version-2',
    })
  })

  it('soft deletes for 30 days, restores before expiry, and purges through a locked two-phase saga', async () => {
    const prepared = await prepareAndSeed()
    const { context } = prepared
    await context.service.finalizeUpload(metadata(), 'file-version-1', 1)
    await context.service.recordScanResult(metadata(), 'file-version-1', 2, {
      verdict: 'clean', reportHash: 'b'.repeat(64),
    })
    const removed = await context.service.delete(metadata(), 'file-1', 3)
    expect(removed.result.purgeAfter).toBe('2026-08-29T10:00:00.000Z')
    await context.service.restore(metadata(), 'file-1', 4)
    await context.service.delete(metadata(), 'file-1', 5)
    const later = new FileService(
      context.store, context.gate, context.resources, context.lookup, context.storage,
      { now: () => '2026-08-30T10:00:00.000Z' },
    )
    const started = await later.beginPurge(metadata(), 'file-1', 6)
    expect(started.result).toMatchObject({ status: 'purging', version: 7 })
    const completed = await later.completePurge(metadata(), 'file-1', 7)
    expect(completed.result).toMatchObject({ status: 'purged', objectCount: 1 })
    expect(context.storage.objects.size).toBe(0)
  })

  it('uses bounded client-safe library and cleanup queries', () => {
    expect(buildFileLibraryQuery({
      organizationId: 'org-1', principalType: 'client',
    }).filters).toContainEqual({ field: 'visibility', operator: '==', value: 'client' })
    expect(buildFileCleanupQuery({
      organizationId: 'org-1', now: '2026-08-30T10:00:00.000Z',
    })).toMatchObject({ limit: 25, orderBy: [{ field: 'purgeAfter', direction: 'asc' }] })
  })
})
