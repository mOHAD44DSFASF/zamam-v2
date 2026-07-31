import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Building, LoaderCircle, Plus, RefreshCw, Search, UserRound, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import {
  clientManagementClient,
  type ClientManagementClient,
  type ClientManagementSnapshot,
} from './client'

function EntryDialog({
  mode,
  clientId,
  onClose,
  onCreateClient,
  onCreateContact,
}: {
  mode: 'client' | 'contact'
  clientId?: string
  onClose: () => void
  onCreateClient: (input: { name: string; code: string; industry?: string }) => Promise<void>
  onCreateContact: (input: { clientId: string; name: string; email: string; clientAdmin: boolean }) => Promise<void>
}) {
  const titleId = useId()
  const first = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => first.current?.focus(), [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onSubmit={async (event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        setSubmitting(true)
        setError('')
        try {
          if (mode === 'client') await onCreateClient({
            name: String(data.get('name')), code: String(data.get('code')),
            ...(data.get('industry') ? { industry: String(data.get('industry')) } : {}),
          })
          else await onCreateContact({
            clientId: clientId ?? '', name: String(data.get('name')),
            email: String(data.get('email')), clientAdmin: data.get('clientAdmin') === 'on',
          })
          onClose()
        } catch {
          setError('تعذر حفظ السجل. لم يتغير وصول البوابة.')
        } finally {
          setSubmitting(false)
        }
      }}>
        <div className="flex items-center justify-between"><h2 id={titleId} className="text-lg font-black">{mode === 'client' ? 'إضافة عميل' : 'إضافة جهة اتصال'}</h2><button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 place-items-center rounded-md hover:bg-gray-100"><X className="size-5" aria-hidden="true" /></button></div>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-semibold">الاسم<input ref={first} name="name" required minLength={2} maxLength={160} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          {mode === 'client' ? <>
            <label className="block text-sm font-semibold">الرمز<input name="code" required dir="ltr" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
            <label className="block text-sm font-semibold">القطاع<input name="industry" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          </> : <>
            <label className="block text-sm font-semibold">البريد الإلكتروني<input name="email" type="email" required dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input name="clientAdmin" type="checkbox" /> مسؤول اتصالات العميل</label>
            <p className="text-xs leading-6 text-gray-500">إضافة جهة الاتصال لا ترسل دعوة ولا تمنح صلاحية دخول.</p>
          </>}
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-bold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-md border px-4 py-2 font-semibold">إلغاء</button><button type="submit" disabled={submitting} className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50">حفظ</button></div>
      </form>
    </div>
  )
}

