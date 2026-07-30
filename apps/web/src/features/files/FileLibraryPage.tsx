import { Download, File, LoaderCircle, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import { fileLibraryClient, type FileLibraryClient, type FileLibrarySnapshot } from './client'

export function FileLibraryScreen({
  organizationId, client, initialResourceId = '',
}: {
  organizationId: string; client: FileLibraryClient; initialResourceId?: string
}) {
  const [snapshot, setSnapshot] = useState<FileLibrarySnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<File | null>(null)
  const [resourceId, setResourceId] = useState(initialResourceId)
  const [resourceType, setResourceType] = useState<'task' | 'project'>('task')
  const [visibility, setVisibility] = useState<'internal' | 'client'>('internal')
  const inputRef = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    setStatus('loading')
    try { setSnapshot(await client.load(organizationId)); setStatus('ready') }
    catch { setStatus('error') }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then(
      (value) => { if (active) { setSnapshot(value); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId])
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل الملفات...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>تعذر تحميل مكتبة الملفات</h1></main>
  const uploadSelected = async () => {
    if (!selected || !resourceId.trim()) return
    await client.upload(organizationId, {
      file: selected, resourceType, resourceId: resourceId.trim(), visibility,
    })
    setSelected(null)
    if (inputRef.current) inputRef.current.value = ''
    await load()
  }
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-sm font-bold text-teal-800">المحتوى</p><h1 className="text-2xl font-black">مكتبة الملفات</h1></div></header>
    {!snapshot.provider.configured && <section role="alert" className="mx-auto mt-6 flex max-w-6xl gap-3 border border-amber-300 bg-amber-50 p-4 text-amber-900"><ShieldAlert className="size-5 shrink-0" aria-hidden="true" /><div><h2 className="font-black">التخزين غير مهيأ</h2><p className="text-sm">الرفع والتنزيل متوقفان حتى تهيئة مزود التخزين الخاص.</p></div></section>}
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[1fr_340px]">
      <section aria-labelledby="file-list-heading"><h2 id="file-list-heading" className="mb-3 text-lg font-black">الملفات المتاحة</h2><div className="space-y-3">{snapshot.files.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4"><div className="flex min-w-0 items-center gap-3"><File className="size-5 shrink-0 text-teal-800" aria-hidden="true" /><div className="min-w-0"><h3 className="truncate font-black">{item.displayName}</h3><p className="mt-1 text-xs text-gray-500">{item.resourceTitle} · v{item.latestVersionNumber} · {(item.sizeBytes / 1024).toFixed(1)} KB · {item.visibility === 'internal' ? 'داخلي' : 'ظاهر للعميل'}</p></div></div><div className="flex gap-2">{item.canDownload && snapshot.provider.configured && <button aria-label={`تنزيل ${item.displayName}`} title="تنزيل" onClick={() => void client.download(organizationId, item.id).then(({ url }) => { window.location.assign(url) })} className="grid size-9 place-items-center rounded-md border"><Download className="size-4" aria-hidden="true" /></button>}{item.canDelete && <button aria-label={`حذف ${item.displayName}`} title="حذف" onClick={() => { if (window.confirm('سيُنقل الملف إلى المحذوفات لمدة 30 يومًا.')) void client.delete(organizationId, item.id, item.version).then(load) }} className="grid size-9 place-items-center rounded-md border text-red-800"><Trash2 className="size-4" aria-hidden="true" /></button>}</div></article>)}{snapshot.files.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">لا توجد ملفات متاحة ضمن نطاقك.</div>}</div></section>
      {snapshot.capabilities.upload && <aside><form onSubmit={(event) => { event.preventDefault(); void uploadSelected() }} className="border bg-white p-5"><h2 className="font-black">رفع ملف</h2><label className="mt-4 block text-sm font-bold">المورد<select value={resourceType} onChange={(event) => setResourceType(event.target.value as 'task' | 'project')} className="mt-2 w-full rounded-md border p-2"><option value="task">مهمة</option><option value="project">مشروع</option></select></label><label className="mt-4 block text-sm font-bold">معرّف المورد<input required value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="mt-2 w-full rounded-md border p-2" /></label>{snapshot.capabilities.shareWithClient && <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={visibility === 'client'} onChange={(event) => setVisibility(event.target.checked ? 'client' : 'internal')} /> ظاهر للعميل</label>}<label className="mt-4 block text-sm font-bold">الملف<input ref={inputRef} type="file" onChange={(event) => setSelected(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" /></label><p className="mt-2 text-xs text-gray-500">PDF، صور، نص، وملفات Office حتى 100 MB. يخضع الملف للفحص قبل الإتاحة.</p><button disabled={!snapshot.provider.configured || !selected || !resourceId.trim()} type="submit" className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50"><Upload className="size-4" aria-hidden="true" /> رفع آمن</button></form></aside>}
    </div>
  </main>
}

export function FileLibraryPage() {
  const { organizationId } = useTenant()
  const [params] = useSearchParams()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <FileLibraryScreen organizationId={organizationId} client={fileLibraryClient} initialResourceId={params.get('resourceId') ?? ''} />
}
