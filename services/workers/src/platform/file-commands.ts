import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { FilePurgeCommandPort, FileScanCommandPort, MalwareScanner } from '../file-processing.js'
import { LocalDeterministicScanner } from '../file-processing.js'

const tenantPath = (organizationId: string, kind: string, id: string) => `v2Organizations/${organizationId}/${kind}/${id}`

/**
 * Mirrors the exact status transitions FileService.recordScanResult/completePurge (services/functions)
 * already define — those methods are unreachable from any HTTP route (file scanning/purging is
 * worker-initiated, not user-initiated), so the worker performs the same writes directly rather than
 * inventing new state-machine rules.
 */
export function createFileScanCommandPort(firestore: Firestore): FileScanCommandPort {
  return {
    async record(input) {
      await firestore.runTransaction(async (transaction) => {
        const versionPath = tenantPath(input.organizationId, 'file_version', input.fileVersionId)
        const versionSnapshot = await transaction.get(firestore.doc(versionPath))
        if (!versionSnapshot.exists) throw new Error('ENTITY_NOT_FOUND')
        const version = versionSnapshot.data()!
        if (version.status !== 'scanning') return
        const attachmentPath = tenantPath(input.organizationId, 'attachment', input.fileId)
        const attachmentSnapshot = await transaction.get(firestore.doc(attachmentPath))
        if (!attachmentSnapshot.exists) throw new Error('ENTITY_NOT_FOUND')
        const attachment = attachmentSnapshot.data()!
        const clean = input.verdict === 'clean'
        transaction.update(firestore.doc(versionPath), {
          scanStatus: input.verdict, scanReportHash: input.reportHash.toLowerCase(),
          status: clean ? 'available' : 'quarantined', version: Number(version.version) + 1, updatedAt: FieldValue.serverTimestamp(),
        })
        const previousAvailable = typeof attachment.latestVersionId === 'string'
        transaction.update(firestore.doc(attachmentPath), {
          status: clean || previousAvailable ? 'available' : 'quarantined', pendingVersionId: null,
          ...(clean ? { latestVersionId: input.fileVersionId, latestVersionNumber: version.versionNumber } : { lastQuarantinedVersionId: input.fileVersionId }),
          version: Number(attachment.version) + 1, updatedAt: FieldValue.serverTimestamp(),
        })
      })
    },
  }
}

export function createFilePurgeCommandPort(firestore: Firestore): FilePurgeCommandPort {
  return {
    async complete(input) {
      const path = tenantPath(input.organizationId, 'attachment', input.fileId)
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(firestore.doc(path))
        if (!snapshot.exists) throw new Error('ENTITY_NOT_FOUND')
        const data = snapshot.data()!
        if (data.retentionState !== 'purging') return
        transaction.update(firestore.doc(path), {
          status: 'purged', retentionState: 'purged', purgeCompletedAt: FieldValue.serverTimestamp(),
          version: Number(data.version) + 1, updatedAt: FieldValue.serverTimestamp(),
        })
      })
    },
  }
}

class DisabledMalwareScanner implements MalwareScanner {
  readonly configured = false
  async scan(): Promise<never> { throw new Error('MALWARE_SCANNER_NOT_CONFIGURED') }
}

/** Real malware-scanning providers are not wired yet (no MALWARE_SCANNER_PROVIDER adapter exists) — this
 * fails closed rather than silently approving every upload, except in local/dev where a deterministic
 * fake keeps the upload → scan → available flow testable end to end. */
export function createMalwareScanner(env: { ZAMAM_ENV?: string; MALWARE_SCANNER_PROVIDER?: string }): MalwareScanner {
  if (env.MALWARE_SCANNER_PROVIDER) throw new Error('MALWARE_SCANNER_PROVIDER_NOT_IMPLEMENTED')
  if (env.ZAMAM_ENV === 'production') return new DisabledMalwareScanner()
  return new LocalDeterministicScanner()
}
