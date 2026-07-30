import { describe, expect, it, vi } from 'vitest'
import { R2SigV4Signer } from '../services/functions/src'

const config = {
  accountId: '0123456789abcdef',
  bucketName: 'zamam-private',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-value',
}
const now = () => new Date('2026-07-30T10:00:00.000Z')

describe('R2 SigV4 storage adapter', () => {
  it('produces a deterministic bounded PUT without exposing the secret or filename', async () => {
    const signer = new R2SigV4Signer(config, vi.fn(), now)
    const grant = await signer.signPut({
      key: 'tenants/org-1/files/file-1/versions/1/version-1',
      contentType: 'application/pdf', contentLength: 20,
      checksumSha256: 'a'.repeat(64), expiresInSeconds: 600,
    })
    expect(grant.expiresAt).toBe('2026-07-30T10:10:00.000Z')
    expect(grant.url).toContain('X-Amz-Expires=600')
    expect(grant.url).toContain('X-Amz-Signature=')
    expect(grant.url).not.toContain(config.secretAccessKey)
    expect(grant.requiredHeaders).toEqual({
      'content-type': 'application/pdf', 'x-amz-meta-sha256': 'a'.repeat(64),
    })
  })
  it('rejects an unsafe grant lifetime', async () => {
    const signer = new R2SigV4Signer(config, vi.fn(), now)
    await expect(signer.signGet({
      key: 'private-key', dispositionName: 'brief.pdf', expiresInSeconds: 901,
    })).rejects.toThrow('R2_SIGNED_EXPIRY_INVALID')
  })
  it('authenticates HEAD and returns canonical metadata without real network access', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        'content-length': '2048', 'content-type': 'application/pdf',
        'x-amz-meta-sha256': 'b'.repeat(64),
      },
    }))
    const signer = new R2SigV4Signer(config, fetcher, now)
    await expect(signer.head('private-key')).resolves.toEqual({
      objectKey: 'private-key', sizeBytes: 2048,
      contentType: 'application/pdf', checksumSha256: 'b'.repeat(64),
    })
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('r2.cloudflarestorage.com'),
      expect.objectContaining({
        method: 'HEAD',
        headers: expect.objectContaining({ authorization: expect.stringContaining('AWS4-HMAC-SHA256') }),
      }),
    )
  })
  it('treats missing DELETE objects as an idempotent success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const signer = new R2SigV4Signer(config, fetcher, now)
    await expect(signer.remove('already-gone')).resolves.toBeUndefined()
  })
})
