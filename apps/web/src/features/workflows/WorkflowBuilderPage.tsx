import { AlertTriangle, ArrowLeft, CheckCircle2, LoaderCircle, Play, Plus, Save, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import { workflowBuilderClient, type WorkflowBuilderClient, type WorkflowBuilderSnapshot, type WorkflowDefinitionInput } from './client'

export function WorkflowBuilderScreen({ organizationId, templateId, client }: { organizationId: string; templateId: string; client: WorkflowBuilderClient }) {
  const [snapshot, setSnapshot] = useState<WorkflowBuilderSnapshot | null>(null)
  const [definition, setDefinition] = useState<WorkflowDefinitionInput | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [simulation, setSimulation] = useState<readonly (readonly string[])[] | null>(null)
  useEffect(() => {
    let active = true
    client.load(organizationId, templateId).then((value) => {
      if (active) { setSnapshot(value); setDefinition(value.draft.definition); setStatus('ready') }
    }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId, templateId])
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل سير العمل...</p></main>
  if (status === 'error' || !snapshot || !definition) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>تعذر تحميل منشئ سير العمل</h1></main>
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5"><div><p className="text-sm font-bold text-teal-800">منشئ سير العمل</p><h1 className="text-2xl font-black">{snapshot.template.name}</h1><p className="mt-1 text-xs text-gray-500">المسودة v{snapshot.draft.version} · آخر إصدار منشور {snapshot.template.latestVersionNumber}</p></div><div className="flex gap-2">{snapshot.capabilities.simulate && <button onClick={async () => { const result = await client.simulate(organizationId, definition); setSimulation(result.paths) }} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 font-bold"><Play className="size-4" aria-hidden="true" /> محاكاة</button>}{snapshot.capabilities.manage && <button onClick={() => void client.updateDraft(organizationId, snapshot.draft.id, snapshot.draft.version, definition)} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 font-bold"><Save className="size-4" aria-hidden="true" /> حفظ</button>}{snapshot.capabilities.publish && <button disabled={!snapshot.draft.valid} onClick={() => void client.publish(organizationId, { templateId: snapshot.template.id, draftVersionId: snapshot.draft.id, expectedTemplateVersion: snapshot.template.version, expectedDraftVersion: snapshot.draft.version })} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 font-bold text-white disabled:opacity-50"><Send className="size-4" aria-hidden="true" /> نشر إصدار</button>}</div></div></header>
    <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1fr_340px]">
      <section aria-labelledby="stages-heading" className="border bg-white p-5"><div className="flex items-center justify-between"><h2 id="stages-heading" className="text-lg font-black">المراحل</h2><button onClick={() => setDefinition({ ...definition, stages: [...definition.stages, { key: `stage_${definition.stages.length + 1}`, name: 'مرحلة جديدة', type: 'work', terminal: false }] })} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold"><Plus className="size-4" aria-hidden="true" /> مرحلة</button></div><ol className="mt-5 flex flex-wrap items-stretch gap-2">{definition.stages.map((stage, index) => <li key={stage.key} className="flex items-center gap-2"><article className="min-w-40 border p-4"><p className="text-xs text-gray-500">{stage.key}</p><input aria-label={`اسم المرحلة ${index + 1}`} value={stage.name} onChange={(event) => setDefinition({ ...definition, stages: definition.stages.map((item) => item.key === stage.key ? { ...item, name: event.target.value } : item) })} className="mt-1 w-full border-b font-bold" /><p className="mt-2 text-xs">{stage.type}{stage.terminal ? ' · نهائية' : ''}</p></article>{index < definition.stages.length - 1 && <ArrowLeft className="size-5 text-gray-400" aria-hidden="true" />}</li>)}</ol></section>
      <aside className="space-y-4"><section className="border bg-white p-5"><h2 className="font-black">التحقق</h2>{snapshot.draft.valid ? <p className="mt-3 flex gap-2 text-sm text-emerald-800"><CheckCircle2 className="size-5" aria-hidden="true" /> الرسم صالح للنشر.</p> : <div className="mt-3 text-sm text-amber-800"><AlertTriangle className="mb-2 size-5" aria-hidden="true" /><ul>{snapshot.draft.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}</section>{simulation && <section aria-live="polite" className="border bg-white p-5"><h2 className="font-black">نتيجة المحاكاة</h2><p className="mt-2 text-sm">{simulation.length} مسارات نهائية قابلة للوصول.</p></section>}</aside>
    </div>
  </main>
}

export function WorkflowBuilderPage() {
  const { organizationId } = useTenant(); const { templateId = '' } = useParams()
  if (!organizationId || !templateId) return <main dir="rtl" className="grid min-h-screen place-items-center">نطاق سير العمل غير صالح.</main>
  return <WorkflowBuilderScreen organizationId={organizationId} templateId={templateId} client={workflowBuilderClient} />
}

