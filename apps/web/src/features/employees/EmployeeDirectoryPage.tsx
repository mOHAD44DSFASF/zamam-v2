import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Plus, RefreshCw, Search, ShieldX, UserRound, Users, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import {
  employeeDirectoryClient,
  type EmployeeDirectoryClient,
  type EmployeeDirectorySnapshot,
  type InviteEmployeeForm,
} from './client'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

const fieldLabel = 'text-label font-semibold text-text-secondary'
const fieldInput = 'mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2.5 text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400'

const statusLabel: Record<string, string> = { active: 'نشط', planned: 'مدعو', suspended: 'موقوف' }
const statusBadgeClass: Record<string, string> = {
  active: 'bg-success-subtle text-success', planned: 'bg-warning-subtle text-warning', suspended: 'bg-danger-subtle text-danger',
}

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
  useEscapeToClose(onClose)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        dir="rtl"
        className="my-6 w-full max-w-2xl rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in"
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
              role: (data.get('role') === 'DepartmentLead' || data.get('role') === 'Manager') ? data.get('role') as 'DepartmentLead' | 'Manager' : 'Employee',
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
          <h2 id={titleId} className="text-h1 font-extrabold text-text-primary">دعوة موظف</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 cursor-pointer place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <p className="mt-2 text-body text-text-secondary">اختر دور الموظف أدناه — "قائد قسم" يمنح صلاحية إنشاء المهام لقسمه فقط، و"مدير" يمنحها في كل الأقسام.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>الاسم الكامل<input ref={firstInput} name="displayName" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>الاسم الأول<input name="firstName" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>البريد الإلكتروني<input name="email" type="email" required dir="ltr" className={`${fieldInput} text-left`} /></label>
          <label className={fieldLabel}>رقم الموظف<input name="employeeNumber" required pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,31}" dir="ltr" className={`${fieldInput} text-left`} /></label>
          <label className={fieldLabel}>المسمى الوظيفي<input name="jobTitle" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>نوع العلاقة<select name="employmentType" className={`${fieldInput} cursor-pointer`}><option value="employee">موظف</option><option value="contractor">متعاون خارجي</option></select></label>
          <label className={fieldLabel}>القسم الأساسي<select name="primaryDepartmentId" required className={`${fieldInput} cursor-pointer`}>{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className={fieldLabel}>تاريخ البدء<input name="startDate" type="date" required className={`${fieldInput} cursor-pointer`} /></label>
          <label className={fieldLabel}>الدور<select name="role" className={`${fieldInput} cursor-pointer`}><option value="Employee">موظف</option><option value="DepartmentLead">قائد قسم (إنشاء مهام لقسمه فقط)</option><option value="Manager">مدير (إنشاء مهام في كل الأقسام)</option></select></label>
        </div>
        {error && <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-label font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-strong px-4 py-2 font-semibold text-text-primary transition-colors hover:bg-surface-hover">إلغاء</button>
          <button type="submit" disabled={submitting || snapshot.departments.length === 0} className="cursor-pointer rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'جارٍ الإرسال...' : 'إرسال الدعوة'}</button>
        </div>
      </form>
    </div>
  )
}

function DisableDialog({ displayName, onClose, onConfirm }: { displayName: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEscapeToClose(onClose)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-backdrop-in" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
      <form dir="rtl" className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in" onSubmit={async (event) => {
        event.preventDefault()
        setSubmitting(true)
        try { await onConfirm(reason); onClose() } finally { setSubmitting(false) }
      }}>
        <div className="grid size-11 place-items-center rounded-full bg-danger-subtle"><ShieldX className="size-5 text-danger" aria-hidden="true" /></div>
        <h2 id={titleId} className="mt-3 text-h1 font-extrabold text-text-primary">تعطيل {displayName}</h2>
        <p className="mt-2 text-body text-text-secondary">سيُمنع الوصول فورًا وتُبطل الجلسات. لا تُحذف السجلات.</p>
        <label className={`mt-4 block ${fieldLabel}`}>سبب التعطيل<textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={`${fieldInput} min-h-24`} /></label>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-strong px-4 py-2 font-semibold text-text-primary transition-colors hover:bg-surface-hover">إلغاء</button>
          <button type="submit" disabled={submitting} className="cursor-pointer rounded-md bg-danger px-4 py-2 font-bold text-canvas transition-all hover:bg-danger/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">تأكيد التعطيل</button>
        </div>
      </form>
    </div>
  )
}

