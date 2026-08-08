import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Archive, CalendarDays, Eye, EyeOff, FolderKanban, LoaderCircle, Plus, RefreshCw, Search, Users, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import { projectManagementClient, type ProjectManagementClient, type ProjectManagementSnapshot } from './client'

function CreateProjectDialog({ snapshot, onClose, onSubmit }: {
  snapshot: ProjectManagementSnapshot
  onClose: () => void
  onSubmit: (input: {
    clientId?: string; name: string; code: string; departmentId?: string; managerUserId: string;
    startsOn?: string; dueOn?: string; clientVisible: boolean
  }) => Promise<void>
}) {
  const titleId = useId()
  const first = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => first.current?.focus(), [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="my-6 w-full max-w-2xl rounded-lg border border-border-subtle bg-surface-raised p-6 text-text-primary" onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setSubmitting(true)
        setError('')
        try {
          await onSubmit({
            name: String(data.get('name')), code: String(data.get('code')),
            managerUserId: String(data.get('managerUserId')),
            ...(data.get('departmentId') ? { departmentId: String(data.get('departmentId')) } : {}),
            ...(data.get('startsOn') ? { startsOn: String(data.get('startsOn')) } : {}),
            ...(data.get('dueOn') ? { dueOn: String(data.get('dueOn')) } : {}),
            clientVisible: data.get('clientVisible') === 'on',
          })
          onClose()
        } catch { setError('تعذر إنشاء المشروع. راجع المراجع والتواريخ.') } finally { setSubmitting(false) }
      }}>
        <div className="flex items-center justify-between"><h2 id={titleId} className="text-xl font-black">مشروع جديد</h2><button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 place-items-center rounded-md text-text-secondary hover:bg-surface-hover"><X className="size-5" aria-hidden="true" /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">اسم المشروع<input ref={first} name="name" required minLength={2} className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary" /></label>
          <label className="text-sm font-semibold">الرمز<input name="code" required dir="ltr" pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,31}" className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-left text-text-primary" /></label>
          <label className="text-sm font-semibold">مدير المشروع<select name="managerUserId" required className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary">{snapshot.managers.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select></label>
          <label className="text-sm font-semibold">القسم<select name="departmentId" className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary"><option value="">دون قسم</option>{snapshot.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <span aria-hidden="true" />
          <label className="text-sm font-semibold">تاريخ البدء<input name="startsOn" type="date" className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary" /></label>
          <label className="text-sm font-semibold">موعد التسليم<input name="dueOn" type="date" className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary" /></label>
          <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input name="clientVisible" type="checkbox" /> نشر المشروع في بوابة العميل</label>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-bold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-md border border-border-strong px-4 py-2 font-semibold text-text-primary hover:bg-surface-hover">إلغاء</button><button type="submit" disabled={submitting || !snapshot.managers.length} className="rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary hover:bg-brand-400 disabled:opacity-50">إنشاء</button></div>
      </form>
    </div>
  )
}

const statusLabel: Record<string, string> = {
  draft: 'مسودة', planned: 'مخطط', active: 'نشط', on_hold: 'متوقف', completed: 'مكتمل', archived: 'مؤرشف', cancelled: 'ملغي',
}

