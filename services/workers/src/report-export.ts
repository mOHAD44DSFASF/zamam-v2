export const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function buildCsv(fields: readonly string[], rows: readonly Readonly<Record<string, unknown>>[]) {
  if (!fields.length || fields.length > 30) throw new Error('EXPORT_FIELDS_INVALID')
  if (rows.length > 10_000) throw new Error('EXPORT_ROW_LIMIT_EXCEEDED')
  return [fields.map(csvCell).join(','), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\r\n')
}
export interface ReportExportPort { rows(input: { organizationId: string; reportType: string; scopeType: string; scopeId: string; fields: readonly string[]; limit: number }): Promise<readonly Readonly<Record<string, unknown>>[]>; complete(input: { organizationId: string; exportJobId: string; csv: string; rowCount: number; sourceEventId: string }): Promise<void> }
export class ReportExportHandler {
  readonly eventType = 'report.export_requested'
  constructor(private readonly port: ReportExportPort) {}
  async handle(event: { id: string; organizationId: string | null; payload: unknown }) {
    if (!event.organizationId || !event.payload || typeof event.payload !== 'object') throw new Error('EXPORT_EVENT_INVALID')
    const payload = event.payload as Record<string, unknown>
    const fields = Array.isArray(payload.fields) ? payload.fields.filter((field): field is string => typeof field === 'string') : []
    const input = { organizationId: event.organizationId, reportType: String(payload.reportType), scopeType: String(payload.scopeType), scopeId: String(payload.scopeId), fields, limit: 10_000 }
    const rows = await this.port.rows(input)
    await this.port.complete({ organizationId: event.organizationId, exportJobId: String(payload.exportJobId), csv: buildCsv(fields, rows), rowCount: rows.length, sourceEventId: event.id })
  }
}
