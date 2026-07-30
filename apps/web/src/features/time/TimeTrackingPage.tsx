import { Clock3, LoaderCircle, Play, Send, Square, TimerReset } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { timeClient, type TimeClient, type TimeSnapshot } from './client'

const t = {
  title: '\u0627\u0644\u0648\u0642\u062a \u0648\u0643\u0634\u0648\u0641 \u0627\u0644\u0633\u0627\u0639\u0627\u062a',
  loading: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0648\u0642\u062a...',
  error: '\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0648\u0642\u062a',
  noTenant: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0636\u0648\u064a\u0629 \u0645\u0624\u0633\u0633\u0629 \u0646\u0634\u0637\u0629.',
  timer: '\u0627\u0644\u0645\u0624\u0642\u062a',
  project: '\u0627\u0644\u0645\u0634\u0631\u0648\u0639',
  start: '\u0628\u062f\u0621 \u0627\u0644\u0645\u0624\u0642\u062a',
  stop: '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0645\u0624\u0642\u062a',
  manual: '\u0625\u0636\u0627\u0641\u0629 \u0648\u0642\u062a \u064a\u062f\u0648\u064a',
  started: '\u0627\u0644\u0628\u062f\u0627\u064a\u0629',
  ended: '\u0627\u0644\u0646\u0647\u0627\u064a\u0629',
  note: '\u0645\u0644\u0627\u062d\u0638\u0629',
  add: '\u0625\u0636\u0627\u0641\u0629',
  entries: '\u0633\u062c\u0644\u0627\u062a \u0627\u0644\u0641\u062a\u0631\u0629',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0633\u062c\u0644\u0627\u062a \u0648\u0642\u062a.',
  submit: '\u0625\u0631\u0633\u0627\u0644 \u0643\u0634\u0641 \u0627\u0644\u0633\u0627\u0639\u0627\u062a',
  approvals: '\u0643\u0634\u0648\u0641 \u062a\u0646\u062a\u0638\u0631 \u0627\u0644\u0627\u0639\u062a\u0645\u0627\u062f',
  approve: '\u0627\u0639\u062a\u0645\u0627\u062f',
  billable: '\u0642\u0627\u0628\u0644 \u0644\u0644\u0641\u0648\u062a\u0631\u0629',
}
const hours = (minutes: number) => `${(minutes / 60).toFixed(2)} \u0633`

