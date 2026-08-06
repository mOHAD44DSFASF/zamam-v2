import { AlertTriangle, CalendarDays, CheckSquare, CircleDot, Clock3, Columns3, GanttChart, Link as LinkIcon, LayoutList, LoaderCircle, Pencil, Plus, RefreshCw, Save, Trash2, UserRound, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import { taskClient, type TaskClient, type TaskSnapshot, type TaskStep, type TaskStepInputForm, type TaskSummary } from './client'

const statusLabel: Record<TaskSummary['status'], string> = {
  draft: 'مسودة', ready: 'جاهزة', in_progress: 'قيد التنفيذ', blocked: 'متوقفة',
  in_review: 'قيد المراجعة', approved: 'معتمدة', completed: 'مكتملة',
  cancelled: 'ملغاة', archived: 'مؤرشفة',
}
const priorityLabel = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' } as const
const stepStatusLabel: Record<TaskStep['status'], string> = {
  pending: 'قادمة', in_progress: 'جارية', done: 'منتهية', sent_back: 'أُعيدت',
}

type TaskView = 'list' | 'board' | 'calendar' | 'timeline'
export function TaskManagementScreen({ organizationId, client, view = 'list', onViewChange }: {
  organizationId: string
  client: TaskClient
  view?: TaskView
  onViewChange?: (view: TaskView) => void
}) {
  const { session } = useAuth()
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
  const [sendBackTarget, setSendBackTarget] = useState<TaskSummary | null>(null)
  const [actionError, setActionError] = useState('')
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const value = await client.load(organizationId)
      setSnapshot(value); setSelectedId((current) => current && value.tasks.some(({ id }) => id === current) ? current : value.tasks[0]?.id ?? null); setStatus('ready')
    } catch { setStatus('error') }
  }, [client, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId).then((value) => {
      if (active) { setSnapshot(value); setSelectedId(value.tasks[0]?.id ?? null); setStatus('ready') }
    }, () => { if (active) setStatus('error') })
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل المهام...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><AlertTriangle className="mx-auto size-7 text-amber-700" aria-hidden="true" /><h1 className="mt-3 text-xl font-black">تعذر تحميل المهام</h1><button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>
  const selected = snapshot.tasks.find(({ id }) => id === selectedId) ?? null
  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6"><div><p className="text-sm font-bold text-teal-800">العمل</p><h1 className="text-2xl font-black">المهام</h1></div>{snapshot.capabilities.create && <button onClick={() => setEditor('create')} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white"><Plus className="size-4" aria-hidden="true" /> مهمة</button>}</div></header>
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 pt-6">
      <div role="group" aria-label="طريقة عرض المهام" className="inline-flex border bg-white">
        {([
          ['list', 'قائمة', LayoutList], ['board', 'لوحة', Columns3],
          ['calendar', 'تقويم', CalendarDays], ['timeline', 'خط زمني', GanttChart],
        ] as const).map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => onViewChange?.(key)} className="inline-flex min-w-20 items-center justify-center gap-2 border-l px-3 py-2 text-sm font-bold last:border-l-0 aria-pressed:bg-teal-50 aria-pressed:text-teal-900"><Icon className="size-4" aria-hidden="true" /> {label}</button>)}
      </div>
      {snapshot.capabilities.saveView && <button type="button" onClick={() => void client.saveView(organizationId, { name: `عرض ${view}`, view })} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-bold"><Save className="size-4" aria-hidden="true" /> حفظ العرض</button>}
    </div>
    {actionError && <p role="alert" className="mx-auto mt-4 max-w-7xl px-5 text-sm font-bold text-red-700">{actionError}</p>}
    {view === 'list' ? <div className="mx-auto grid max-w-7xl px-5 py-5 lg:grid-cols-[350px_1fr]">
      <aside className="divide-y border bg-white">{snapshot.tasks.map((task) => <button key={task.id} onClick={() => setSelectedId(task.id)} aria-current={task.id === selectedId ? 'true' : undefined} className="block w-full px-4 py-4 text-right hover:bg-gray-50 aria-[current=true]:bg-teal-50"><span className="block font-bold">{task.title}</span><span className="mt-1 block text-xs text-gray-500">{task.projectName || 'بدون مشروع'} · {statusLabel[task.status]} · {priorityLabel[task.priority]}</span></button>)}{snapshot.tasks.length === 0 && <p className="p-8 text-center text-gray-500">لا توجد مهام ضمن نطاقك.</p>}</aside>
      <section className="border border-r-0 bg-white p-6">{!selected ? <div className="grid min-h-72 place-items-center text-gray-500">اختر مهمة.</div> : <TaskDetails
        task={selected} snapshot={snapshot} viewerUserId={session?.userId ?? null}
        canEdit={snapshot.capabilities.update} onEdit={() => setEditor('edit')}
        onCompleteStep={async () => {
          setActionError('')
          try { await client.completeStep(organizationId, selected.id, selected.version); await load() }
          catch { setActionError('تعذر إكمال الخطوة. تأكد أنك الشخص أو القسم المسند إليه الدور الحالي.') }
        }}
        onSendBack={() => setSendBackTarget(selected)}
      />}</section>
    </div> : <TaskAlternateView view={view} tasks={snapshot.tasks} />}
    {editor && <TaskEditor mode={editor} snapshot={snapshot} task={editor === 'edit' ? selected : null} onClose={() => setEditor(null)} onSubmit={async (input) => {
      setActionError('')
      try {
        if (editor === 'create') await client.create(organizationId, input as Parameters<TaskClient['create']>[1])
        else if (selected) await client.update(organizationId, {
          taskId: selected.id, expectedVersion: selected.version,
          title: input.title, description: input.description, priority: input.priority,
          dueAt: input.dueAt ?? null, clientVisible: input.clientVisible,
        })
        setEditor(null); await load()
      } catch { setActionError('تعذر حفظ المهمة. راجع الحقول المطلوبة.') }
    }} />}
    {sendBackTarget && <SendBackDialog task={sendBackTarget} onClose={() => setSendBackTarget(null)} onSubmit={async (targetStepOrder, reason) => {
      setActionError('')
      try {
        await client.sendBackStep(organizationId, { taskId: sendBackTarget.id, expectedVersion: sendBackTarget.version, targetStepOrder, reason })
        setSendBackTarget(null); await load()
      } catch { setActionError('تعذر إرجاع الخطوة. تأكد من السبب واختيار خطوة سابقة صحيحة.') }
    }} />}
  </main>
}

