import { Timestamp } from 'firebase-admin/firestore'
import { SCHEMA_VERSION, asUtcIsoString, type UtcIsoString } from '@zamam/domain'

export interface LegacyDocument { id: string; collection: string; data: Readonly<Record<string, unknown>> }
export interface MigrationFailure { collection: string; documentId: string; code: string }
export interface MigrationReport {
  migrationId: string
  schemaVersion: typeof SCHEMA_VERSION
  dryRun: boolean
  scanned: number
  valid: number
  written: number
  quarantined: number
  failures: readonly MigrationFailure[]
}

export interface MigrationPort {
  backupVerified(): Promise<boolean>
  pages(pageSize: number): AsyncIterable<readonly LegacyDocument[]>
  writeStaging(path: string, data: Readonly<Record<string, unknown>>, migrationId: string): Promise<'written' | 'already_applied'>
  rollbackStaging?(organizationId: string, migrationId: string, pageSize: number): Promise<number>
}

export async function rollbackStagingMigration(port: MigrationPort, options: Omit<MigrationOptions, 'dryRun'>) {
  if (options.environment !== 'local' && options.environment !== 'staging') throw new Error('PRODUCTION_MIGRATION_DENIED')
  if (!await port.backupVerified()) throw new Error('VERIFIED_BACKUP_REQUIRED')
  if (!port.rollbackStaging) throw new Error('ROLLBACK_ADAPTER_REQUIRED')
  const pageSize = options.pageSize ?? 100
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) throw new Error('INVALID_MIGRATION_PAGE_SIZE')
  return { migrationId: options.migrationId, removed: await port.rollbackStaging(options.organizationId, options.migrationId, pageSize) }
}

export interface MigrationOptions {
  migrationId: string
  organizationId: string
  environment: 'local' | 'staging'
  dryRun: boolean
  pageSize?: number
}

export function normalizeLegacyTimestamp(value: unknown): UtcIsoString {
  if (value instanceof Timestamp) return asUtcIsoString(value.toDate().toISOString())
  if (value instanceof Date) return asUtcIsoString(value.toISOString())
  if (typeof value === 'string') return asUtcIsoString(new Date(value).toISOString())
  throw new Error('UNSUPPORTED_LEGACY_TIMESTAMP')
}

export async function runMigrationPreview(
  port: MigrationPort,
  options: MigrationOptions,
  transform: (document: LegacyDocument, organizationId: string) => { kind: string; id: string; data: Readonly<Record<string, unknown>> },
): Promise<MigrationReport> {
  if (options.environment !== 'local' && options.environment !== 'staging') throw new Error('PRODUCTION_MIGRATION_DENIED')
  if (!options.dryRun && !await port.backupVerified()) throw new Error('VERIFIED_BACKUP_REQUIRED')
  const pageSize = options.pageSize ?? 100
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) throw new Error('INVALID_MIGRATION_PAGE_SIZE')

  let scanned = 0
  let valid = 0
  let written = 0
  const failures: MigrationFailure[] = []
  for await (const page of port.pages(pageSize)) {
    if (page.length > pageSize) throw new Error('UNBOUNDED_MIGRATION_PAGE')
    for (const document of page) {
      scanned += 1
      try {
        const transformed = transform(document, options.organizationId)
        if (!transformed.id || !transformed.kind || transformed.data.organizationId !== options.organizationId) {
          throw new Error('MIGRATION_TENANT_BOUNDARY_VIOLATION')
        }
        valid += 1
        if (!options.dryRun) {
          const outcome = await port.writeStaging(
            `v2Organizations/${options.organizationId}/${transformed.kind}/${transformed.id}`,
            { ...transformed.data, schemaVersion: SCHEMA_VERSION, migrationId: options.migrationId },
            options.migrationId,
          )
          if (outcome === 'written') written += 1
        }
      } catch (error) {
        failures.push({
          collection: document.collection,
          documentId: document.id,
          code: error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message) ? error.message : 'MIGRATION_TRANSFORM_FAILED',
        })
      }
    }
  }
  return {
    migrationId: options.migrationId,
    schemaVersion: SCHEMA_VERSION,
    dryRun: options.dryRun,
    scanned,
    valid,
    written,
    quarantined: failures.length,
    failures,
  }
}
