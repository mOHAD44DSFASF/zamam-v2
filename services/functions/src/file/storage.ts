export interface UploadGrant {
  method: 'PUT'
  url: string
  expiresAt: string
  requiredHeaders: Readonly<Record<string, string>>
}
export interface DownloadGrant { method: 'GET'; url: string; expiresAt: string }
export interface StoredObjectMetadata {
  objectKey: string
  sizeBytes: number
  contentType: string
  checksumSha256: string
}
export interface PrivateObjectStorage {
  readonly provider: string
  readonly configured: boolean
  issueUploadGrant(input: {
    objectKey: string; contentType: string; sizeBytes: number;
    checksumSha256: string; expiresInSeconds: number
  }): Promise<UploadGrant>
  inspect(objectKey: string): Promise<StoredObjectMetadata | null>
  issueDownloadGrant(input: {
    objectKey: string; displayName: string; expiresInSeconds: number
  }): Promise<DownloadGrant>
  deleteObject(objectKey: string): Promise<void>
}
export interface S3CompatibleSigner {
  signPut(input: {
    key: string; contentType: string; contentLength: number;
    checksumSha256: string; expiresInSeconds: number
  }): Promise<UploadGrant>
  head(key: string): Promise<StoredObjectMetadata | null>
  signGet(input: {
    key: string; dispositionName: string; expiresInSeconds: number
  }): Promise<DownloadGrant>
  remove(key: string): Promise<void>
}
export class S3CompatiblePrivateStorage implements PrivateObjectStorage {
  readonly provider: string
  readonly configured: boolean
  constructor(provider: 'r2' | 's3', private readonly signer: S3CompatibleSigner, configured: boolean) {
    this.provider = provider
    this.configured = configured
  }
  private assertConfigured() {
    if (!this.configured) throw new Error('FILE_STORAGE_NOT_CONFIGURED')
  }
  async issueUploadGrant(input: Parameters<PrivateObjectStorage['issueUploadGrant']>[0]) {
    this.assertConfigured()
    return this.signer.signPut({
      key: input.objectKey, contentType: input.contentType, contentLength: input.sizeBytes,
      checksumSha256: input.checksumSha256, expiresInSeconds: input.expiresInSeconds,
    })
  }
  async inspect(objectKey: string) { this.assertConfigured(); return this.signer.head(objectKey) }
  async issueDownloadGrant(input: Parameters<PrivateObjectStorage['issueDownloadGrant']>[0]) {
    this.assertConfigured()
    return this.signer.signGet({
      key: input.objectKey, dispositionName: input.displayName.replaceAll('"', ''),
      expiresInSeconds: input.expiresInSeconds,
    })
  }
  async deleteObject(objectKey: string) { this.assertConfigured(); await this.signer.remove(objectKey) }
}
export class LocalPrivateStorage implements PrivateObjectStorage {
  readonly provider = 'local'
  readonly configured = true
  readonly objects = new Map<string, StoredObjectMetadata>()
  async issueUploadGrant(input: Parameters<PrivateObjectStorage['issueUploadGrant']>[0]): Promise<UploadGrant> {
    return {
      method: 'PUT', url: `local-upload://${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      requiredHeaders: {
        'content-type': input.contentType,
        'x-zamam-checksum-sha256': input.checksumSha256,
      },
    }
  }
  async inspect(objectKey: string) { return this.objects.get(objectKey) ?? null }
  async issueDownloadGrant(input: Parameters<PrivateObjectStorage['issueDownloadGrant']>[0]): Promise<DownloadGrant> {
    if (!this.objects.has(input.objectKey)) throw new Error('FILE_OBJECT_NOT_FOUND')
    return {
      method: 'GET', url: `local-download://${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    }
  }
  async deleteObject(objectKey: string) { this.objects.delete(objectKey) }
  seed(metadata: StoredObjectMetadata) { this.objects.set(metadata.objectKey, metadata) }
}
