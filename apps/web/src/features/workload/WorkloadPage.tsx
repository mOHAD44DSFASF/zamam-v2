import { AlertTriangle, Gauge, LoaderCircle, RefreshCw, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import {
  workloadClient, type WorkloadClient, type WorkloadScope, type WorkloadSnapshot,
  type WorkloadStatus,
} from './client'

const t = {
  title: 'عبء العمل والسعة',
  planning: 'التخطيط',
  loading: 'جارٍ حساب السعة...',
  error: 'تعذر تحميل عبء العمل',
  retry: 'إعادة المحاولة',
  noTenant: 'لا توجد عضوية مؤسسة نشطة.',
  scope: 'النطاق',
  period: 'بداية الفترة',
  rebuild: 'إعادة الحساب',
  known: 'أفراد بسعة معلومة',
  unknown: 'سعة غير معلومة',
  over: 'تخطوا السعة',
  available: 'السعة المتاحة',
  allocated: 'العمل المخطط',
  tasks: 'مهام',
  absence: 'خصم الغياب',
  conflicts: 'تعارضات',
  empty: 'لا توجد بيانات سعة لهذا النطاق.',
}
const statuses: Record<WorkloadStatus, string> = {
  unknown: 'غير معلوم',
  available: 'متاح',
  balanced: 'متوازن',
  at_risk: 'معرض للضغط',
  overallocated: 'متجاوز',
}
// Status -> DESIGN.md's restrained semantic system (success/warning/danger/neutral) rather than a bespoke
// palette: unknown reads as an informational neutral badge; available/balanced both read "healthy"
// (success); at_risk is warning; overallocated reuses the same danger token the rest of the app uses for
// stalled tasks/destructive actions -- never a second red.
const statusBadgeClass: Record<WorkloadStatus, string> = {
  unknown: 'bg-surface-hover text-text-secondary',
  available: 'bg-success-subtle text-success',
  balanced: 'bg-success-subtle text-success',
  at_risk: 'bg-warning-subtle text-warning',
  overallocated: 'bg-danger-subtle text-danger',
}
const statusBarClass: Record<WorkloadStatus, string> = {
  unknown: 'bg-text-tertiary',
  available: 'bg-success',
  balanced: 'bg-success',
  at_risk: 'bg-warning',
  overallocated: 'bg-danger',
}
const hours = (minutes: number | null) =>
  minutes === null ? 'غير معلوم' : `${(minutes / 60).toFixed(1)} س`

export function WorkloadScreen({
  organizationId, client, initialScope, initialPeriodStart,
}: {
  organizationId: string
  client: WorkloadClient
  initialScope: WorkloadScope
  initialPeriodStart: string
}) {
  const [snapshot, setSnapshot] = useState<WorkloadSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [scope, setScope] = useState(initialScope)
  const [periodStart, setPeriodStart] = useState(initialPeriodStart)
  const [rebuilding, setRebuilding] = useState(false)
  const load = useCallback(async (nextScope = scope, nextPeriod = periodStart) => {
    setStatus('loading')
    try {
      setSnapshot(await client.load(organizationId, nextScope, nextPeriod))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [client, organizationId, periodStart, scope])
  useEffect(() => {
    let active = true
    client.load(organizationId, scope, periodStart).then(
      (value) => { if (active) { setSnapshot(value); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId, periodStart, scope])
  if (status === 'loading') return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">{t.loading}</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-40 rounded-md bg-surface-hover" /></div></header>
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 rounded-md border border-border-subtle bg-surface" />)}</div>
        <div className="mt-6 space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 rounded-md border border-border-subtle bg-surface" />)}</div>
      </div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><AlertTriangle className="mx-auto size-7 text-warning" aria-hidden="true" /><h1 className="mt-3 text-h1 font-extrabold text-text-primary">{t.error}</h1><button type="button" onClick={() => void load()} className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-all hover:bg-surface-hover active:scale-[0.98]"><RefreshCw className="size-4" aria-hidden="true" /> {t.retry}</button></section></main>
  const selectScope = (value: string) => {
    const next = snapshot.availableScopes.find((candidate) => `${candidate.type}:${candidate.id}` === value)
    if (next) setScope(next)
  }
  return <main dir="rtl" className="min-h-screen bg-canvas">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-label font-semibold text-brand-300">{t.planning}</p><h1 className="text-display font-extrabold text-text-primary">{t.title}</h1></div>
      {/* Workload and Reports are two views of the same "performance" area — neither has its own sidebar
          slot (the sidebar's single "التقارير" item points here), so this tab pair is what makes Reports
          actually reachable without typing its URL. */}
      <nav aria-label="أقسام الأداء" className="mx-auto flex max-w-6xl gap-1 px-5">
        <span className="rounded-t-md border-b-2 border-brand-400 px-4 py-2.5 text-body font-bold text-brand-300">عبء العمل</span>
        <Link to="/reports" className="rounded-t-md border-b-2 border-transparent px-4 py-2.5 text-body font-bold text-text-secondary transition-colors hover:text-text-primary">التقارير</Link>
      </nav>
    </header>
    <div className="mx-auto max-w-6xl px-5 py-6">
      <section aria-label={t.planning} className="flex flex-wrap items-end gap-4 border-b border-border-subtle pb-6">
        <label className="min-w-56 text-label font-bold text-text-secondary">
          {t.scope}
          <select value={`${scope.type}:${scope.id}`} onChange={(event) => selectScope(event.target.value)} className="mt-1.5 w-full cursor-pointer rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary">
            {snapshot.availableScopes.map((candidate) => <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>{candidate.label}</option>)}
          </select>
        </label>
        <label className="text-label font-bold text-text-secondary">
          {t.period}
          <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1.5 block rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary" />
        </label>
        {snapshot.capabilities.rebuild && <button
          type="button"
          disabled={rebuilding}
          onClick={() => {
            setRebuilding(true)
            void client.rebuild(organizationId, scope, snapshot.periodStart, snapshot.periodEnd).then(() => load()).finally(() => setRebuilding(false))
          }}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rebuilding ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
          {t.rebuild}
        </button>}
      </section>
      <section aria-label={'ملخص السعة'} className="grid gap-3 py-6 sm:grid-cols-2 lg:grid-cols-4">
        {([
          [t.known, snapshot.summary.knownPeople, Users],
          [t.unknown, snapshot.summary.unknownPeople, AlertTriangle],
          [t.over, snapshot.summary.overallocatedPeople, Gauge],
          [t.allocated, hours(snapshot.summary.totalAllocatedMinutes), Gauge],
        ] as const).map(([label, value, Icon]) => <div key={String(label)} className="rounded-md border border-border-subtle bg-surface p-4"><Icon className="size-5 text-brand-400" aria-hidden="true" /><p className="mt-3 text-label font-semibold text-text-secondary">{String(label)}</p><p className="mt-1 text-h1 font-extrabold text-text-primary">{String(value)}</p></div>)}
      </section>
      <section aria-label={t.title} className="space-y-3">
        {snapshot.rows.map((row) => <article key={row.userId} className="rounded-md border border-border-subtle bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-bold text-text-primary" title={snapshot.capabilities.viewEmployeeNames ? row.displayName : undefined}>{snapshot.capabilities.viewEmployeeNames ? row.displayName : `ID ${row.userId.slice(-4)}`}</h2>
              <p className="mt-1 text-label text-text-secondary">{row.assignmentCount} {t.tasks} · {t.absence}: {hours(row.absenceMinutes)}{row.overlapCount > 0 ? ` · ${t.conflicts}: ${row.overlapCount}` : ''}</p>
            </div>
            <span className={`shrink-0 rounded-sm px-2 py-0.5 text-caption font-semibold ${statusBadgeClass[row.status]}`}>{statuses[row.status]}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-body">
            <div><span className="block text-caption font-semibold text-text-tertiary">{t.available}</span><strong className="text-text-primary">{hours(row.availableMinutes)}</strong></div>
            <div><span className="block text-caption font-semibold text-text-tertiary">{t.allocated}</span><strong className="text-text-primary">{hours(row.allocatedMinutes)}</strong></div>
            <div><span className="block text-caption font-semibold text-text-tertiary">%</span><strong className="text-text-primary">{row.utilizationPercent === null ? '—' : `${row.utilizationPercent}%`}</strong></div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-label={`${row.displayName}: ${statuses[row.status]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.utilizationPercent === null ? undefined : Math.min(100, row.utilizationPercent)}>
            <div className={`h-full rounded-full transition-[width] duration-300 ${statusBarClass[row.status]}`} style={{ width: `${row.utilizationPercent === null ? 0 : Math.min(100, row.utilizationPercent)}%` }} />
          </div>
          {row.unknownAssignmentCount > 0 && <p role="note" className="mt-3 flex items-center gap-1.5 text-caption font-semibold text-warning"><AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />{'توجد مهام بلا تقدير؛ لم تُعامل كصفر.'}</p>}
        </article>)}
        {snapshot.rows.length === 0 && <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface/50 px-6 py-12 text-center">
          <Users className="size-10 text-text-tertiary" aria-hidden="true" />
          <p className="text-h3 font-bold text-text-primary">{t.empty}</p>
        </div>}
      </section>
    </div>
  </main>
}

export function WorkloadPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center text-text-secondary">{t.noTenant}</main>
  const now = new Date()
  const day = now.getUTCDay()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)))
  return <WorkloadScreen organizationId={organizationId} client={workloadClient} initialScope={{ type: 'organization', id: organizationId, label: 'المؤسسة' }} initialPeriodStart={monday.toISOString().slice(0, 10)} />
}
