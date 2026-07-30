import { createHash } from 'node:crypto'

export interface BackupRecord { path: string; organizationId: string; data: Readonly<Record<string, unknown>> }
export interface BackupBundle {
  manifest: { formatVersion: 1; organizationId: string; recordCount: number; sha256: string }
  payload: string
}

const hash = (payload: string) => createHash('sha256').update(payload).digest('hex')

export function createTenantBackup(organizationId: string, records: readonly BackupRecord[]): BackupBundle {
  const prefix = `v2Organizations/${organizationId}/`
  if (records.some((record) => record.organizationId !== organizationId || !record.path.startsWith(prefix))) {
    throw new Error('BACKUP_TENANT_BOUNDARY_VIOLATION')
  }
  const payload = [...records].sort((left, right) => left.path.localeCompare(right.path)).map((record) => JSON.stringify(record)).join('\n')
  return { manifest: { formatVersion: 1, organizationId, recordCount: records.length, sha256: hash(payload) }, payload }
}

export function validateTenantRestore(bundle: BackupBundle): readonly BackupRecord[] {
  if (hash(bundle.payload) !== bundle.manifest.sha256) throw new Error('BACKUP_CHECKSUM_MISMATCH')
  const records = bundle.payload ? bundle.payload.split('\n').map((line) => JSON.parse(line) as BackupRecord) : []
  if (records.length !== bundle.manifest.recordCount) throw new Error('BACKUP_COUNT_MISMATCH')
  const prefix = `v2Organizations/${bundle.manifest.organizationId}/`
  if (records.some((record) => record.organizationId !== bundle.manifest.organizationId || !record.path.startsWith(prefix))) {
    throw new Error('RESTORE_TENANT_BOUNDARY_VIOLATION')
  }
  return records
}
