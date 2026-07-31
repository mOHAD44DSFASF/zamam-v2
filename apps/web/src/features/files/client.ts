import { appCheckHeaders, auth } from '../../lib/firebase'

export interface FileSummary {
  id: string
  displayName: string
  resourceType: 'task' | 'project'
  resourceId: string
  resourceTitle: string
  contentType: string
  sizeBytes: number
  visibility: 'internal' | 'client'
  status: 'pending_upload' | 'scanning' | 'available' | 'quarantined' | 'deleted'
  latestVersionNumber: number
  updatedAt: string
  version: number
  canDownload: boolean
  canDelete: boolean
}
export interface FileLibrarySnapshot {
  files: readonly FileSummary[]
  provider: { name: string; configured: boolean }
  capabilities: { upload: boolean; shareWithClient: boolean; restore: boolean }
}
interface UploadGrant {
  method: 'PUT'
  url: string
  expiresAt: string
  requiredHeaders: Readonly<Record<string, string>>
}
export interface FileLibraryClient {
  load(organizationId: string): Promise<FileLibrarySnapshot>
  upload(organizationId: string, input: {
    file: File; resourceType: 'task' | 'project'; resourceId: string;
    visibility: 'internal' | 'client'
  }): Promise<void>
  download(organizationId: string, fileId: string): Promise<{ url: string; expiresAt: string }>
  delete(organizationId: string, fileId: string, expectedVersion: number): Promise<void>
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) {
    throw new Error(envelope.error?.code ?? 'FILE_REQUEST_FAILED')
  }
  return envelope.data
}
async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
interface RawFileRow {
  id?: unknown; displayName?: unknown; resourceType?: unknown; resourceId?: unknown; contentType?: unknown
  sizeBytes?: unknown; visibility?: unknown; status?: unknown; latestVersionNumber?: unknown
  updatedAt?: unknown; version?: unknown
}

/**
 * `/v1/files/query` returns `{ items, nextCursor }` — raw attachment docs, not the FileLibrarySnapshot
 * (storage-provider status, capability flags, resource titles) this screen expects. Adapter maps the real
 * files into a valid snapshot; provider reported unconfigured/local, capabilities fail closed (backend
 * still enforces). Tracked as audit M1/M2.
 */
function toFileSnapshot(raw: { items?: readonly RawFileRow[]; capabilities?: FileLibrarySnapshot['capabilities'] }): FileLibrarySnapshot {
  const files: FileSummary[] = (raw.items ?? []).map((row) => ({
    id: String(row.id ?? ''), displayName: typeof row.displayName === 'string' ? row.displayName : '',
    resourceType: (row.resourceType === 'project' ? 'project' : 'task'), resourceId: String(row.resourceId ?? ''),
    resourceTitle: String(row.resourceId ?? ''), contentType: typeof row.contentType === 'string' ? row.contentType : '',
    sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
    visibility: (row.visibility === 'client' ? 'client' : 'internal'),
    status: (typeof row.status === 'string' ? row.status : 'available') as FileSummary['status'],
    latestVersionNumber: typeof row.latestVersionNumber === 'number' ? row.latestVersionNumber : 1,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    version: typeof row.version === 'number' ? row.version : 1, canDownload: false, canDelete: false,
  }))
  return { files, provider: { name: 'local', configured: false }, capabilities: raw.capabilities ?? { upload: false, shareWithClient: false, restore: false } }
}

export const fileLibraryClient: FileLibraryClient = {
  load: async (organizationId) => toFileSnapshot(await post('/v1/files/query', { organizationId, limit: 50 })),
  upload: async (organizationId, input) => {
    const fileId = crypto.randomUUID()
    const fileVersionId = crypto.randomUUID()
    const checksumSha256 = await sha256(input.file)
    const prepared = await post<{
      fileId: string; fileVersionId: string; versionNumber: number; grant: UploadGrant
    }>('/v1/files/upload/prepare', {
      organizationId, fileId, fileVersionId,
      resourceType: input.resourceType, resourceId: input.resourceId,
      displayName: input.file.name, contentType: input.file.type,
      sizeBytes: input.file.size, checksumSha256, visibility: input.visibility,
    })
    const uploaded = await fetch(prepared.grant.url, {
      method: prepared.grant.method,
      headers: prepared.grant.requiredHeaders,
      body: input.file,
    })
    if (!uploaded.ok) throw new Error('FILE_DIRECT_UPLOAD_FAILED')
    await post('/v1/files/upload/finalize', {
      organizationId, fileVersionId: prepared.fileVersionId, expectedVersion: 1,
    })
  },
  download: async (organizationId, fileId) => {
    const result = await post<{ grant: { url: string; expiresAt: string } }>(
      '/v1/files/download', { organizationId, fileId },
    )
    return result.grant
  },
  delete: (organizationId, fileId, expectedVersion) =>
    post('/v1/files/delete', { organizationId, fileId, expectedVersion }),
}
