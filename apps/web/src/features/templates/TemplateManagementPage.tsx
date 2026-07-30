import { FileStack, LoaderCircle, Pause, Play, Plus, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { templateClient, type TemplateClient, type TemplateSnapshot } from './client'

export function TemplateManagementScreen({
  organizationId,
  client,
}: {
  organizationId: string
  client: TemplateClient
}) {
  const [snapshot, setSnapshot] = useState<TemplateSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [name, setName] = useState('')
  const [templateType, setTemplateType] = useState<'task' | 'project'>('task')
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setSnapshot(await client.load(organizationId))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then(
      (value) => { if (active) { setSnapshot(value); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') {
    return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل القوالب...</p></main>
  }
  if (status === 'error' || !snapshot) {
    return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>تعذر تحميل القوالب</h1></main>
  }
  const create = async () => {
    if (!name.trim()) return
    await client.create(organizationId, { name: name.trim(), templateType })
    setName('')
    await load()
  }
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-sm font-bold text-teal-800">مكتبة التشغيل</p><h1 className="text-2xl font-black">القوالب والعمل المتكرر</h1></div></header>
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <section aria-labelledby="templates-heading">
          <h2 id="templates-heading" className="mb-3 text-lg font-black">القوالب</h2>
          <div className="space-y-3">{snapshot.templates.map((template) => <article key={template.id} className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div><h3 className="flex items-center gap-2 font-black"><FileStack className="size-5 text-teal-800" aria-hidden="true" /> {template.name}</h3><p className="mt-1 text-sm text-gray-500">{template.templateType === 'task' ? 'مهمة' : 'مشروع'} · {template.status === 'published' ? 'منشور' : template.status === 'draft' ? 'مسودة' : 'مؤرشف'} · v{template.version}</p></div>
            {snapshot.capabilities.publish && template.status === 'draft' && <button onClick={() => void client.publish(organizationId, template.id, template.version).then(load)} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 font-bold text-white"><Send className="size-4" aria-hidden="true" /> نشر</button>}
          </article>)}
          {snapshot.templates.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">لا توجد قوالب بعد.</div>}</div>
        </section>
        <section aria-labelledby="recurrences-heading">
          <h2 id="recurrences-heading" className="mb-3 text-lg font-black">الجداول المتكررة</h2>
          <div className="space-y-3">{snapshot.schedules.map((schedule) => <article key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 border bg-white p-4">
            <div><h3 className="font-black">{schedule.templateName}</h3><p className="mt-1 text-sm text-gray-500">{schedule.frequency} · {schedule.timeLocal} · {schedule.timezone}</p><p className="mt-1 text-xs text-gray-500">التشغيل التالي: {schedule.nextRunAt ?? 'غير محدد'}</p></div>
            {snapshot.capabilities.manageRecurrence && schedule.status !== 'archived' && <button aria-label={schedule.status === 'active' ? `إيقاف ${schedule.templateName}` : `استئناف ${schedule.templateName}`} onClick={() => void client.setScheduleStatus(organizationId, schedule.id, schedule.version, schedule.status === 'active' ? 'paused' : 'active').then(load)} className="grid size-10 place-items-center rounded-md border" title={schedule.status === 'active' ? 'إيقاف مؤقت' : 'استئناف'}>{schedule.status === 'active' ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}</button>}
          </article>)}
          {snapshot.schedules.length === 0 && <div className="border bg-white p-8 text-center text-gray-500">لا توجد جداول متكررة.</div>}</div>
        </section>
      </div>
      {snapshot.capabilities.create && <aside><form onSubmit={(event) => { event.preventDefault(); void create() }} className="border bg-white p-5"><h2 className="font-black">قالب جديد</h2><label className="mt-4 block text-sm font-bold">الاسم<input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-md border p-2" /></label><label className="mt-4 block text-sm font-bold">النوع<select value={templateType} onChange={(event) => setTemplateType(event.target.value as 'task' | 'project')} className="mt-2 w-full rounded-md border p-2"><option value="task">مهمة</option><option value="project">مشروع</option></select></label><button type="submit" className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 font-bold text-white"><Plus className="size-4" aria-hidden="true" /> إنشاء مسودة</button></form></aside>}
    </div>
  </main>
}

export function TemplateManagementPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <TemplateManagementScreen organizationId={organizationId} client={templateClient} />
}