function TaskAlternateView({ view, tasks }: { view: Exclude<TaskView, 'list'>; tasks: readonly TaskSummary[] }) {
  if (tasks.length === 0) return <section dir="rtl" className="mx-auto max-w-7xl px-5 py-5"><div className="border bg-white p-10 text-center text-gray-500">لا توجد مهام لهذا العرض.</div></section>
  if (view === 'board') {
    const groups = ['ready', 'in_progress', 'blocked', 'in_review', 'completed'] as const
    return <section aria-label="لوحة المهام" className="mx-auto grid max-w-7xl gap-3 overflow-x-auto px-5 py-5 md:grid-cols-5">{groups.map((status) => <div key={status} className="min-w-52 border bg-white p-3"><h2 className="mb-3 text-sm font-black">{statusLabel[status]}</h2><div className="space-y-2">{tasks.filter((task) => task.status === status).map((task) => <article key={task.id} className="border p-3 text-sm"><p className="font-bold">{task.title}</p><p className="mt-1 text-xs text-gray-500">{task.projectName || 'بدون مشروع'}</p></article>)}</div></div>)}</section>
  }
  const sorted = [...tasks].filter(({ dueAt }) => dueAt).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
  if (view === 'calendar') return <section aria-label="تقويم المهام" className="mx-auto max-w-7xl px-5 py-5"><div className="divide-y border bg-white">{sorted.map((task) => <article key={task.id} className="grid gap-2 p-4 sm:grid-cols-[180px_1fr]"><time dir="ltr">{task.dueAt?.slice(0, 10)}</time><div><h2 className="font-bold">{task.title}</h2><p className="text-xs text-gray-500">{task.projectName || 'بدون مشروع'}</p></div></article>)}</div></section>
  return <section aria-label="الخط الزمني للمهام" className="mx-auto max-w-7xl px-5 py-5"><ol className="border bg-white p-5">{sorted.map((task, index) => <li key={task.id} className="relative border-r-2 border-teal-700 py-4 pr-6"><span className="absolute -right-2 top-5 size-3 rounded-full bg-teal-700" aria-hidden="true" /><p className="text-xs text-gray-500">{index + 1} · {task.dueAt?.slice(0, 10)}</p><h2 className="font-bold">{task.title}</h2></li>)}</ol></section>
}