export function TimeTrackingScreen({
  organizationId, client, initialPeriodStart,
}: {
  organizationId: string
  client: TimeClient
  initialPeriodStart: string
}) {
  const [snapshot, setSnapshot] = useState<TimeSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [projectId, setProjectId] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    setStatus('loading')
    try { setSnapshot(await client.load(organizationId, initialPeriodStart)); setStatus('ready') }
    catch { setStatus('error') }
  }, [client, initialPeriodStart, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId, initialPeriodStart).then(
      (value) => {
        if (active) {
          setSnapshot(value)
          setProjectId(value.projects[0]?.id ?? '')
          setStatus('ready')
        }
      },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, initialPeriodStart, organizationId])
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> {t.loading}</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>{t.error}</h1></main>
  const startTimer = () => client.start(organizationId, {
    id: crypto.randomUUID(), projectId, timezone: snapshot.timezone, billable: false,
  }).then(load)
  const addManual = () => client.createManual(organizationId, {
    id: crypto.randomUUID(), projectId,
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
    timezone: snapshot.timezone, billable: false, ...(note.trim() ? { note: note.trim() } : {}),
  }).then(load)
  return <main dir="rtl" className="min-h-screen bg-gray-50 text-gray-950">
    <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-sm font-bold text-teal-800">{t.timer}</p><h1 className="text-2xl font-black">{t.title}</h1></div></header>
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section aria-labelledby="timer-heading" className="border bg-white p-5"><h2 id="timer-heading" className="flex items-center gap-2 font-black"><Clock3 className="size-5 text-teal-800" aria-hidden="true" />{t.timer}</h2>{snapshot.runningEntry ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{snapshot.runningEntry.projectName}</p><p className="text-sm text-gray-600">{snapshot.runningEntry.startedAt}</p></div><button onClick={() => void client.stop(organizationId, snapshot.runningEntry!.id, snapshot.runningEntry!.version).then(load)} className="inline-flex items-center gap-2 rounded-md bg-red-700 px-4 py-2 font-bold text-white"><Square className="size-4" aria-hidden="true" />{t.stop}</button></div> : <div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-56 text-sm font-bold">{t.project}<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 w-full rounded-md border p-2">{snapshot.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button disabled={!projectId} onClick={() => void startTimer()} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50"><Play className="size-4" aria-hidden="true" />{t.start}</button></div>}</section>
        <section aria-labelledby="entries-heading"><div className="mb-3 flex items-center justify-between gap-3"><h2 id="entries-heading" className="font-black">{t.entries}</h2>{snapshot.capabilities.submit && snapshot.entries.length > 0 && snapshot.timesheet?.status !== 'submitted' && snapshot.timesheet?.status !== 'approved' && <button onClick={() => void client.submit(organizationId, snapshot.periodStart, snapshot.periodEnd).then(load)} className="inline-flex items-center gap-2 rounded-md border border-teal-800 px-3 py-2 text-sm font-bold text-teal-900"><Send className="size-4" aria-hidden="true" />{t.submit}</button>}</div><div className="space-y-3">{snapshot.entries.map((entry) => <article key={entry.id} className="border bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-black">{entry.taskTitle ?? entry.projectName}</h3><p className="mt-1 text-sm text-gray-600">{entry.startedAt} · {entry.endedAt ?? t.timer}</p></div><strong>{hours(entry.minutes)}</strong></div><p className="mt-2 text-xs text-gray-500">{entry.status}{snapshot.capabilities.viewBillable && entry.billable ? ` · ${t.billable}` : ''}</p></article>)}{snapshot.entries.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">{t.empty}</div>}</div></section>
        {snapshot.capabilities.approve && snapshot.approvalQueue.length > 0 && <section aria-labelledby="approvals-heading"><h2 id="approvals-heading" className="mb-3 font-black">{t.approvals}</h2>{snapshot.approvalQueue.map((sheet) => <article key={sheet.id} className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4"><div><h3 className="font-black">{sheet.userName}</h3><p className="text-sm text-gray-600">{hours(sheet.totalMinutes)} · {sheet.entryCount}</p></div><button onClick={() => void client.decide(organizationId, sheet.id, sheet.version, 'approved').then(load)} className="rounded-md bg-teal-800 px-3 py-2 font-bold text-white">{t.approve}</button></article>)}</section>}
      </div>
      {snapshot.capabilities.track && <aside><form onSubmit={(event) => { event.preventDefault(); void addManual() }} className="border bg-white p-5"><h2 className="flex items-center gap-2 font-black"><TimerReset className="size-5 text-teal-800" aria-hidden="true" />{t.manual}</h2><label className="mt-4 block text-sm font-bold">{t.project}<select required value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 w-full rounded-md border p-2">{snapshot.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="mt-3 block text-sm font-bold">{t.started}<input required type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} className="mt-1 w-full rounded-md border p-2" /></label><label className="mt-3 block text-sm font-bold">{t.ended}<input required type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} className="mt-1 w-full rounded-md border p-2" /></label><label className="mt-3 block text-sm font-bold">{t.note}<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-md border p-2" /></label><button disabled={!projectId || !startedAt || !endedAt} type="submit" className="mt-4 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50">{t.add}</button></form></aside>}
    </div>
  </main>
}

export function TimeTrackingPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">{t.noTenant}</main>
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
  return <TimeTrackingScreen organizationId={organizationId} client={timeClient} initialPeriodStart={monday.toISOString().slice(0, 10)} />
}