export function EmployeeDirectoryScreen({ organizationId, client, hideHeader = false }: { organizationId: string; client: EmployeeDirectoryClient; hideHeader?: boolean }) {
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

  if (status === 'loading') return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">جارٍ تحميل الموظفين...</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
        <div><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-40 rounded-md bg-surface-hover" /></div>
        <div className="h-10 w-28 rounded-md bg-surface-hover" />
      </div></header>
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="h-10 w-64 rounded-md bg-surface-hover" />
        <div className="mt-4 space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 rounded-md border border-border-subtle bg-surface" />)}</div>
      </div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas p-6"><section className="text-center"><div className="mx-auto grid size-14 place-items-center rounded-full bg-danger-subtle"><AlertTriangle className="size-7 text-danger" aria-hidden="true" /></div><h1 className="mt-4 text-h1 font-extrabold text-text-primary">تعذر تحميل دليل الموظفين</h1><p className="mt-2 text-body text-text-secondary">الخدمة غير متاحة أو لا تملك الصلاحية.</p><button type="button" onClick={() => void load()} className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>

  const normalized = query.trim().toLocaleLowerCase('ar')
  const items = snapshot.items.filter((item) => !normalized || `${item.displayName} ${item.employeeNumber} ${item.jobTitle} ${item.departmentName}`.toLocaleLowerCase('ar').includes(normalized))

  return (
    <main dir="rtl" className="min-h-screen bg-canvas">
      {hideHeader
        ? snapshot.capabilities.invite && <div className="mx-auto flex max-w-7xl justify-end px-5 pt-6"><button type="button" onClick={() => setInviteOpen(true)} disabled={snapshot.departments.length === 0} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" aria-hidden="true" /> دعوة موظف</button></div>
        : <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6"><div><p className="text-label font-semibold text-brand-300">الأفراد</p><h1 className="mt-1 text-display font-extrabold text-text-primary">دليل الموظفين</h1></div>{snapshot.capabilities.invite && <button type="button" onClick={() => setInviteOpen(true)} disabled={snapshot.departments.length === 0} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" aria-hidden="true" /> دعوة موظف</button>}</div></header>}
      <div className="mx-auto max-w-7xl px-5 py-7">
        <label className="relative block max-w-xl"><span className="sr-only">بحث في الموظفين</span><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الرقم أو المسمى" className="w-full rounded-md border border-border-strong bg-surface py-2.5 pe-10 ps-3 text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400" /></label>
        {items.length === 0 ? <section className="flex flex-col items-center gap-3 py-20 text-center"><div className="grid size-14 place-items-center rounded-full bg-surface-hover"><Users className="size-7 text-text-tertiary" aria-hidden="true" /></div><h2 className="text-h2 font-bold text-text-primary">{snapshot.items.length === 0 ? 'لا يوجد موظفون بعد' : 'لا توجد نتائج مطابقة'}</h2>{snapshot.items.length === 0 && snapshot.capabilities.invite && <button type="button" onClick={() => setInviteOpen(true)} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98]"><Plus className="size-4" aria-hidden="true" /> دعوة أول موظف</button>}</section> : (
          <div className="mt-6 overflow-x-auto rounded-md border border-border-subtle bg-surface">
            <table className="w-full min-w-[760px] text-right"><thead className="border-b border-border-subtle bg-surface-hover text-label text-text-secondary"><tr><th className="px-4 py-3 font-semibold">الموظف</th><th className="px-4 py-3 font-semibold">المسمى</th><th className="px-4 py-3 font-semibold">القسم</th><th className="px-4 py-3 font-semibold">النوع</th><th className="px-4 py-3 font-semibold">الحالة</th><th className="px-4 py-3"><span className="sr-only">الإجراءات</span></th></tr></thead><tbody className="divide-y divide-border-subtle">{items.map((item) => <tr key={item.userId} className="transition-colors hover:bg-surface-hover"><td className="px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-subtle text-brand-300"><UserRound className="size-4" aria-hidden="true" /></span><div><p className="font-bold text-text-primary">{item.displayName}</p><p dir="ltr" className="text-left text-caption text-text-tertiary">{item.employeeNumber}</p></div></div></td><td className="px-4 py-4 text-body text-text-secondary">{item.jobTitle}</td><td className="px-4 py-4 text-body text-text-secondary">{item.departmentName}</td><td className="px-4 py-4 text-body text-text-secondary">{item.employmentType === 'contractor' ? 'متعاون' : 'موظف'}</td><td className="px-4 py-4"><span className={`rounded-sm px-2 py-0.5 text-caption font-bold ${statusBadgeClass[item.status] ?? 'bg-surface-hover text-text-secondary'}`}>{statusLabel[item.status] ?? item.status}</span></td><td className="px-4 py-4">{snapshot.capabilities.disable && item.status === 'active' && <button type="button" onClick={() => setDisableTarget({ userId: item.userId, displayName: item.displayName })} className="cursor-pointer rounded-md px-3 py-2 text-body font-bold text-danger transition-colors hover:bg-danger-subtle">تعطيل</button>}</td></tr>)}</tbody></table>
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
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  return <EmployeeDirectoryScreen organizationId={organizationId} client={employeeDirectoryClient} />
}
