import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, Plus, RefreshCw, Search, ShieldX, UserRound, Users, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import {
  employeeDirectoryClient,
  type EmployeeDirectoryClient,
  type EmployeeDirectorySnapshot,
  type InviteEmployeeForm,
} from './client'

function InviteDialog({
  snapshot,
  onClose,
  onSubmit,
}: {
  snapshot: EmployeeDirectorySnapshot
  onClose: () => void
  onSubmit: (input: InviteEmployeeForm) => Promise<void>
}) {
  const titleId = useId()
  const firstInput = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => firstInput.current?.focus(), [])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="my-6 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          setSubmitting(true)
          setError('')
          try {
            await onSubmit({
              email: String(data.get('email')),
              displayName: String(data.get('displayName')),
              firstName: String(data.get('firstName')),
              employeeNumber: String(data.get('employeeNumber')),
              employmentType: data.get('employmentType') === 'contractor' ? 'contractor' : 'employee',
              primaryDepartmentId: String(data.get('primaryDepartmentId')),
              jobTitle: String(data.get('jobTitle')),
              startDate: String(data.get('startDate')),
              locale: 'ar',
              timezone: 'Africa/Cairo',
            })
            onClose()
          } catch {
            setError('تعذر إرسال الدعوة. لم تُمنح أي صلاحية تلقائيًا.')
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-black">دعوة موظف</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 place-items-center rounded-md hover:bg-gray-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <p className="mt-2 text-sm text-gray-600">تُرسل الدعوة دون دور. تُمنح الأدوار لاحقًا من إدارة الصلاحيات.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">الاسم الكامل<input ref={firstInput} name="displayName" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">الاسم الأول<input name="firstName" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">البريد الإلكتروني<input name="email" type="email" required dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
          <label className="text-sm font-semibold">رقم الموظف<input name="employeeNumber" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
          <label className="text-sm font-semibold">المسمى الوظيفي<input name="jobTitle" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">نوع العلاقة<select name="employmentType" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"><option value="employee">موظف</option><option value="contractor">متعاون خارجي</option></select></label>
          <label className="text-sm font-semibold">القسم الأساسي<select name="primaryDepartmentId" required className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2">{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="text-sm font-semibold">تاريخ البدء<input name="startDate" type="date" required className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 font-semibold">إلغاء</button>
          <button type="submit" disabled={submitting || snapshot.departments.length === 0} className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50">{submitting ? 'جارٍ الإرسال...' : 'إرسال الدعوة'}</button>
        </div>
      </form>
    </div>
  )
}

function DisableDialog({ displayName, onClose, onConfirm }: { displayName: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="w-full max-w-md rounded-lg bg-white p-6" onSubmit={async (event) => {
        event.preventDefault()
        setSubmitting(true)
        try { await onConfirm(reason); onClose() } finally { setSubmitting(false) }
      }}>
        <ShieldX className="size-7 text-red-700" aria-hidden="true" />
        <h2 id={titleId} className="mt-3 text-lg font-black">تعطيل {displayName}</h2>
        <p className="mt-2 text-sm text-gray-600">سيُمنع الوصول فورًا وتُبطل الجلسات. لا تُحذف السجلات.</p>
        <label className="mt-4 block text-sm font-semibold">سبب التعطيل<textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-gray-300 p-3" /></label>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 font-semibold">إلغاء</button>
          <button type="submit" disabled={submitting} className="rounded-md bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">تأكيد التعطيل</button>
        </div>
      </form>
    </div>
  )
}

