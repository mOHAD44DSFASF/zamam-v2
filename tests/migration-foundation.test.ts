import { Timestamp } from 'firebase-admin/firestore'
import { describe, expect, it, vi } from 'vitest'
import { normalizeLegacyTimestamp, rollbackStagingMigration, runMigrationPreview, type LegacyDocument, type MigrationPort } from '@zamam/firestore'

async function* pages(documents: readonly LegacyDocument[]) { yield documents }

const documents: LegacyDocument[] = [
  { id: 'task-1', collection: 'tasks', data: { title: 'Task' } },
  { id: 'task-2', collection: 'tasks', data: { title: 'Task 2' } },
]

const transform = (document: LegacyDocument, organizationId: string) => ({
  kind: 'task', id: document.id, data: { ...document.data, organizationId },
})

describe('migration foundation', () => {
  it('normalizes Date, Timestamp and ISO inputs to canonical UTC', () => {
    const expected = '2026-01-01T00:00:00.000Z'
    expect(normalizeLegacyTimestamp(new Date(expected))).toBe(expected)
    expect(normalizeLegacyTimestamp(Timestamp.fromDate(new Date(expected)))).toBe(expected)
    expect(normalizeLegacyTimestamp(expected)).toBe(expected)
  })

  it('performs a no-write dry run with counts', async () => {
    const writeStaging = vi.fn()
    const port: MigrationPort = { backupVerified: vi.fn().mockResolvedValue(false), pages: () => pages(documents), writeStaging }
    await expect(runMigrationPreview(port, {
      migrationId: 'migration-001', organizationId: 'org-1', environment: 'local', dryRun: true,
    }, transform)).resolves.toMatchObject({ scanned: 2, valid: 2, written: 0, quarantined: 0 })
    expect(writeStaging).not.toHaveBeenCalled()
  })

  it('requires a verified backup before staging writes', async () => {
    const port: MigrationPort = { backupVerified: vi.fn().mockResolvedValue(false), pages: () => pages(documents), writeStaging: vi.fn() }
    await expect(runMigrationPreview(port, {
      migrationId: 'migration-001', organizationId: 'org-1', environment: 'staging', dryRun: false,
    }, transform)).rejects.toThrow('VERIFIED_BACKUP_REQUIRED')
  })

  it('writes only bounded organization-owned staging records and supports idempotency', async () => {
    const writeStaging = vi.fn().mockResolvedValueOnce('written').mockResolvedValueOnce('already_applied')
    const port: MigrationPort = { backupVerified: vi.fn().mockResolvedValue(true), pages: () => pages(documents), writeStaging }
    const report = await runMigrationPreview(port, {
      migrationId: 'migration-001', organizationId: 'org-1', environment: 'staging', dryRun: false,
    }, transform)
    expect(report).toMatchObject({ scanned: 2, valid: 2, written: 1 })
    expect(writeStaging).toHaveBeenCalledWith(expect.stringMatching(/^v2Organizations\/org-1\/task\//), expect.objectContaining({ organizationId: 'org-1', schemaVersion: 2 }), 'migration-001')
  })

  it('quarantines a transformed record that crosses the tenant boundary', async () => {
    const port: MigrationPort = { backupVerified: vi.fn().mockResolvedValue(false), pages: () => pages(documents.slice(0, 1)), writeStaging: vi.fn() }
    const report = await runMigrationPreview(port, {
      migrationId: 'migration-001', organizationId: 'org-1', environment: 'local', dryRun: true,
    }, (document) => ({ kind: 'task', id: document.id, data: { organizationId: 'org-2' } }))
    expect(report).toMatchObject({ scanned: 1, valid: 0, quarantined: 1 })
  })

  it('requires backup and a staging-only adapter for bounded rollback', async () => {
    const rollbackStaging = vi.fn().mockResolvedValue(2)
    const port: MigrationPort = {
      backupVerified: vi.fn().mockResolvedValue(true), pages: () => pages([]), writeStaging: vi.fn(), rollbackStaging,
    }
    await expect(rollbackStagingMigration(port, {
      migrationId: 'migration-001', organizationId: 'org-1', environment: 'staging', pageSize: 100,
    })).resolves.toEqual({ migrationId: 'migration-001', removed: 2 })
    expect(rollbackStaging).toHaveBeenCalledWith('org-1', 'migration-001', 100)
  })
})
