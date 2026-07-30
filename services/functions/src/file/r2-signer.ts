import { createHash, createHmac } from 'node:crypto'
import type {
  DownloadGrant, S3CompatibleSigner, StoredObjectMetadata, UploadGrant,
} from './storage.js'

export interface R2SignerConfig {
  accountId: string
  bucketName: string
  accessKeyId: string
  secretAccessKey: string
}
type FetchLike = typeof fetch

const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest()
const isoBasic = (date: Date) => date.toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15) + 'Z'
const canonicalUri = (bucketName: string, key: string) =>
  `/${awsEncode(bucketName)}/${key.split('/').map(awsEncode).join('/')}`
const canonicalQuery = (entries: Readonly<Record<string, string>>) =>
  Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join('&')

export class R2SigV4Signer implements S3CompatibleSigner {
  private readonly host: string
  constructor(
    private readonly config: R2SignerConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!/^[a-z0-9]{16,64}$/i.test(config.accountId)) throw new Error('R2_ACCOUNT_ID_INVALID')
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(config.bucketName)) throw new Error('R2_BUCKET_NAME_INVALID')
    if (!config.accessKeyId || !config.secretAccessKey) throw new Error('R2_CREDENTIALS_MISSING')
    this.host = `${config.accountId}.r2.cloudflarestorage.com`
  }

  private signingKey(dateStamp: string) {
    const dateKey = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp)
    const regionKey = hmac(dateKey, 'auto')
    const serviceKey = hmac(regionKey, 's3')
    return hmac(serviceKey, 'aws4_request')
  }

  private presign(input: {
    method: 'GET' | 'PUT'
    key: string
    expiresInSeconds: number
    headers?: Readonly<Record<string, string>>
    query?: Readonly<Record<string, string>>
  }) {
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds < 1 || input.expiresInSeconds > 900) {
      throw new Error('R2_SIGNED_EXPIRY_INVALID')
    }
    const at = this.now()
    const amzDate = isoBasic(at)
    const dateStamp = amzDate.slice(0, 8)
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const normalizedHeaders = Object.fromEntries(
      Object.entries({ host: this.host, ...(input.headers ?? {}) })
        .map(([key, value]) => [key.toLowerCase(), value.trim()]),
    )
    const headerNames = Object.keys(normalizedHeaders).sort()
    const signedHeaders = headerNames.join(';')
    const canonicalHeaders = headerNames.map((name) => `${name}:${normalizedHeaders[name]}\n`).join('')
    const query = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(input.expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
      ...(input.query ?? {}),
    }
    const canonical = canonicalQuery(query)
    const request = [
      input.method, canonicalUri(this.config.bucketName, input.key), canonical,
      canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD',
    ].join('\n')
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(request)].join('\n')
    const signature = createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex')
    return {
      url: `https://${this.host}${canonicalUri(this.config.bucketName, input.key)}?${canonical}&X-Amz-Signature=${signature}`,
      expiresAt: new Date(at.getTime() + input.expiresInSeconds * 1000).toISOString(),
    }
  }

  async signPut(input: {
    key: string; contentType: string; contentLength: number;
    checksumSha256: string; expiresInSeconds: number
  }): Promise<UploadGrant> {
    const requiredHeaders = {
      'content-type': input.contentType,
      'x-amz-meta-sha256': input.checksumSha256.toLowerCase(),
    }
    return {
      method: 'PUT',
      ...this.presign({
        method: 'PUT', key: input.key, expiresInSeconds: input.expiresInSeconds,
        headers: requiredHeaders,
      }),
      requiredHeaders,
    }
  }

  async signGet(input: {
    key: string; dispositionName: string; expiresInSeconds: number
  }): Promise<DownloadGrant> {
    return {
      method: 'GET',
      ...this.presign({
        method: 'GET', key: input.key, expiresInSeconds: input.expiresInSeconds,
        query: {
          'response-content-disposition': `attachment; filename*=UTF-8''${input.dispositionName}`,
        },
      }),
    }
  }

  private async signedRequest(method: 'HEAD' | 'DELETE', key: string) {
    const at = this.now()
    const amzDate = isoBasic(at)
    const dateStamp = amzDate.slice(0, 8)
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const payloadHash = hash('')
    const canonicalHeaders = `host:${this.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const request = [
      method, canonicalUri(this.config.bucketName, key), '', canonicalHeaders,
      signedHeaders, payloadHash,
    ].join('\n')
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(request)].join('\n')
    const signature = createHmac('sha256', this.signingKey(dateStamp)).update(stringToSign).digest('hex')
    return this.fetcher(`https://${this.host}${canonicalUri(this.config.bucketName, key)}`, {
      method,
      headers: {
        authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    })
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const response = await this.signedRequest('HEAD', key)
    if (response.status === 404) return null
    if (!response.ok) throw new Error('R2_INSPECT_FAILED')
    const sizeBytes = Number(response.headers.get('content-length'))
    const contentType = response.headers.get('content-type')
    const checksumSha256 = response.headers.get('x-amz-meta-sha256')
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !contentType || !checksumSha256) {
      throw new Error('R2_OBJECT_METADATA_INVALID')
    }
    return { objectKey: key, sizeBytes, contentType, checksumSha256 }
  }

  async remove(key: string) {
    const response = await this.signedRequest('DELETE', key)
    if (!response.ok && response.status !== 404) throw new Error('R2_DELETE_FAILED')
  }
}
