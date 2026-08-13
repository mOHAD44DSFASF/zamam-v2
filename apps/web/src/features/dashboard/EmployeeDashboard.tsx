import { CheckCircle2, CheckSquare, Clock3, Undo2, UserRoundPen, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardSnapshot, DashboardTaskRow } from './client'
import { TaskRowCard } from './shared'

/**
 * Employee dashboard (dashboard scope === 'employee') — "مهامك الحالية" (they hold the current step right
 * now) and "قادمة إليك" (assigned to a future step) in two separate sections, each current-task card
 * carrying a direct إكمال الخطوة action plus an إرجاع خطوة link. DashboardPage.tsx renders the shared
 * summary bar, stalled-tasks section, and quick-action buttons above this and owns the completeStep
 * command — this component only renders the two sections and calls the handler it's given.
 *
 * Send-back needs a target-step picker and a reason, i.e. a real dialog, and this card has no room (or
 * step-name data) for one — so instead of a second, lesser dialog it deep-links to the Tasks page with
 * ?sendback=1, which opens the exact same SendBackDialog the Tasks page's own pipeline view uses
 * (see TasksListView.tsx). One dialog, reached two ways, not two implementations of the same action.
 *
 * "Current" vs. "upcoming" is the core distinction this screen exists to make (what needs action now vs.
 * what's coming): the current section gets the brand accent, a live count, and the action buttons; the
 * upcoming section is deliberately muted (tertiary icon/heading tone, no actions) so it reads as
 * read-only at a glance, not a second copy of the same list.
 */
export function EmployeeDashboardView({ snapshot, onCompleteStep }: {
  snapshot: DashboardSnapshot
  onCompleteStep: (row: DashboardTaskRow) => void
}) {
  const current = snapshot.currentTasks ?? []
  const upcoming = snapshot.upcomingTasks ?? []
  return <>
    <section aria-labelledby="current-heading" className="mt-8">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-400">
          <Zap className="size-4" aria-hidden="true" />
        </span>
        <h2 id="current-heading" className="text-h1 font-extrabold text-text-primary">مهامك الحالية</h2>
        {current.length > 0 && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-caption font-bold text-text-primary">{current.length}</span>}
      </div>
      <p className="mt-1 text-label text-text-secondary">بانتظار إجراء منك الآن.</p>

      {current.length > 0
        ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {current.map((row) => <TaskRowCard key={row.taskId} row={row} actions={<div className="flex gap-2">
              <button type="button" onClick={() => onCompleteStep(row)} className="inline-flex cursor-pointer items-center gap-1 rounded-sm bg-brand-500 px-2 py-1 text-caption font-bold text-text-primary transition-all duration-150 hover:bg-brand-400 active:scale-[0.98] active:bg-brand-600"><CheckSquare className="size-3.5" aria-hidden="true" /> إكمال الخطوة</button>
              {row.currentStepOrder > 0 && <Link to={`/tasks?task=${row.taskId}&sendback=1`} className="inline-flex items-center gap-1 rounded-sm border border-border-strong px-2 py-1 text-caption font-bold text-warning transition-all duration-150 hover:bg-surface-hover active:scale-[0.98]"><Undo2 className="size-3.5" aria-hidden="true" /> إرجاع خطوة</Link>}
              <Link to={`/tasks?task=${row.taskId}&reassign=1`} className="inline-flex items-center gap-1 rounded-sm border border-border-strong px-2 py-1 text-caption font-bold text-text-primary transition-all duration-150 hover:bg-surface-hover active:scale-[0.98]"><UserRoundPen className="size-3.5" aria-hidden="true" /> تحويل</Link>
            </div>} />)}
          </div>
        : <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface px-6 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-success-subtle text-success"><CheckCircle2 className="size-5" aria-hidden="true" /></span>
            <p className="text-h3 font-bold text-text-primary">أنت على اطلاع تام</p>
            <p className="max-w-sm text-label text-text-secondary">لا توجد خطوات بانتظار إجرائك حاليًا. ستظهر هنا فور وصول مهمة إليك.</p>
          </div>}
    </section>

    <section aria-labelledby="upcoming-heading" className="mt-8">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-hover text-text-tertiary">
          <Clock3 className="size-4" aria-hidden="true" />
        </span>
        <h2 id="upcoming-heading" className="text-h1 font-extrabold text-text-secondary">قادمة إليك</h2>
        {upcoming.length > 0 && <span className="rounded-full bg-surface-hover px-2 py-0.5 text-caption font-bold text-text-tertiary">{upcoming.length}</span>}
      </div>
      <p className="mt-1 text-label text-text-secondary">للاطلاع فقط — تصبح قابلة للتنفيذ بعد اكتمال الخطوة التي تسبقها.</p>

      {upcoming.length > 0
        ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((row) => <TaskRowCard key={row.taskId} row={row} />)}
          </div>
        : <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle px-6 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-surface-hover text-text-tertiary"><Clock3 className="size-5" aria-hidden="true" /></span>
            <p className="text-h3 font-bold text-text-secondary">لا توجد مهام قادمة</p>
            <p className="max-w-sm text-label text-text-secondary">ستظهر هنا المهام المسندة إليك في خطوات لاحقة من مسارها.</p>
          </div>}
    </section>
  </>
}
