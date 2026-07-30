import { FolderKanban, LoaderCircle, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { workspaceClient, type WorkspaceClient, type WorkspaceSnapshot } from './client'

const visibilityLabel = { private: 'خاصة', team: 'للفريق', project: 'للمشروع' } as const

export function WorkspaceManagementScreen({ organizationId, client }: { organizationId: string; client: WorkspaceClient }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [createOpen, setCreateOpen] = useState(false)
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

  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ التحميل...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><h1 className="text-xl font-black">تعذر تحميل مساحات العمل</h1><button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6"><div><p className="text-sm font-bold text-teal-800">نطاقات التنفيذ</p><h1 className="text-2xl font-black">مساحات العمل</h1></div>{snapshot.capabilities.create && <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white"><Plus className="size-4" aria-hidden="true" /> مساحة</button>}</div></header>
    <section className="mx-auto max-w-6xl px-5 py-7">
      <p className="mb-5 flex items-center gap-2 text-sm text-gray-600"><ShieldCheck className="size-4 text-teal-800" aria-hidden="true" /> العضوية صريحة ومدققة؛ الظهور في القائمة لا يمنح صلاحية.</p>
      <div className="grid gap-3 md:grid-cols-2">{snapshot.workspaces.map((workspace) => <article key={workspace.id} className="border bg-white p-5">
        <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><FolderKanban className="size-5 text-teal-800" aria-hidden="true" /><div><h2 className="font-black">{workspace.name}</h2><p className="mt-1 text-xs text-gray-500">{visibilityLabel[workspace.visibility]}{workspace.projectName ? ` · ${workspace.projectName}` : ''}{workspace.teamName ? ` · ${workspace.teamName}` : ''}</p></div></div><span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold">{workspace.status === 'active' ? 'نشطة' : 'مؤرشفة'}</span></div>
        <div className="mt-5 flex gap-6 border-t pt-4 text-sm"><span className="flex items-center gap-1"><Users className="size-4" aria-hidden="true" /> {workspace.activeMemberCount} أعضاء</span><span>{workspace.openTaskCount} مهام مفتوحة</span></div>
      </article>)}</div>
      {snapshot.workspaces.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">لا توجد مساحات عمل ضمن نطاقك.</div>}
    </section>
    {createOpen && <CreateWorkspace snapshot={snapshot} onClose={() => setCreateOpen(false)} onSubmit={async (input) => { await client.create(organizationId, input); setCreateOpen(false); await load() }} />}
  </main>
}

function CreateWorkspace({ snapshot, onClose, onSubmit }: {
  snapshot: WorkspaceSnapshot
  onClose: () => void
  onSubmit: (input: { name: string; visibility: 'private' | 'team' | 'project'; projectId?: string; departmentId?: string; ownerTeamId?: string }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'team' | 'project'>('private')
  const [projectId, setProjectId] = useState('')
  const [teamId, setTeamId] = useState('')
  const team = useMemo(() => snapshot.teams.find(({ id }) => id === teamId), [snapshot.teams, teamId])
  const project = useMemo(() => snapshot.projects.find(({ id }) => id === projectId), [snapshot.projects, projectId])
  return <div role="presentation" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form role="dialog" aria-modal="true" aria-labelledby="workspace-title" className="w-full max-w-lg border bg-white p-6" onSubmit={(event) => {
      event.preventDefault()
      void onSubmit({
        name, visibility,
        ...(projectId ? { projectId, departmentId: project?.departmentId } : {}),
        ...(teamId ? { ownerTeamId: teamId, departmentId: team?.departmentId } : {}),
      })
    }}>
      <h2 id="workspace-title" className="text-xl font-black">مساحة عمل جديدة</h2>
      <label className="mt-5 block text-sm font-bold">الاسم<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-md border p-2" /></label>
      <label className="mt-4 block text-sm font-bold">نطاق الرؤية<select value={visibility} onChange={(event) => { setVisibility(event.target.value as typeof visibility); setProjectId(''); setTeamId('') }} className="mt-2 w-full rounded-md border p-2"><option value="private">خاصة</option><option value="team">فريق</option><option value="project">مشروع</option></select></label>
      {visibility === 'project' && <label className="mt-4 block text-sm font-bold">المشروع<select required value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 w-full rounded-md border p-2"><option value="">اختر</option>{snapshot.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {visibility === 'team' && <label className="mt-4 block text-sm font-bold">الفريق<select required value={teamId} onChange={(event) => setTeamId(event.target.value)} className="mt-2 w-full rounded-md border p-2"><option value="">اختر</option>{snapshot.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-4 py-2">إلغاء</button><button type="submit" className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white">إنشاء</button></div>
    </form>
  </div>
}

export function WorkspaceManagementPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <WorkspaceManagementScreen organizationId={organizationId} client={workspaceClient} />
}
