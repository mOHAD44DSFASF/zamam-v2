import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { ReportExportPort } from '../report-export.js'

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

export function createFirestoreReportExportPort(firestore: Firestore): ReportExportPort {
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
    async complete(input) {
      await firestore.doc(`v2Organizations/${input.organizationId}/export_job/${input.exportJobId}`).update({
        status: 'completed', rowCount: input.rowCount, updatedAt: FieldValue.serverTimestamp(),
      })
      // The CSV itself is written to private object storage by a follow-on file upload, not modeled
      // here — export_job.fileId stays unset until that adapter exists (tracked as a known gap).
      void input.csv
    },
  }
}
