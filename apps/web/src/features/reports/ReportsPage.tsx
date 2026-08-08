import { AlertTriangle, BarChart3, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import { reportClient, type ReportClient, type ReportSnapshot } from './client'

const t = {
  eyebrow: 'الأداء',
  title: 'التقارير ومؤشرات الأداء',
  loading: 'جارٍ التحميل...',
  error: 'تعذر تحميل التقارير',
  retry: 'إعادة المحاولة',
  noData: 'لا توجد بيانات كافية',
  export: 'طلب تصدير CSV',
  lineage: 'نسخة المؤشر',
  noTenant: 'لا توجد عضوية مؤسسة نشطة.',
  noMetrics: 'لا توجد مؤشرات متاحة لهذه الفترة بعد.',
}

export function ReportsScreen({ organizationId, client, periodStart }: { organizationId: string; client: ReportClient; periodStart: string }) {
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const value = await client.load(organizationId, periodStart)
      setSnapshot(value)
      setSelected(value.allowedExportFields.map(({ key }) => key))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [client, organizationId, periodStart])
  useEffect(() => {
    let active = true
    client.load(organizationId, periodStart).then(
      (value) => { if (active) { setSnapshot(value); setSelected(value.allowedExportFields.map(({ key }) => key)); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId, periodStart])
  if (status === 'loading') return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">{t.loading}</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-40 rounded-md bg-surface-hover" /><div className="mt-1 h-4 w-32 rounded-sm bg-surface-hover" /></div></header>
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 rounded-md border border-border-subtle bg-surface" />)}</div>
        <div className="mt-6 h-64 rounded-md border border-border-subtle bg-surface" />
      </div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><AlertTriangle className="mx-auto size-7 text-warning" aria-hidden="true" /><h1 className="mt-3 text-h1 font-extrabold text-text-primary">{t.error}</h1><button type="button" onClick={() => void load()} className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-all hover:bg-surface-hover active:scale-[0.98]"><RefreshCw className="size-4" aria-hidden="true" /> {t.retry}</button></section></main>
  const metrics = snapshot.metrics.filter((metric) => metric.visibility === 'operational' || snapshot.capabilities.viewPerformance)
  return <main dir="rtl" className="min-h-screen bg-canvas">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-label font-semibold text-brand-300">{t.eyebrow}</p><h1 className="text-display font-extrabold text-text-primary">{t.title}</h1><p className="mt-1 text-body text-text-secondary">{snapshot.periodStart} - {snapshot.periodEnd}</p></div>
      <nav aria-label="أقسام الأداء" className="mx-auto flex max-w-6xl gap-1 px-5">
        <Link to="/workload" className="rounded-t-md border-b-2 border-transparent px-4 py-2.5 text-body font-bold text-text-secondary transition-colors hover:text-text-primary">عبء العمل</Link>
        <span className="rounded-t-md border-b-2 border-brand-400 px-4 py-2.5 text-body font-bold text-brand-300">التقارير</span>
      </nav>
    </header>
    <div className="mx-auto max-w-6xl px-5 py-6">
      {metrics.length > 0
        ? <section aria-label={t.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => <article key={metric.id} className="rounded-md border border-border-subtle bg-surface p-4">
              <h2 className="text-label font-semibold text-text-secondary">{metric.name}</h2>
              {metric.value === null
                ? <p className="mt-3 text-h3 font-bold text-text-tertiary">{t.noData}</p>
                : <p className="mt-3 text-display font-extrabold text-text-primary">{metric.value}{metric.unit === 'percent' ? '%' : ' min'}</p>}
              <p className="mt-2 text-caption text-text-tertiary">{t.lineage}: v{metric.definitionVersion} · {metric.cutoffAt}</p>
            </article>)}
          </section>
        : <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface/50 px-6 py-12 text-center">
            <BarChart3 className="size-10 text-text-tertiary" aria-hidden="true" />
            <p className="text-h3 font-bold text-text-primary">{t.noMetrics}</p>
          </div>}
      {snapshot.capabilities.export && <section className="mt-6 rounded-md border border-border-subtle bg-surface p-5" aria-labelledby="export-heading">
        <h2 id="export-heading" className="text-h2 font-bold text-text-primary">{t.export}</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {snapshot.allowedExportFields.map((field) => <label key={field.key} className="flex cursor-pointer items-center gap-2 text-body text-text-secondary transition-colors hover:text-text-primary">
            <input type="checkbox" checked={selected.includes(field.key)} onChange={(event) => setSelected(event.target.checked ? [...selected, field.key] : selected.filter((key) => key !== field.key))} className="size-4 rounded-sm border-border-strong accent-brand-500" />
            {field.label}
          </label>)}
        </div>
        <button
          type="button"
          disabled={!selected.length || exporting}
          onClick={() => {
            setExporting(true)
            void client.requestExport(organizationId, { id: crypto.randomUUID(), reportType: 'operations', scopeType: 'organization', scopeId: organizationId, format: 'csv', requestedFields: selected }).finally(() => setExporting(false))
          }}
          className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          {t.export}
        </button>
      </section>}
    </div>
  </main>
}

export function ReportsPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center text-text-secondary">{t.noTenant}</main>
  const date = new Date()
  date.setUTCDate(1)
  return <ReportsScreen organizationId={organizationId} client={reportClient} periodStart={date.toISOString().slice(0, 10)} />
}