export function EmployeeDirectoryScreen({ organizationId, client }: { organizationId: string; client: EmployeeDirectoryClient }) {
  const [snapshot, setSnapshot] = useState<EmployeeDirectorySnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [disableTarget, setDisableTarget] = useState<{ userId: string; displayName: string } | null>(null)
  const load = useCallback(async () => {
    setStatus('loading')
    try { setSnapshot(await client.load(organizationId)); setStatus('ready') } catch { setStatus('error') }
  }, [client, organizationId])

  useEffect(() => {
    let active = true
    client.load(organizationId).then(
      (value) => { if (active) { setSnapshot(value); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') return <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50"><p role="status" className="flex items-center gap-2"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل الموظفين...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50 p-6"><section className="text-center"><AlertTriangle className="mx-auto size-8 text-amber-700" aria-hidden="true" /><h1 className="mt-4 text-xl font-black">تعذر تحميل دليل الموظفين</h1><p className="mt-2 text-gray-600">الخدمة غير متاحة أو لا تملك الصلاحية.</p><button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2 font-bold"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>

  const normalized = query.trim().toLocaleLowerCase('ar')
  const items = snapshot.items.filter((item) => !normalized || `${item.displayName} ${item.employeeNumber} ${item.jobTitle} ${item.departmentName}`.toLocaleLowerCase('ar').includes(normalized))

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50">
      <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6"><div><p className="text-sm font-semibold text-teal-800">الأفراد</p><h1 className="mt-1 text-2xl font-black">دليل الموظفين</h1></div>{snapshot.capabilities.invite && <button type="button" onClick={() => setInviteOpen(true)} disabled={snapshot.departments.length === 0} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50"><Plus className="size-4" aria-hidden="true" /> دعوة موظف</button>}</div></header>
      <div className="mx-auto max-w-7xl px-5 py-7">
        <label className="relative block max-w-xl"><span className="sr-only">بحث في الموظفين</span><Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الرقم أو المسمى" className="w-full rounded-md border border-gray-300 bg-white py-2.5 pe-10 ps-3" /></label>
        {items.length === 0 ? <section className="py-20 text-center"><Users className="mx-auto size-10 text-gray-400" aria-hidden="true" /><h2 className="mt-4 text-lg font-bold">{snapshot.items.length === 0 ? 'لا يوجد موظفون بعد' : 'لا توجد نتائج مطابقة'}</h2></section> : (
          <div className="mt-6 overflow-x-auto border border-gray-200 bg-white">
            <table className="w-full min-w-[760px] text-right"><thead className="bg-gray-50 text-sm text-gray-600"><tr><th className="px-4 py-3">الموظف</th><th className="px-4 py-3">المسمى</th><th className="px-4 py-3">القسم</th><th className="px-4 py-3">النوع</th><th className="px-4 py-3">الحالة</th><th className="px-4 py-3"><span className="sr-only">الإجراءات</span></th></tr></thead><tbody className="divide-y divide-gray-100">{items.map((item) => <tr key={item.userId}><td className="px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-md bg-teal-50 text-teal-800"><UserRound className="size-4" aria-hidden="true" /></span><div><p className="font-bold">{item.displayName}</p><p dir="ltr" className="text-left text-xs text-gray-500">{item.employeeNumber}</p></div></div></td><td className="px-4 py-4 text-sm">{item.jobTitle}</td><td className="px-4 py-4 text-sm">{item.departmentName}</td><td className="px-4 py-4 text-sm">{item.employmentType === 'contractor' ? 'متعاون' : 'موظف'}</td><td className="px-4 py-4 text-sm">{item.status === 'active' ? 'نشط' : item.status === 'planned' ? 'مدعو' : item.status === 'suspended' ? 'موقوف' : item.status}</td><td className="px-4 py-4">{snapshot.capabilities.disable && item.status === 'active' && <button type="button" onClick={() => setDisableTarget({ userId: item.userId, displayName: item.displayName })} className="rounded-md px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50">تعطيل</button>}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
      {inviteOpen && <InviteDialog snapshot={snapshot} onClose={() => setInviteOpen(false)} onSubmit={async (input) => { await client.invite(organizationId, input); await load() }} />}
      {disableTarget && <DisableDialog displayName={disableTarget.displayName} onClose={() => setDisableTarget(null)} onConfirm={async (reason) => { await client.disable(organizationId, disableTarget.userId, reason); await load() }} />}
    </main>
  )
}

export function EmployeeDirectoryPage() {
  useAuth()
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <EmployeeDirectoryScreen organizationId={organizationId} client={employeeDirectoryClient} />
}
