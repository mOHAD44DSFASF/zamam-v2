import { describe, expect, it, vi } from 'vitest'
import { createFirestoreReportExportPort } from '../services/workers/src/platform/report-export-port'
import { LocalPrivateStorage } from '../services/workers/src'
import { ReportExportHandler } from '../services/workers/src'

function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  const firestore = {
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    doc: (path: string) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      update: async (patch: Record<string, unknown>) => {
        if (!docs.has(path)) throw new Error('NOT_FOUND')
        docs.set(path, { ...docs.get(path), ...patch })
      },
      set: async (data: Record<string, unknown>) => docs.set(path, data),
    }),
  } as unknown as import('firebase-admin/firestore').Firestore
  return { firestore, docs }
}

describe('report export storage (GAP 1)', () => {
  it('stores the CSV via the shared PrivateObjectStorage adapter and only then marks the job completed with a fileId', async () => {
    const { firestore, docs } = fakeFirestore()
    docs.set('v2Organizations/org-1/export_job/export-1', {
      organizationId: 'org-1', status: 'queued', reportType: 'operations',
    })
    const storage = new LocalPrivateStorage()
    const port = createFirestoreReportExportPort(firestore, storage)
    const handler = new ReportExportHandler({
      rows: async () => [{ id: 'task-1', title: 'Task One' }],
      complete: port.complete,
    })
    await handler.handle({
      id: 'event-1', organizationId: 'org-1',
      payload: { exportJobId: 'export-1', reportType: 'operations', scopeType: 'organization', scopeId: 'org-1', fields: ['id', 'title'] },
    })
    const job = docs.get('v2Organizations/org-1/export_job/export-1')
    expect(job).toMatchObject({ status: 'completed', rowCount: 1 })
    expect(typeof job?.fileId).toBe('string')
    const objectKey = job!.fileId as string
    expect(objectKey).toBe('tenants/org-1/exports/export-1.csv')
    const stored = storage.getBody(objectKey)
    expect(stored).not.toBeNull()
    expect(new TextDecoder().decode(stored!)).toContain('Task One')
    const metadata = await storage.inspect(objectKey)
    expect(metadata?.contentType).toContain('text/csv')
    expect(metadata?.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not mark the job completed when storage upload fails, so the outbox event retries/dead-letters instead', async () => {
    const { firestore, docs } = fakeFirestore()
    docs.set('v2Organizations/org-1/export_job/export-2', {
      organizationId: 'org-1', status: 'queued', reportType: 'operations',
    })
    const failingStorage = {
      provider: 'broken', configured: true,
      issueUploadGrant: vi.fn(), inspect: vi.fn(),
      issueDownloadGrant: vi.fn(), deleteObject: vi.fn(),
      putObject: vi.fn().mockRejectedValue(new Error('FILE_STORAGE_PUT_FAILED')),
    }
    const port = createFirestoreReportExportPort(firestore, failingStorage)
    const handler = new ReportExportHandler({
      rows: async () => [{ id: 'task-1', title: 'Task One' }],
      complete: port.complete,
    })
    await expect(handler.handle({
      id: 'event-1', organizationId: 'org-1',
      payload: { exportJobId: 'export-2', reportType: 'operations', scopeType: 'organization', scopeId: 'org-1', fields: ['id', 'title'] },
    })).rejects.toThrow('FILE_STORAGE_PUT_FAILED')
    expect(docs.get('v2Organizations/org-1/export_job/export-2')).toMatchObject({ status: 'queued' })
  })

  it('drives retry/dead-letter through the standard worker engine when the export job never completes', async () => {
    const { processOutboxEvent } = await import('../services/workers/src/worker')
    const failingHandler = {
      eventType: 'report.export_requested',
      handle: vi.fn().mockRejectedValue(new Error('FILE_STORAGE_PUT_FAILED')),
    }
    const store = {
      wasCompleted: vi.fn().mockResolvedValue(false),
      markCompleted: vi.fn(),
      scheduleRetry: vi.fn().mockResolvedValue(undefined),
      moveToDeadLetter: vi.fn().mockResolvedValue(undefined),
    }
    const event = {
      id: 'event-1', type: 'report.export_requested', version: 1, organizationId: 'org-1',
      actorUserId: 'user-1', correlationId: 'correlation-1', idempotencyKey: 'idem-1',
      payload: {}, status: 'pending' as const, attemptCount: 0,
      availableAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
    }
    const { createLogger } = await import('@zamam/observability')
    const result = await processOutboxEvent(event, [failingHandler], store, createLogger({ write: vi.fn() }), () => new Date('2026-01-01T00:00:00.000Z'))
    expect(result.status).toBe('retry_scheduled')
    expect(store.markCompleted).not.toHaveBeenCalled()
    expect(store.scheduleRetry).toHaveBeenCalled()
  })
})
