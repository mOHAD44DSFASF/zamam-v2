import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { ReportExportPort } from '../report-export.js'
import type { PrivateObjectStorage } from './storage.js'

// v1 simplification: one entity collection per report type, filtered by the export's declared scope
// where the entity carries a matching field; mirrors the static allowlist already used at request time
// (services/functions/src/api/handlers/reporting.ts) rather than a general-purpose query planner.
const REPORT_COLLECTIONS: Readonly<Record<string, { kind: string; scopeField: string | null }>> = {
  operations: { kind: 'task', scopeField: 'projectId' },
  workload: { kind: 'capacity_plan', scopeField: 'scopeId' },
  time: { kind: 'time_entry', scopeField: 'userId' },
  attendance: { kind: 'attendance_record', scopeField: 'userId' },
  performance: { kind: 'kpi_measurement', scopeField: 'subjectId' },
}

const idPattern = /^[A-Za-z0-9_-]{2,128}$/
const exportObjectKey = (organizationId: string, exportJobId: string) => {
  if (!idPattern.test(organizationId) || !idPattern.test(exportJobId)) throw new Error('EXPORT_OBJECT_ID_INVALID')
  return `tenants/${organizationId}/exports/${exportJobId}.csv`
}

export function createFirestoreReportExportPort(firestore: Firestore, storage: PrivateObjectStorage): ReportExportPort {
  return {
    async rows(input) {
      const mapping = REPORT_COLLECTIONS[input.reportType]
      if (!mapping) throw new Error('REPORT_TYPE_UNSUPPORTED')
      let query: FirebaseFirestore.Query = firestore.collection(`v2Organizations/${input.organizationId}/${mapping.kind}`)
      if (mapping.scopeField && input.scopeType !== 'organization') query = query.where(mapping.scopeField, '==', input.scopeId)
      const snapshot = await query.limit(Math.min(input.limit, 10_000)).get()
      return snapshot.docs.map((doc) => {
        const data = doc.data()
        return Object.fromEntries(input.fields.map((field) => [field, field === 'id' ? doc.id : data[field]]))
      })
    },
    // Stores the CSV before marking the job completed. If putObject throws (storage misconfigured,
    // network failure, etc.), this whole handler call throws — ReportExportHandler never reaches the
    // Firestore update below, so the outbox event's normal retry/dead-letter path applies exactly like
    // any other handler failure; the job is left in its prior (non-completed) state for a retry to pick up.
    async complete(input) {
      const objectKey = exportObjectKey(input.organizationId, input.exportJobId)
      const body = new TextEncoder().encode(input.csv)
      const checksumSha256 = createHash('sha256').update(body).digest('hex')
      await storage.putObject({ objectKey, contentType: 'text/csv; charset=utf-8', body, checksumSha256 })
      await firestore.doc(`v2Organizations/${input.organizationId}/export_job/${input.exportJobId}`).update({
        status: 'completed', rowCount: input.rowCount, fileId: objectKey, updatedAt: FieldValue.serverTimestamp(),
      })
    },
  }
}