export function ProjectManagementScreen({ organizationId, client }: { organizationId: string; client: ProjectManagementClient }) {
  const [snapshot, setSnapshot] = useState<ProjectManagementSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const value = await client.load(organizationId)
      setSnapshot(value)
      setSelectedId((current) => current && value.projects.some(({ id }) => id === current) ? current : value.projects[0]?.id ?? null)
      setStatus('ready')
    } catch { setStatus('error') }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then((value) => {
      if (!active) return
      setSnapshot(value); setSelectedId(value.projects[0]?.id ?? null); setStatus('ready')
    }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') return <main dir="rtl" className="min-h-screen grid place-items-center bg-canvas text-text-secondary"><p role="status" className="flex gap-2"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل المشاريع...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="min-h-screen grid place-items-center bg-canvas"><section className="text-center"><AlertTriangle className="mx-auto size-8 text-warning" aria-hidden="true" /><h1 className="mt-4 text-xl font-black text-text-primary">تعذر تحميل المشاريع</h1><button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 font-bold text-text-primary hover:bg-surface-hover"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>
  const normalized = query.trim().toLocaleLowerCase('ar')
  const projects = snapshot.projects.filter((item) => !normalized || `${item.name} ${item.code} ${item.clientName}`.toLocaleLowerCase('ar').includes(normalized))
  const selected = snapshot.projects.find(({ id }) => id === selectedId) ?? null
  return (
    <main dir="rtl" className="min-h-screen bg-canvas text-text-primary">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-6"><div><p className="text-sm font-semibold text-brand-300">التنفيذ</p><h1 className="mt-1 text-2xl font-black">المشاريع</h1></div>{snapshot.capabilities.create && <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary hover:bg-brand-400"><Plus className="size-4" aria-hidden="true" /> مشروع</button>}</div></header>
      <div className="mx-auto grid max-w-7xl px-5 py-7 lg:grid-cols-[330px_1fr]">
        <aside className="border border-border-subtle bg-surface"><label className="relative block border-b border-border-subtle p-3"><span className="sr-only">بحث في المشاريع</span><Search className="absolute right-6 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث" className="w-full rounded-md border border-border-strong bg-canvas py-2 pe-9 ps-3 text-text-primary placeholder:text-text-tertiary" /></label><div className="divide-y divide-border-subtle">{projects.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-current={selectedId === item.id ? 'true' : undefined} className="flex w-full gap-3 px-4 py-4 text-right hover:bg-surface-hover aria-[current=true]:bg-brand-subtle"><FolderKanban className="mt-0.5 size-5 shrink-0 text-brand-300" aria-hidden="true" /><span className="min-w-0"><span className="block truncate font-bold">{item.name}</span><span className="block truncate text-xs text-text-tertiary">{item.clientName ? `${item.clientName} · ` : ''}{statusLabel[item.status]}</span></span></button>)}</div>{projects.length === 0 && <p className="p-6 text-center text-sm text-text-tertiary">لا توجد مشاريع.</p>}</aside>
        <section className="border border-r-0 border-border-subtle bg-surface p-6">{!selected ? <div className="grid min-h-72 place-items-center text-text-tertiary">اختر مشروعًا.</div> : <>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle pb-5"><div><div className="flex items-center gap-2"><h2 className="text-xl font-black">{selected.name}</h2><span className="rounded bg-surface-hover px-2 py-1 text-xs font-bold text-text-secondary">{statusLabel[selected.status]}</span></div><p className="mt-1 text-sm text-text-tertiary">{selected.clientName ? `${selected.clientName} · ` : ''}<span dir="ltr">{selected.code}</span></p></div>{snapshot.capabilities.manage && selected.status === 'draft' && <button type="button" onClick={async () => { await client.transition(organizationId, selected.id, selected.version, 'planned'); await load() }} className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-bold text-text-primary hover:bg-brand-400">اعتماد الخطة</button>}{snapshot.capabilities.manage && selected.status === 'planned' && <button type="button" onClick={async () => { await client.transition(organizationId, selected.id, selected.version, 'active'); await load() }} className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-bold text-text-primary hover:bg-brand-400">تفعيل</button>}{snapshot.capabilities.manage && ['active', 'on_hold'].includes(selected.status) && <button type="button" onClick={async () => { await client.transition(organizationId, selected.id, selected.version, 'completed'); await load() }} className="inline-flex items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-sm font-bold text-text-primary hover:bg-brand-400">إكمال</button>}{snapshot.capabilities.manage && !['completed', 'archived', 'cancelled'].includes(selected.status) && <button type="button" onClick={async () => { await client.transition(organizationId, selected.id, selected.version, 'cancelled'); await load() }} className="inline-flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-bold text-text-secondary hover:bg-surface-hover">إلغاء</button>}{snapshot.capabilities.manage && !['archived', 'cancelled'].includes(selected.status) && <button type="button" onClick={async () => { await client.setClientVisibility(organizationId, selected.id, selected.version, !selected.clientVisible); await load() }} className="inline-flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-bold text-text-primary hover:bg-surface-hover">{selected.clientVisible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}{selected.clientVisible ? 'إخفاء عن العميل' : 'نشر للعميل'}</button>}{snapshot.capabilities.archive && ['completed', 'cancelled'].includes(selected.status) && <button type="button" onClick={async () => { await client.archive(organizationId, selected.id, selected.version); setSelectedId(null); await load() }} className="inline-flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-bold text-text-secondary hover:border-danger/40 hover:bg-danger-subtle hover:text-danger"><Archive className="size-4" aria-hidden="true" /> أرشفة</button>}</div>
          <div className="grid gap-5 border-b border-border-subtle py-6 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-text-tertiary">المدير</p><p className="mt-1 font-bold">{selected.managerName}</p></div><div><p className="text-xs text-text-tertiary">القسم</p><p className="mt-1 font-bold">{selected.departmentName ?? 'دون قسم'}</p></div><div><p className="text-xs text-text-tertiary">الفريق</p><p className="mt-1 flex items-center gap-2 font-bold"><Users className="size-4" aria-hidden="true" /> {selected.activeMemberCount}</p></div><div><p className="text-xs text-text-tertiary">المهام المفتوحة</p><p className="mt-1 font-bold">{selected.openTaskCount}</p></div></div>
          <div className="grid gap-5 py-6 sm:grid-cols-2"><div className="flex items-center gap-3"><CalendarDays className="size-5 text-text-tertiary" aria-hidden="true" /><div><p className="text-xs text-text-tertiary">البدء</p><p className="font-bold">{selected.startsOn ?? 'غير محدد'}</p></div></div><div className="flex items-center gap-3"><CalendarDays className="size-5 text-text-tertiary" aria-hidden="true" /><div><p className="text-xs text-text-tertiary">التسليم</p><p className="font-bold">{selected.dueOn ?? 'غير محدد'}</p></div></div></div>
          {!snapshot.capabilities.viewFinancial && <p className="border-t border-border-subtle pt-5 text-sm text-text-tertiary">البيانات المالية غير متاحة ضمن صلاحياتك.</p>}
        </>}</section>
      </div>
      {createOpen && <CreateProjectDialog snapshot={snapshot} onClose={() => setCreateOpen(false)} onSubmit={async (input) => { await client.create(organizationId, input); await load() }} />}
    </main>
  )
}

export function ProjectManagementPage() {
  useAuth()
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center bg-canvas text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  return <ProjectManagementScreen organizationId={organizationId} client={projectManagementClient} />
}