export function ClientManagementScreen({ organizationId, client }: { organizationId: string; client: ClientManagementClient }) {
  const [snapshot, setSnapshot] = useState<ClientManagementSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'client' | 'contact' | null>(null)
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const value = await client.load(organizationId)
      setSnapshot(value)
      setSelectedId((current) => current && value.clients.some(({ id }) => id === current) ? current : value.clients[0]?.id ?? null)
      setStatus('ready')
    } catch { setStatus('error') }
  }, [client, organizationId])

  useEffect(() => {
    let active = true
    client.load(organizationId).then((value) => {
      if (!active) return
      setSnapshot(value)
      setSelectedId(value.clients[0]?.id ?? null)
      setStatus('ready')
    }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') return <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50"><p role="status" className="flex gap-2"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل العملاء...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50"><section className="text-center"><AlertTriangle className="mx-auto size-8 text-amber-700" aria-hidden="true" /><h1 className="mt-4 text-xl font-black">تعذر تحميل العملاء</h1><button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2 font-bold"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>

  const normalized = query.trim().toLocaleLowerCase('ar')
  const clients = snapshot.clients.filter((item) => !normalized || `${item.name} ${item.code} ${item.industry ?? ''}`.toLocaleLowerCase('ar').includes(normalized))
  const selected = snapshot.clients.find(({ id }) => id === selectedId) ?? null
  const contacts = snapshot.contacts.filter(({ clientId }) => clientId === selectedId)

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50">
      <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-6"><div><p className="text-sm font-semibold text-teal-800">العلاقات</p><h1 className="mt-1 text-2xl font-black">العملاء</h1></div>{snapshot.capabilities.create && <button type="button" onClick={() => setDialog('client')} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white"><Plus className="size-4" aria-hidden="true" /> عميل</button>}</div></header>
      <div className="mx-auto grid max-w-7xl gap-0 px-5 py-7 lg:grid-cols-[320px_1fr]">
        <aside className="border border-gray-200 bg-white">
          <label className="relative block border-b p-3"><span className="sr-only">بحث في العملاء</span><Search className="absolute right-6 top-1/2 size-4 -translate-y-1/2 text-gray-500" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث" className="w-full rounded-md border py-2 pe-9 ps-3" /></label>
          <div className="divide-y">{clients.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-current={selectedId === item.id ? 'true' : undefined} className="flex w-full items-center gap-3 px-4 py-4 text-right hover:bg-gray-50 aria-[current=true]:bg-teal-50"><Building className="size-5 text-teal-800" aria-hidden="true" /><span className="min-w-0"><span className="block truncate font-bold">{item.name}</span><span dir="ltr" className="block text-left text-xs text-gray-500">{item.code}</span></span></button>)}</div>
          {clients.length === 0 && <p className="p-6 text-center text-sm text-gray-500">{snapshot.clients.length ? 'لا توجد نتائج مطابقة' : 'لا يوجد عملاء بعد'}</p>}
        </aside>
        <section className="border border-r-0 border-gray-200 bg-white p-6" aria-live="polite">
          {!selected ? <div className="grid min-h-72 place-items-center text-gray-500">اختر عميلاً لعرض التفاصيل.</div> : <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5"><div><h2 className="text-xl font-black">{selected.name}</h2><p className="mt-1 text-sm text-gray-500">{selected.industry ?? 'دون قطاع'} · {selected.activeProjectCount} مشروع نشط · {selected.status}</p></div><div className="flex items-center gap-2">{snapshot.capabilities.manage && ['lead', 'paused'].includes(selected.status) && <button type="button" onClick={async () => { await client.transition(organizationId, { clientId: selected.id, expectedVersion: selected.version, targetStatus: 'active' }); await load() }} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 text-sm font-bold text-white">تفعيل</button>}{snapshot.capabilities.manageContacts && <button type="button" onClick={() => setDialog('contact')} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold"><Plus className="size-4" aria-hidden="true" /> جهة اتصال</button>}</div></div>
            <h3 className="mt-6 font-black">جهات الاتصال</h3>
            {contacts.length === 0 ? <p className="mt-4 text-sm text-gray-500">لا توجد جهات اتصال.</p> : <div className="mt-3 divide-y">{contacts.map((contact) => <div key={contact.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="flex items-center gap-3"><UserRound className="size-5 text-gray-500" aria-hidden="true" /><div><p className="font-bold">{contact.name}</p><p dir="ltr" className="text-left text-sm text-gray-500">{contact.emailDisplay}</p></div></div><span className="text-sm">{contact.portalStatus === 'eligible' ? 'مؤهل للبوابة' : contact.portalStatus === 'active' ? 'نشط بالبوابة' : 'دون وصول'}</span>{snapshot.capabilities.manageContacts && ['none', 'eligible'].includes(contact.portalStatus) && <button type="button" onClick={async () => { await client.setEligibility(organizationId, { clientId: selected.id, contactId: contact.id, expectedVersion: contact.version, eligible: contact.portalStatus !== 'eligible' }); await load() }} className="rounded-md px-3 py-2 text-sm font-bold text-teal-800 hover:bg-teal-50">{contact.portalStatus === 'eligible' ? 'إلغاء الأهلية' : 'تحديد كمؤهل'}</button>}</div>)}</div>}
          </>}
        </section>
      </div>
      {dialog && <EntryDialog mode={dialog} clientId={selected?.id} onClose={() => setDialog(null)} onCreateClient={async (input) => { await client.create(organizationId, input); await load() }} onCreateContact={async (input) => { await client.addContact(organizationId, input); await load() }} />}
    </main>
  )
}

export function ClientManagementPage() {
  useAuth()
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <ClientManagementScreen organizationId={organizationId} client={clientManagementClient} />
}