function StepPipeline({ task, snapshot, viewerUserId, onCompleteStep, onSendBack }: {
  task: TaskSummary
  snapshot: TaskSnapshot
  viewerUserId: string | null
  onCompleteStep: () => Promise<void>
  onSendBack: () => void
}) {
  const memberName = (userId?: string) => userId ? snapshot.members.find((m) => m.userId === userId)?.displayName ?? userId : ''
  const departmentName = (departmentId?: string) => departmentId ? snapshot.departments.find((d) => d.id === departmentId)?.name ?? departmentId : ''
  const current = task.steps.find((step) => step.order === task.currentStepOrder)
  const isTerminal = task.status === 'completed' || task.status === 'cancelled' || task.status === 'archived'
  const viewerMightBeCurrentHolder = Boolean(current && viewerUserId && (
    (current.assigneeType === 'person' && current.assigneeUserId === viewerUserId)
    || current.assigneeType === 'department'
  ))
  return <section aria-labelledby="task-pipeline-heading" className="mt-6 border-t pt-5">
    <h3 id="task-pipeline-heading" className="font-black">مسار الخطوات ({task.currentStepOrder + (isTerminal ? 1 : 1)}/{task.stepCount})</h3>
    <ol className="mt-4 space-y-3">
      {task.steps.map((step) => {
        const isCurrent = step.order === task.currentStepOrder && !isTerminal
        const isDone = step.status === 'done'
        return <li key={step.id} className={`flex items-center gap-3 rounded-md border p-3 ${isCurrent ? 'border-teal-700 bg-teal-50' : 'border-gray-200'}`}>
          <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-black ${isDone ? 'bg-teal-800 text-white' : isCurrent ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-500'}`}>{step.order + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{step.name}</p>
            <p className="text-xs text-gray-500">
              {step.assigneeType === 'person' ? memberName(step.assigneeUserId) : `فريق: ${departmentName(step.assigneeDepartmentId)}`}
              {' · '}{stepStatusLabel[step.status]}
              {step.driveLink && <> · <a href={step.driveLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-800 underline"><LinkIcon className="size-3" aria-hidden="true" /> رابط Drive</a></>}
            </p>
          </div>
        </li>
      })}
    </ol>
    {current && !isTerminal && viewerMightBeCurrentHolder && <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={() => void onCompleteStep()} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 text-sm font-bold text-white"><CheckSquare className="size-4" aria-hidden="true" /> إنهاء الخطوة الحالية</button>
      {task.currentStepOrder > 0 && <button type="button" onClick={onSendBack} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold text-amber-800"><Undo2 className="size-4" aria-hidden="true" /> إرجاع إلى خطوة سابقة</button>}
    </div>}
  </section>
}

function TaskDetails({ task, snapshot, viewerUserId, canEdit, onEdit, onCompleteStep, onSendBack }: {
  task: TaskSummary
  snapshot: TaskSnapshot
  viewerUserId: string | null
  canEdit: boolean
  onEdit: () => void
  onCompleteStep: () => Promise<void>
  onSendBack: () => void
}) {
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5"><div><div className="flex items-center gap-2"><h2 className="text-xl font-black">{task.title}</h2><span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold">{statusLabel[task.status]}</span></div><p className="mt-1 text-sm text-gray-500">{task.projectName || 'بدون مشروع'}{task.workspaceName ? ` · ${task.workspaceName}` : ''}</p></div>{canEdit && !['completed', 'cancelled', 'archived'].includes(task.status) && <button onClick={onEdit} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold"><Pencil className="size-4" aria-hidden="true" /> تعديل</button>}</div>
    <nav aria-label="أقسام المهمة" className="flex gap-5 overflow-x-auto border-b py-4 text-sm font-bold"><span className="text-teal-800">نظرة عامة</span><span>المهام الفرعية</span><span>قائمة التحقق</span><a href={`/tasks/${task.id}/collaboration`} className="text-teal-800">التعليقات والنشاط</a></nav>
    <p className="min-h-28 whitespace-pre-wrap py-6 text-gray-700">{task.description || 'لا يوجد وصف.'}</p>
    <div className="grid gap-4 border-t pt-5 sm:grid-cols-3"><div className="flex gap-2"><Clock3 className="size-4" aria-hidden="true" /><span>{task.dueAt ?? 'دون موعد'}</span></div><div className="flex gap-2"><UserRound className="size-4" aria-hidden="true" /><span>{task.assigneeNames.join('، ') || 'غير مسندة'}</span></div><div className="flex gap-2"><CircleDot className="size-4" aria-hidden="true" /><span>{priorityLabel[task.priority]}</span></div></div>
    {task.driveLink && <p className="mt-3"><a href={task.driveLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-teal-800 underline"><LinkIcon className="size-4" aria-hidden="true" /> رابط Drive للمهمة</a></p>}
    <div className="mt-5 flex gap-5 text-sm"><span className="flex gap-2"><CheckSquare className="size-4" aria-hidden="true" /> {task.completedChecklistCount}/{task.checklistCount} قائمة تحقق</span><span>{task.completedSubtaskCount}/{task.subtaskCount} مهام فرعية</span></div>
    <StepPipeline task={task} snapshot={snapshot} viewerUserId={viewerUserId} onCompleteStep={onCompleteStep} onSendBack={onSendBack} />
  </>
}

function SendBackDialog({ task, onClose, onSubmit }: {
  task: TaskSummary
  onClose: () => void
  onSubmit: (targetStepOrder: number, reason: string) => Promise<void>
}) {
  const titleId = useId()
  const priorSteps = task.steps.filter((step) => step.order < task.currentStepOrder)
  const [targetStepOrder, setTargetStepOrder] = useState(priorSteps[priorSteps.length - 1]?.order ?? 0)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <form className="w-full max-w-md rounded-lg bg-white p-6" onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); try { await onSubmit(targetStepOrder, reason) } finally { setSubmitting(false) } }}>
      <h2 id={titleId} className="text-xl font-black">إرجاع إلى خطوة سابقة</h2>
      <label className="mt-4 block text-sm font-bold">الخطوة المستهدفة<select required value={targetStepOrder} onChange={(event) => setTargetStepOrder(Number(event.target.value))} className="mt-2 w-full rounded-md border p-2">{priorSteps.map((step) => <option key={step.id} value={step.order}>{step.order + 1}. {step.name}</option>)}</select></label>
      <label className="mt-4 block text-sm font-bold">السبب<textarea required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border p-2" /></label>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-4 py-2">إلغاء</button><button type="submit" disabled={submitting} className="rounded-md bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50">{submitting ? 'جارٍ الإرسال...' : 'إرجاع'}</button></div>
    </form>
  </div>
}

function StepBuilder({ steps, snapshot, onChange }: {
  steps: readonly TaskStepInputForm[]
  snapshot: TaskSnapshot
  onChange: (steps: readonly TaskStepInputForm[]) => void
}) {
  const update = (index: number, patch: Partial<TaskStepInputForm>) =>
    onChange(steps.map((step, i) => i === index ? { ...step, ...patch } : step))
  return <div className="mt-4">
    <div className="flex items-center justify-between"><p className="text-sm font-bold">خطوات المهمة *</p><button type="button" onClick={() => onChange([...steps, { name: '', assigneeType: 'person', assigneeUserId: snapshot.members[0]?.userId ?? '' }])} className="inline-flex items-center gap-1 text-sm font-bold text-teal-800"><Plus className="size-4" aria-hidden="true" /> إضافة خطوة</button></div>
    <ol className="mt-2 space-y-3">
      {steps.map((step, index) => <li key={index} className="rounded-md border p-3">
        <div className="flex items-center justify-between"><span className="text-xs font-black text-gray-500">الخطوة {index + 1}</span>{steps.length > 1 && <button type="button" onClick={() => onChange(steps.filter((_, i) => i !== index))} aria-label={`حذف الخطوة ${index + 1}`} className="text-red-700"><Trash2 className="size-4" aria-hidden="true" /></button>}</div>
        <label className="mt-2 block text-sm font-semibold">اسم الخطوة<input required minLength={2} value={step.name} onChange={(event) => update(index, { name: event.target.value })} className="mt-1 w-full rounded-md border p-2" /></label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-semibold">نوع المُسند إليه<select value={step.assigneeType} onChange={(event) => update(index, { assigneeType: event.target.value as 'person' | 'department', assigneeUserId: undefined, assigneeDepartmentId: undefined })} className="mt-1 w-full rounded-md border p-2"><option value="person">شخص</option><option value="department">قسم (أي عضو نشط فيه)</option></select></label>
          {step.assigneeType === 'person'
            ? <label className="text-sm font-semibold">الشخص<select required value={step.assigneeUserId ?? ''} onChange={(event) => update(index, { assigneeUserId: event.target.value })} className="mt-1 w-full rounded-md border p-2"><option value="" disabled>اختر شخصًا</option>{snapshot.members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></label>
            : <label className="text-sm font-semibold">القسم<select required value={step.assigneeDepartmentId ?? ''} onChange={(event) => update(index, { assigneeDepartmentId: event.target.value })} className="mt-1 w-full rounded-md border p-2"><option value="" disabled>اختر قسمًا</option>{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
        </div>
        <label className="mt-2 block text-sm font-semibold">رابط Drive (اختياري)<input type="url" dir="ltr" value={step.driveLink ?? ''} onChange={(event) => update(index, { driveLink: event.target.value })} className="mt-1 w-full rounded-md border p-2 text-left" /></label>
      </li>)}
    </ol>
  </div>
}

type EditorInput = {
  projectId?: string; workspaceId?: string; departmentId?: string; title: string; description: string
  priority: TaskSummary['priority']; dueAt?: string; driveLink?: string; clientVisible: boolean
  steps: readonly TaskStepInputForm[]
}
function TaskEditor({ mode, snapshot, task, onClose, onSubmit }: {
  mode: 'create' | 'edit'; snapshot: TaskSnapshot; task: TaskSummary | null; onClose: () => void; onSubmit: (input: EditorInput) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  const [workspaceId, setWorkspaceId] = useState('')
  const [departmentId, setDepartmentId] = useState(task?.departmentId ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskSummary['priority']>(task?.priority ?? 'medium')
  const [dueAt, setDueAt] = useState(task?.dueAt?.slice(0, 16) ?? '')
  const [driveLink, setDriveLink] = useState(task?.driveLink ?? '')
  const [steps, setSteps] = useState<readonly TaskStepInputForm[]>([{ name: '', assigneeType: 'person', assigneeUserId: snapshot.members[0]?.userId ?? '' }])
  const [submitting, setSubmitting] = useState(false)
  const availableWorkspaces = useMemo(() => snapshot.workspaces.filter((item) => !item.projectId || item.projectId === projectId), [snapshot.workspaces, projectId])
  return <div role="presentation" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"><form role="dialog" aria-modal="true" aria-labelledby="task-editor-title" className="my-6 max-h-[90vh] w-full max-w-xl overflow-y-auto border bg-white p-6" onSubmit={async (event) => {
    event.preventDefault(); setSubmitting(true)
    try {
      await onSubmit({
        ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}), ...(departmentId ? { departmentId } : {}),
        title, description, priority, ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(driveLink ? { driveLink } : {}), clientVisible: task?.clientVisible ?? false, steps,
      })
    } finally { setSubmitting(false) }
  }}>
    <h2 id="task-editor-title" className="text-xl font-black">{mode === 'create' ? 'مهمة جديدة' : 'تعديل المهمة'}</h2>
    <label className="mt-5 block text-sm font-bold">العنوان<input required minLength={2} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-md border p-2" /></label>
    {mode === 'create' && <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">المشروع (اختياري)<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setWorkspaceId('') }} className="mt-2 w-full rounded-md border p-2"><option value="">بدون مشروع</option>{snapshot.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="text-sm font-bold">القسم (اختياري)<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-2 w-full rounded-md border p-2"><option value="">بدون قسم محدد</option>{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      </div>
      {projectId && <label className="mt-4 block text-sm font-bold">مساحة العمل<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 w-full rounded-md border p-2"><option value="">دون مساحة</option>{availableWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    </>}
    <label className="mt-4 block text-sm font-bold">الوصف<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-28 w-full rounded-md border p-2" /></label>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">الأولوية<select value={priority} onChange={(event) => setPriority(event.target.value as TaskSummary['priority'])} className="mt-2 w-full rounded-md border p-2">{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-bold">موعد التسليم<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-2 w-full rounded-md border p-2" /></label></div>
    {mode === 'create' && <label className="mt-4 block text-sm font-bold">رابط Drive للمهمة (اختياري)<input type="url" dir="ltr" value={driveLink} onChange={(event) => setDriveLink(event.target.value)} className="mt-2 w-full rounded-md border p-2 text-left" /></label>}
    {mode === 'create' && <StepBuilder steps={steps} snapshot={snapshot} onChange={setSteps} />}
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border px-4 py-2">إلغاء</button><button type="submit" disabled={submitting} className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50">{submitting ? 'جارٍ الحفظ...' : 'حفظ'}</button></div>
  </form></div>
}

export function TaskManagementPage() {
  const { organizationId } = useTenant()
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view')
  const view: TaskView = rawView === 'board' || rawView === 'calendar' || rawView === 'timeline' ? rawView : 'list'
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <TaskManagementScreen organizationId={organizationId} client={taskClient} view={view} onViewChange={(next) => {
    const updated = new URLSearchParams(params)
    updated.set('view', next)
    setParams(updated, { replace: true })
  }} />
}
