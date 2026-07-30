import { AlertTriangle, Gauge, LoaderCircle, RefreshCw, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import {
  workloadClient, type WorkloadClient, type WorkloadScope, type WorkloadSnapshot,
  type WorkloadStatus,
} from './client'

const t = {
  title: '\u0639\u0628\u0621 \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u0633\u0639\u0629',
  planning: '\u0627\u0644\u062a\u062e\u0637\u064a\u0637',
  loading: '\u062c\u0627\u0631\u064d \u062d\u0633\u0627\u0628 \u0627\u0644\u0633\u0639\u0629...',
  error: '\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0639\u0628\u0621 \u0627\u0644\u0639\u0645\u0644',
  noTenant: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0636\u0648\u064a\u0629 \u0645\u0624\u0633\u0633\u0629 \u0646\u0634\u0637\u0629.',
  scope: '\u0627\u0644\u0646\u0637\u0627\u0642',
  period: '\u0628\u062f\u0627\u064a\u0629 \u0627\u0644\u0641\u062a\u0631\u0629',
  rebuild: '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062d\u0633\u0627\u0628',
  known: '\u0623\u0641\u0631\u0627\u062f \u0628\u0633\u0639\u0629 \u0645\u0639\u0644\u0648\u0645\u0629',
  unknown: '\u0633\u0639\u0629 \u063a\u064a\u0631 \u0645\u0639\u0644\u0648\u0645\u0629',
  over: '\u062a\u062e\u0637\u0648\u0627 \u0627\u0644\u0633\u0639\u0629',
  available: '\u0627\u0644\u0633\u0639\u0629 \u0627\u0644\u0645\u062a\u0627\u062d\u0629',
  allocated: '\u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062e\u0637\u0637',
  tasks: '\u0645\u0647\u0627\u0645',
  absence: '\u062e\u0635\u0645 \u0627\u0644\u063a\u064a\u0627\u0628',
  conflicts: '\u062a\u0639\u0627\u0631\u0636\u0627\u062a',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0633\u0639\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0646\u0637\u0627\u0642.',
}
const statuses: Record<WorkloadStatus, string> = {
  unknown: '\u063a\u064a\u0631 \u0645\u0639\u0644\u0648\u0645',
  available: '\u0645\u062a\u0627\u062d',
  balanced: '\u0645\u062a\u0648\u0627\u0632\u0646',
  at_risk: '\u0645\u0639\u0631\u0636 \u0644\u0644\u0636\u063a\u0637',
  overallocated: '\u0645\u062a\u062c\u0627\u0648\u0632',
}
const statusColor: Record<WorkloadStatus, string> = {
  unknown: 'bg-gray-500', available: 'bg-emerald-600', balanced: 'bg-teal-700',
  at_risk: 'bg-amber-600', overallocated: 'bg-red-700',
}
const hours = (minutes: number | null) =>
  minutes === null ? '\u063a\u064a\u0631 \u0645\u0639\u0644\u0648\u0645' : `${(minutes / 60).toFixed(1)} \u0633`

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
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> {t.loading}</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>{t.error}</h1></main>
  const selectScope = (value: string) => {
    const next = snapshot.availableScopes.find((candidate) => `${candidate.type}:${candidate.id}` === value)
    if (next) setScope(next)
  }
  return <main dir="rtl" className="min-h-screen bg-gray-50 text-gray-950">
    <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-sm font-bold text-teal-800">{t.planning}</p><h1 className="text-2xl font-black">{t.title}</h1></div></header>
    <div className="mx-auto max-w-6xl px-5 py-6">
      <section aria-label={t.planning} className="flex flex-wrap items-end gap-3 border-b pb-5"><label className="min-w-56 text-sm font-bold">{t.scope}<select value={`${scope.type}:${scope.id}`} onChange={(event) => selectScope(event.target.value)} className="mt-1 w-full rounded-md border bg-white p-2">{snapshot.availableScopes.map((candidate) => <option key={`${candidate.type}:${candidate.id}`} value={`${candidate.type}:${candidate.id}`}>{candidate.label}</option>)}</select></label><label className="text-sm font-bold">{t.period}<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 block rounded-md border bg-white p-2" /></label>{snapshot.capabilities.rebuild && <button onClick={() => void client.rebuild(organizationId, scope, snapshot.periodStart, snapshot.periodEnd).then(() => load())} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white"><RefreshCw className="size-4" aria-hidden="true" />{t.rebuild}</button>}</section>
      <section aria-label={'\u0645\u0644\u062e\u0635 \u0627\u0644\u0633\u0639\u0629'} className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4">
        {([
          [t.known, snapshot.summary.knownPeople, Users],
          [t.unknown, snapshot.summary.unknownPeople, AlertTriangle],
          [t.over, snapshot.summary.overallocatedPeople, Gauge],
          [t.allocated, hours(snapshot.summary.totalAllocatedMinutes), Gauge],
        ] as const).map(([label, value, Icon]) => <div key={String(label)} className="border bg-white p-4"><Icon className="size-5 text-teal-800" aria-hidden="true" /><p className="mt-3 text-xs font-bold text-gray-600">{String(label)}</p><p className="mt-1 text-xl font-black">{String(value)}</p></div>)}
      </section>
      <section aria-label={t.title} className="space-y-3">{snapshot.rows.map((row) => <article key={row.userId} className="border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">{snapshot.capabilities.viewEmployeeNames ? row.displayName : `ID ${row.userId.slice(-4)}`}</h2><p className="mt-1 text-sm text-gray-600">{row.assignmentCount} {t.tasks} · {t.absence}: {hours(row.absenceMinutes)}{row.overlapCount > 0 ? ` · ${t.conflicts}: ${row.overlapCount}` : ''}</p></div><span className={`${statusColor[row.status]} rounded px-2 py-1 text-xs font-bold text-white`}>{statuses[row.status]}</span></div><div className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><span className="block text-xs text-gray-500">{t.available}</span><strong>{hours(row.availableMinutes)}</strong></div><div><span className="block text-xs text-gray-500">{t.allocated}</span><strong>{hours(row.allocatedMinutes)}</strong></div><div><span className="block text-xs text-gray-500">%</span><strong>{row.utilizationPercent === null ? '\u2014' : `${row.utilizationPercent}%`}</strong></div></div><div className="mt-3 h-2 overflow-hidden rounded bg-gray-200" role="progressbar" aria-label={`${row.displayName}: ${statuses[row.status]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.utilizationPercent === null ? undefined : Math.min(100, row.utilizationPercent)}><div className={`h-full ${statusColor[row.status]}`} style={{ width: `${row.utilizationPercent === null ? 0 : Math.min(100, row.utilizationPercent)}%` }} /></div>{row.unknownAssignmentCount > 0 && <p role="note" className="mt-3 text-xs font-bold text-amber-800">{'\u062a\u0648\u062c\u062f \u0645\u0647\u0627\u0645 \u0628\u0644\u0627 \u062a\u0642\u062f\u064a\u0631\u061b \u0644\u0645 \u062a\u064f\u0639\u0627\u0645\u0644 \u0643\u0635\u0641\u0631.'}</p>}</article>)}{snapshot.rows.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">{t.empty}</div>}</section>
    </div>
  </main>
}

export function WorkloadPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">{t.noTenant}</main>
  const now = new Date()
  const day = now.getUTCDay()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)))
  return <WorkloadScreen organizationId={organizationId} client={workloadClient} initialScope={{ type: 'organization', id: organizationId, label: '\u0627\u0644\u0645\u0624\u0633\u0633\u0629' }} initialPeriodStart={monday.toISOString().slice(0, 10)} />
}
