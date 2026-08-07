import { MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { employeeDirectoryClient } from '../employees/client'
import { buildWhatsappLink, buildWhatsappReminderMessage } from '../../lib/whatsapp'
import { PriorityBadge } from '../tasks/shared'
import type { DashboardSnapshot, DashboardTaskRow } from './client'

/**
 * Shared presentational pieces used by every dashboard scope view (OrganizationDashboard.tsx,
 * DepartmentDashboard.tsx, EmployeeDashboard.tsx) plus DashboardPage.tsx itself — kept in one file, owned
 * by the lead pass, so the three scope-specific subagents in Phase 4 build on one consistent vocabulary
 * instead of each restyling their own copy of the same card. See DESIGN.md for the token system.
 */

export function WhatsappButton({ row }: { row: DashboardTaskRow }) {
  if (row.currentStepAssigneeType === 'department') {
    return <span className="inline-flex items-center gap-1 text-caption font-semibold text-text-tertiary" title="خطوة مسندة لقسم — حدد شخصًا أولًا">
      <MessageCircle className="size-3.5" aria-hidden="true" /> واتساب (اختر شخصًا)
    </span>
  }
  if (!row.currentStepAssigneeWhatsapp) {
    return <span className="inline-flex items-center gap-1 text-caption font-semibold text-text-tertiary" title="لا يوجد رقم واتساب مسجل">
      <MessageCircle className="size-3.5" aria-hidden="true" /> واتساب (لا يوجد رقم)
    </span>
  }
  const href = buildWhatsappLink(row.currentStepAssigneeWhatsapp, buildWhatsappReminderMessage({
    taskTitle: row.title, ...(row.projectName ? { projectName: row.projectName } : {}),
    stepName: row.currentStepName, priority: row.priority, ...(row.currentStepDueAt ? { dueAt: row.currentStepDueAt } : {}),
  }))
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption font-semibold text-success hover:underline">
    <MessageCircle className="size-3.5" aria-hidden="true" /> إرسال تذكير واتساب
  </a>
}

export function TaskRowCard({ row, actions }: { row: DashboardTaskRow; actions?: React.ReactNode }) {
  return <article className={`rounded-md border p-3 text-body transition-colors ${row.stalled ? 'border-danger/40 bg-danger-subtle' : 'border-border-subtle bg-surface hover:bg-surface-hover'}`}>
    {/* The title/summary area opens the task's pipeline — kept as a plain block-level Link (no nested
        interactive elements inside it) rather than wrapping the whole card, since the WhatsApp button and
        any action buttons below need their own independent click targets. */}
    <Link to={`/tasks?task=${row.taskId}`} className="block rounded-sm outline-offset-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-text-primary">{row.title}</p>
        <div className="flex shrink-0 items-center gap-2">{row.stalled && <span className="rounded-sm bg-danger px-2 py-0.5 text-caption font-bold text-canvas">متعثرة</span>}<PriorityBadge priority={row.priority} /></div>
      </div>
      <p className="mt-1 text-label text-text-secondary">
        {row.projectName ? `${row.projectName} · ` : ''}الخطوة الحالية: {row.currentStepName}
        {row.currentStepDueAt ? ` · موعدها: ${row.currentStepDueAt.slice(0, 10)}` : ''}
      </p>
    </Link>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <WhatsappButton row={row} />
      {actions}
    </div>
  </article>
}

export function SummaryBar({ summary }: { summary: DashboardSnapshot['summary'] }) {
  // The stalled tile only earns danger-red once there's actually something stalled — at 0 it uses the same
  // neutral treatment as the other tiles, so the color stays a real signal instead of permanent noise.
  const stalledClasses = summary.stalledCount > 0
    ? 'rounded-md border border-danger/30 bg-danger-subtle p-4'
    : 'rounded-md border border-border-subtle bg-surface p-4'
  const stalledLabelClasses = summary.stalledCount > 0 ? 'text-label font-semibold text-danger' : 'text-label font-semibold text-text-secondary'
  const stalledValueClasses = summary.stalledCount > 0 ? 'mt-1 text-display font-extrabold text-danger' : 'mt-1 text-display font-extrabold text-text-primary'
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div className="rounded-md border border-border-subtle bg-surface p-4"><p className="text-label font-semibold text-text-secondary">إجمالي المهام النشطة</p><p className="mt-1 text-display font-extrabold text-text-primary">{summary.total}</p></div>
    <div className={stalledClasses}><p className={stalledLabelClasses}>مهام متعثرة</p><p className={stalledValueClasses}>{summary.stalledCount}</p></div>
    <div className="rounded-md border border-border-subtle bg-surface p-4"><p className="text-label font-semibold text-text-secondary">عاجلة</p><p className="mt-1 text-display font-extrabold text-text-primary">{summary.byPriority.urgent ?? 0}</p></div>
    <div className="rounded-md border border-border-subtle bg-surface p-4"><p className="text-label font-semibold text-text-secondary">قيد التنفيذ</p><p className="mt-1 text-display font-extrabold text-text-primary">{summary.byStatus.in_progress ?? 0}</p></div>
  </div>
}

export function WhatsappProfilePrompt({ organizationId, onSaved }: { organizationId: string; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return <form
    className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-subtle p-4 animate-banner-in"
    onSubmit={async (event) => {
      event.preventDefault()
      setSubmitting(true); setError('')
      try { await employeeDirectoryClient.updateOwnWhatsappPhone(organizationId, value); onSaved() }
      catch { setError('رقم غير صالح.') }
      finally { setSubmitting(false) }
    }}
  >
    <p className="flex-1 text-body font-semibold text-warning">حسابك بلا رقم واتساب مسجل — أضفه لتفعيل روابط التذكير.</p>
    <input required type="tel" placeholder="+9665xxxxxxxx" dir="ltr" value={value} onChange={(event) => setValue(event.target.value)} className="rounded-sm border border-warning/40 bg-surface px-3 py-1.5 text-body text-text-primary placeholder:text-text-tertiary" />
    <button type="submit" disabled={submitting} className="rounded-sm bg-warning px-3 py-1.5 text-label font-bold text-canvas disabled:opacity-50">{submitting ? 'جارٍ الحفظ...' : 'حفظ'}</button>
    {error && <span className="text-caption font-semibold text-danger">{error}</span>}
  </form>
}
