import { Building2, ClipboardList } from 'lucide-react'
import type { DashboardSnapshot } from './client'
import { TaskRowCard } from './shared'

/**
 * Department Lead dashboard (dashboard scope === 'department') — sees tasks owned by their department or
 * assigned to their department's members. DashboardPage.tsx already renders the shared summary bar,
 * stalled-tasks section, and quick-action buttons (with "إنشاء مهمة" pre-scoped to this department) above
 * this; this component owns only the "مهام القسم" section.
 *
 * Deliberately reads as "your department's home turf" rather than a smaller copy of the org-wide view
 * (OrganizationDashboardView): an icon badge + one-line scope description + live count next to the
 * heading, vs. the org view's bare heading — the same TaskRowCard grid underneath, just framed as a
 * scoped, personal space instead of "everything, at scale".
 */
export function DepartmentDashboardView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const tasks = snapshot.tasks
  return <section aria-labelledby="department-tasks-heading" className="mt-8">
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-400">
        <Building2 className="size-4" aria-hidden="true" />
      </span>
      <h2 id="department-tasks-heading" className="text-h1 font-extrabold text-text-primary">مهام القسم</h2>
      {tasks.length > 0 && <span className="rounded-full bg-surface-hover px-2 py-0.5 text-caption font-bold text-text-secondary">{tasks.length}</span>}
    </div>
    <p className="mt-1 text-label text-text-secondary">المهام المملوكة لقسمك أو المسندة إلى أعضائه.</p>

    {tasks.length > 0
      ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((row) => <TaskRowCard key={row.taskId} row={row} />)}
        </div>
      : <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle px-6 py-12 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-surface-hover text-text-tertiary"><ClipboardList className="size-5" aria-hidden="true" /></span>
          <p className="text-h3 font-bold text-text-primary">لا توجد مهام نشطة في قسمك</p>
          <p className="max-w-sm text-label text-text-secondary">استخدم زر "إنشاء مهمة" أعلى الصفحة لبدء تتبع عمل قسمك هنا.</p>
        </div>}
  </section>
}
