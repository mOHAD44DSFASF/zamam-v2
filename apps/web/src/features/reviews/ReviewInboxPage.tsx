import { AlertTriangle, Check, Clock3, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { reviewInboxClient, type ReviewInboxClient, type ReviewInboxItem, type ReviewInboxSnapshot } from './client'

export function ReviewInboxScreen({ organizationId, client }: { organizationId: string; client: ReviewInboxClient }) {
  const [snapshot, setSnapshot] = useState<ReviewInboxSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    setStatus('loading')
    try { setSnapshot(await client.load(organizationId)); setStatus('ready') } catch { setStatus('error') }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then((value) => { if (active) { setSnapshot(value); setStatus('ready') } }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId])
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل المراجعات...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>تعذر تحميل صندوق المراجعات</h1></main>
  const decide = async (item: ReviewInboxItem, decision: 'approved' | 'rejected' | 'changes_requested') => {
    await client.decide(organizationId, {
      approvalId: item.approvalId, expectedApprovalVersion: item.approvalVersion, decision,
      ...(decision !== 'approved' ? { reason: reasons[item.approvalId] ?? '' } : {}),
    })
    await load()
  }
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto max-w-5xl px-5 py-6"><p className="text-sm font-bold text-teal-800">صندوق العمل</p><h1 className="text-2xl font-black">المراجعات والموافقات</h1></div></header>
    <section className="mx-auto max-w-5xl space-y-3 px-5 py-6">{snapshot.items.map((item) => <article key={item.approvalId} className="border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black">{item.taskTitle}</h2>{item.visibility === 'client' && <span className="rounded bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800">موافقة عميل</span>}</div><p className="mt-1 text-sm text-gray-500">{item.projectName} · طلب {item.requestedByName} · الدورة {item.round}</p><p className="mt-1 text-xs text-gray-500">نسخة العمل {item.reviewedVersion} · سياسة {item.policy}</p></div>{item.dueAt && <span className="flex gap-2 text-xs text-gray-500"><Clock3 className="size-4" aria-hidden="true" /> {item.dueAt}</span>}</div>
      {!item.orderReady && <p className="mt-4 flex gap-2 border-t pt-4 text-sm text-amber-800"><AlertTriangle className="size-4" aria-hidden="true" /> ينتظر قرار المراجع السابق.</p>}
      {snapshot.capabilities.decide && item.orderReady && <div className="mt-4 border-t pt-4"><label className="block text-sm font-bold">سبب الرفض أو طلب التعديل<textarea aria-label={`سبب القرار ${item.taskTitle}`} value={reasons[item.approvalId] ?? ''} onChange={(event) => setReasons({ ...reasons, [item.approvalId]: event.target.value })} className="mt-2 min-h-20 w-full rounded-md border p-2" /></label><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void decide(item, 'approved')} className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 font-bold text-white"><Check className="size-4" aria-hidden="true" /> موافقة</button><button onClick={() => void decide(item, 'changes_requested')} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 font-bold"><RotateCcw className="size-4" aria-hidden="true" /> طلب تعديلات</button><button onClick={() => void decide(item, 'rejected')} className="inline-flex items-center gap-2 rounded-md border border-red-300 px-3 py-2 font-bold text-red-800"><X className="size-4" aria-hidden="true" /> رفض</button></div></div>}
    </article>)}{snapshot.items.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">لا توجد مراجعات معلقة.</div>}</section>
  </main>
}

export function ReviewInboxPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <ReviewInboxScreen organizationId={organizationId} client={reviewInboxClient} />
}

