import { CalendarDays, Check, LoaderCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { attendanceLeaveClient, type AttendanceLeaveClient, type AttendanceLeaveSnapshot } from './client'

const t = {
  title: 'الحضور والإجازات', titleAttendance: 'الحضور', titleLeave: 'الإجازات',
  loading: 'جارٍ التحميل...', error: 'تعذر تحميل بيانات الحضور', noTenant: 'لا توجد عضوية مؤسسة نشطة.',
  today: 'حضور اليوم', leave: 'طلب إجازة', type: 'نوع الإجازة', start: 'من', end: 'إلى', reason: 'السبب',
  send: 'إرسال', requests: 'طلباتي', approvals: 'طلبات تنتظر الاعتماد', approve: 'اعتماد',
  external: 'الرصيد مدار من نظام HR خارجي', noAttendanceToday: 'لم يسجل الحضور بعد',
}

/**
 * `section` lets a caller show only the attendance half or only the leave half of this screen (used by
 * app/TimePage.tsx to give each a distinct tab/URL) without touching this component's own data loading —
 * both halves share one snapshot fetch. Omitting it (the original behavior, still used by the standalone
 * /attendance route) renders both together, unchanged.
 */
export function AttendanceLeaveScreen({ organizationId, client, section }: {
  organizationId: string
  client: AttendanceLeaveClient
  section?: 'attendance' | 'leave'
}) {
  const [snapshot, setSnapshot] = useState<AttendanceLeaveSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [typeId, setTypeId] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [reason, setReason] = useState('')
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const value = await client.load(organizationId)
      setSnapshot(value); setTypeId(value.leaveTypes[0]?.id ?? ''); setStatus('ready')
    } catch { setStatus('error') }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then((value) => {
      if (active) { setSnapshot(value); setTypeId(value.leaveTypes[0]?.id ?? ''); setStatus('ready') }
    }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> {t.loading}</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>{t.error}</h1></main>

  const showAttendance = !section || section === 'attendance'
  const showLeave = !section || section === 'leave'
  const heading = section === 'attendance' ? t.titleAttendance : section === 'leave' ? t.titleLeave : t.title

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50">
      <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><h1 className="text-2xl font-black">{heading}</h1></div></header>
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {showAttendance && (
            <section className="border bg-white p-5" aria-labelledby="today-heading">
              <h2 id="today-heading" className="flex items-center gap-2 font-black"><CalendarDays className="size-5 text-teal-800" aria-hidden="true" />{t.today}</h2>
              <p className="mt-3 text-sm">{snapshot.today ? `${snapshot.today.date} · ${snapshot.today.status} · ${(snapshot.today.workedMinutes / 60).toFixed(1)} h` : t.noAttendanceToday}</p>
            </section>
          )}
          {showLeave && (
            <section aria-labelledby="requests-heading">
              <h2 id="requests-heading" className="mb-3 font-black">{t.requests}</h2>
              {snapshot.myRequests.map((request) => (
                <article key={request.id} className="mb-3 border bg-white p-4">
                  <h3 className="font-bold">{request.typeName}</h3>
                  <p className="text-sm text-gray-600">{request.startsOn} - {request.endsOn} · {request.quantityDays} · {request.status}</p>
                </article>
              ))}
            </section>
          )}
          {showLeave && snapshot.capabilities.approveLeave && (
            <section aria-labelledby="approvals-heading">
              <h2 id="approvals-heading" className="mb-3 font-black">{t.approvals}</h2>
              {snapshot.approvalQueue.map((request) => (
                <article key={request.id} className="mb-3 flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
                  <div><h3 className="font-bold">{request.employeeName}</h3><p className="text-sm text-gray-600">{request.typeName} · {request.startsOn} - {request.endsOn}</p></div>
                  <button onClick={() => void client.decideLeave(organizationId, request.id, request.version, 'approved').then(load)} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 font-bold text-white"><Check className="size-4" aria-hidden="true" />{t.approve}</button>
                </article>
              ))}
            </section>
          )}
        </div>
        {showLeave && snapshot.capabilities.requestLeave && (
          <aside>
            <form onSubmit={(event) => { event.preventDefault(); void client.requestLeave(organizationId, { id: crypto.randomUUID(), leaveTypeId: typeId, startsOn, endsOn, reason }).then(load) }} className="border bg-white p-5">
              <h2 className="font-black">{t.leave}</h2>
              <label className="mt-4 block text-sm font-bold">{t.type}
                <select required value={typeId} onChange={(event) => setTypeId(event.target.value)} className="mt-1 w-full rounded-md border p-2">
                  {snapshot.leaveTypes.map((type) => <option key={type.id} value={type.id}>{type.name}{type.remainingDays === null ? ` · ${t.external}` : ` · ${type.remainingDays}`}</option>)}
                </select>
              </label>
              <label className="mt-3 block text-sm font-bold">{t.start}<input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="mt-1 w-full rounded-md border p-2" /></label>
              <label className="mt-3 block text-sm font-bold">{t.end}<input required type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className="mt-1 w-full rounded-md border p-2" /></label>
              <label className="mt-3 block text-sm font-bold">{t.reason}<textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border p-2" /></label>
              <button disabled={!typeId || !startsOn || !endsOn || reason.trim().length < 3} className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50"><Send className="size-4" aria-hidden="true" />{t.send}</button>
            </form>
          </aside>
        )}
      </div>
    </main>
  )
}

export function AttendanceLeavePage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl">{t.noTenant}</main>
  return <AttendanceLeaveScreen organizationId={organizationId} client={attendanceLeaveClient} />
}
