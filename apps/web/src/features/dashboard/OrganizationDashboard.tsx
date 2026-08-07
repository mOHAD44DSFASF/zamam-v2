import { Inbox } from 'lucide-react'
import type { DashboardSnapshot, DashboardTaskRow } from './client'
import { TaskRowCard } from './shared'

/**
 * Owner/Manager dashboard (dashboard scope === 'organization') — sees every active task across the whole
 * organization. DashboardPage.tsx already renders the shared summary bar, stalled-tasks section, and
 * quick-action buttons above this; this component owns only the "كل مهام المؤسسة" section.
 *
 * Grouped by priority tier (عاجلة / مهمة / عادية) rather than one flat grid: with every active task in the
 * org landing on one screen, priority is the fastest way to answer "what needs my attention" in under a
 * second (PRODUCT.md's scanability principle) — stalled tasks already get their own section above this one
 * from DashboardPage, so this grouping is purely about triaging what's left.
 */
function TaskGroup({ title, dotClassName, rows }: { title: string; dotClassName: string; rows: readonly DashboardTaskRow[] }) {
  if (rows.length === 0) return null
  return <div className="mt-6 first:mt-0">
    <h3 className="flex items-center gap-2 text-label font-bold text-text-secondary">
      <span className={`size-2 rounded-full ${dotClassName}`} aria-hidden="true" />
      {title}
      <span className="text-text-tertiary">({rows.length})</span>
    </h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => <TaskRowCard key={row.taskId} row={row} />)}
    </div>
  </div>
}

export function OrganizationDashboardView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const urgent = snapshot.tasks.filter((row) => row.priority === 'urgent')
  const high = snapshot.tasks.filter((row) => row.priority === 'high')
  const normal = snapshot.tasks.filter((row) => row.priority === 'low' || row.priority === 'medium')

  return <section aria-labelledby="all-tasks-heading" className="mt-8">
    <h2 id="all-tasks-heading" className="flex items-baseline gap-2 text-h1 font-extrabold text-text-primary">
      كل مهام المؤسسة
      {snapshot.tasks.length > 0 && <span className="text-body font-semibold text-text-secondary">({snapshot.tasks.length})</span>}
    </h2>

    {snapshot.tasks.length === 0
      ? <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface/50 px-6 py-12 text-center">
        <Inbox className="size-10 text-text-tertiary" aria-hidden="true" />
        <div>
          <p className="text-h3 font-bold text-text-primary">لا توجد مهام نشطة</p>
          <p className="mt-1 text-body text-text-secondary">كل المهام مكتملة أو لم تُنشأ مهام جديدة بعد — ستظهر هنا أي مهمة نشطة في المؤسسة.</p>
        </div>
      </div>
      : <div className="mt-4">
        <TaskGroup title="عاجلة" dotClassName="bg-danger" rows={urgent} />
        <TaskGroup title="مهمة" dotClassName="bg-warning" rows={high} />
        <TaskGroup title="عادية" dotClassName="bg-text-tertiary" rows={normal} />
      </div>}
  </section>
}
