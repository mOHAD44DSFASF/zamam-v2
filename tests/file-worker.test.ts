import { describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@zamam/domain'
import {
  FilePurgeHandler, FileScanHandler, LocalDeterministicScanner,
} from '../services/workers/src'

const event = (type: string, payload: Readonly<Record<string, unknown>>): OutboxEvent => ({
  id: 'event-1', organizationId: 'org-1', type, version: 1, payload,
  actorUserId: 'worker-1', correlationId: 'correlation-1', idempotencyKey: 'source-1',
  status: 'pending', attemptCount: 0, availableAt: '2026-07-30T10:00:00.000Z',
  createdAt: '2026-07-30T10:00:00.000Z',
})

describe('file background handlers', () => {
  it('scans deterministically and forwards immutable evidence to a trusted command', async () => {
    const record = vi.fn().mockResolvedValue(undefined)
    const handler = new FileScanHandler(new LocalDeterministicScanner(), { record })
    await handler.handle(event('file.scan_requested', {
      fileId: 'file-1', fileVersionId: 'version-1', objectKey: 'private-key',
    }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', fileId: 'file-1', fileVersionId: 'version-1',
      verdict: 'clean', reportHash: 'c'.repeat(64), sourceEventId: 'event-1',
    }))
  })
  it('fails closed when scanning is not configured', async () => {
    const handler = new FileScanHandler({
      configured: false,
      scan: vi.fn(),
    }, { record: vi.fn() })
    await expect(handler.handle(event('file.scan_requested', {
      fileId: 'file-1', fileVersionId: 'version-1', objectKey: 'private-key',
    }))).rejects.toThrow('MALWARE_SCANNER_NOT_CONFIGURED')
  })
  it('delegates purge completion idempotently by source event', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const handler = new FilePurgeHandler({ complete })
    await handler.handle(event('file.purge_requested', { fileId: 'file-1' }))
    expect(complete).toHaveBeenCalledWith({
      organizationId: 'org-1', fileId: 'file-1',
      correlationId: 'correlation-1', sourceEventId: 'event-1',
    })
  })
})
