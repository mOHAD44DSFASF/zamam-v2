import { AlertTriangle, CheckSquare, LoaderCircle, MessageCircle, Plus, RefreshCw, UserPlus, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../tenant/tenant-context'
import { dashboardClient, type DashboardSnapshot, type DashboardTaskRow } from '../features/dashboard/client'
import { taskClient, type TaskSnapshot } from '../features/tasks/client'
import { TaskEditor, type EditorInput } from '../features/tasks/TaskManagementPage'
import { employeeDirectoryClient } from '../features/employees/client'
import { CreateMemberDialog } from '../features/employees/CreateMemberDialog'
import { buildWhatsappLink, buildWhatsappReminderMessage } from '../lib/whatsapp'
import { useAuth } from '../auth/auth-context'

const priorityBadgeLabel = { low: 'عادي', medium: 'عادي', high: 'مهم', urgent: 'عاجل' } as const
const priorityBadgeClass = {
  low: 'bg-gray-100 text-gray-700', medium: 'bg-gray-100 text-gray-700',
  high: 'bg-amber-100 text-amber-800', urgent: 'bg-red-100 text-red-800',
} as const

function PriorityBadge({ priority }: { priority: DashboardTaskRow['priority'] }) {
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${priorityBadgeClass[priority]}`}>{priorityBadgeLabel[priority]}</span>
}

function WhatsappButton({ row }: { row: DashboardTaskRow }) {
  if (row.currentStepAssigneeType === 'department') {
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-400" title="خطوة مسندة لقسم — حدد شخصًا أولًا">
      <MessageCircle className="size-3.5" aria-hidden="true" /> واتساب (اختر شخصًا)
    </span>
  }
  if (!row.currentStepAssigneeWhatsapp) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-400" title="لا يوجد رقم واتساب مسجل">
      <MessageCircle className="size-3.5" aria-hidden="true" /> واتساب (لا يوجد رقم)
    </span>
  }
  const href = buildWhatsappLink(row.currentStepAssigneeWhatsapp, buildWhatsappReminderMessage({
    taskTitle: row.title, ...(row.projectName ? { projectName: row.projectName } : {}),
    stepName: row.currentStepName, priority: row.priority, ...(row.currentStepDueAt ? { dueAt: row.currentStepDueAt } : {}),
  }))
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-green-800 hover:underline">
    <MessageCircle className="size-3.5" aria-hidden="true" /> إرسال تذكير واتساب
  </a>
}

function TaskRowCard({ row, actions }: { row: DashboardTaskRow; actions?: React.ReactNode }) {
  return <article className={`border p-3 text-sm ${row.stalled ? 'border-red-300 bg-red-50' : 'bg-white'}`}>
    <div className="flex items-start justify-between gap-2">
      <p className="font-bold">{row.title}</p>
      <div className="flex shrink-0 items-center gap-2">{row.stalled && <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">متعثرة</span>}<PriorityBadge priority={row.priority} /></div>
    </div>
    <p className="mt-1 text-xs text-gray-500">
      {row.projectName ? `${row.projectName} · ` : ''}الخطوة الحالية: {row.currentStepName}
      {row.currentStepDueAt ? ` · موعدها: ${row.currentStepDueAt.slice(0, 10)}` : ''}
    </p>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <WhatsappButton row={row} />
      {actions}
    </div>
  </article>
}

function SummaryBar({ summary }: { summary: DashboardSnapshot['summary'] }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div className="border bg-white p-4"><p className="text-xs font-bold text-gray-500">إجمالي المهام النشطة</p><p className="mt-1 text-2xl font-black">{summary.total}</p></div>
    <div className="border border-red-200 bg-red-50 p-4"><p className="text-xs font-bold text-red-700">مهام متعثرة</p><p className="mt-1 text-2xl font-black text-red-700">{summary.stalledCount}</p></div>
    <div className="border bg-white p-4"><p className="text-xs font-bold text-gray-500">عاجلة</p><p className="mt-1 text-2xl font-black">{summary.byPriority.urgent ?? 0}</p></div>
    <div className="border bg-white p-4"><p className="text-xs font-bold text-gray-500">قيد التنفيذ</p><p className="mt-1 text-2xl font-black">{summary.byStatus.in_progress ?? 0}</p></div>
  </div>
}

function WhatsappProfilePrompt({ organizationId, onSaved }: { organizationId: string; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  return <form
    className="mb-6 flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-4"
    onSubmit={async (event) => {
      event.preventDefault()
      setSubmitting(true); setError('')
      try { await employeeDirectoryClient.updateOwnWhatsappPhone(organizationId, value); onSaved() }
      catch { setError('رقم غير صالح.') }
      finally { setSubmitting(false) }
    }}
  >
    <AlertTriangle className="size-5 shrink-0 text-amber-700" aria-hidden="true" />
    <p className="flex-1 text-sm font-bold text-amber-900">حسابك بلا رقم واتساب مسجل — أضفه لتفعيل روابط التذكير.</p>
    <input required type="tel" placeholder="+9665xxxxxxxx" dir="ltr" value={value} onChange={(event) => setValue(event.target.value)} className="rounded-md border border-amber-300 px-3 py-1.5 text-sm" />
    <button type="submit" disabled={submitting} className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{submitting ? 'جارٍ الحفظ...' : 'حفظ'}</button>
    {error && <span className="text-xs font-bold text-red-700">{error}</span>}
  </form>
}

export function DashboardPage() {
  const { organizationId } = useTenant()
  const { session } = useAuth()
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [taskSnapshot, setTaskSnapshot] = useState<TaskSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showCreateMember, setShowCreateMember] = useState(false)
  const [needsWhatsapp, setNeedsWhatsapp] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    if (!organizationId) return
    setStatus('loading')
    try {
      const [dashboard, tasks] = await Promise.all([
        dashboardClient.load(organizationId), taskClient.load(organizationId, 'self'),
      ])
      setSnapshot(dashboard); setTaskSnapshot(tasks); setStatus('ready')
    } catch { setStatus('error') }
  }, [organizationId])

  useEffect(() => {
    if (!organizationId) return
    let active = true
    Promise.all([dashboardClient.load(organizationId), taskClient.load(organizationId, 'self')]).then(
      ([dashboard, tasks]) => { if (active) { setSnapshot(dashboard); setTaskSnapshot(tasks); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [organizationId])
  // Area 1 migration: any active member (old or new) whose profile predates whatsappPhone gets a one-time,
  // dismissible-by-completing prompt right here on the landing page — not a hard gate like mustChangePassword
  // (see ProtectedRoute/ForcePasswordChangeScreen), just a nudge, since Area 5's reminder button already
  // degrades gracefully (disabled + clear message) when the number is missing.
  useEffect(() => {
    if (!organizationId || !session) return
    employeeDirectoryClient.load(organizationId).then((directory) => {
      const self = directory.items.find((item) => item.userId === session.userId)
      setNeedsWhatsapp(Boolean(self) && !self!.whatsappPhone)
    }).catch(() => {})
  }, [organizationId, session])

  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  if (status === 'loading' && !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل الرئيسية...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><AlertTriangle className="mx-auto size-7 text-amber-700" aria-hidden="true" /><h1 className="mt-3 text-xl font-black">تعذر تحميل الرئيسية</h1><button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>

  const completeStep = async (row: DashboardTaskRow) => {
    setActionError('')
    try { await taskClient.completeStep(organizationId, row.taskId, row.version); await load() }
    catch { setActionError('تعذر إكمال الخطوة.') }
  }
  const sendBack = async (row: DashboardTaskRow) => {
    setActionError('')
    const reason = window.prompt('سبب إرجاع الخطوة؟')
    if (!reason) return
    try { await taskClient.sendBackStep(organizationId, { taskId: row.taskId, expectedVersion: row.version, targetStepOrder: Math.max(0, row.currentStepOrder - 1), reason }); await load() }
    catch { setActionError('تعذر إرجاع الخطوة.') }
  }
  const submitTask = async (input: EditorInput) => {
    await taskClient.create(organizationId, input)
    setShowCreateTask(false)
    // Refresh in the background — a refresh failure must never look like the create itself failed
    // (TaskEditor's caller only distinguishes success/failure by whether this promise threw).
    void load()
  }

  return <main dir="rtl" className="min-h-screen bg-gray-50">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
      <div><p className="text-sm font-bold text-teal-800">الرئيسية</p><h1 className="text-2xl font-black">لوحة التحكم</h1></div>
      <div className="flex flex-wrap items-center gap-2">
        {snapshot.capabilities.createTask && <button onClick={() => setShowCreateTask(true)} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white"><Plus className="size-4" aria-hidden="true" /> إنشاء مهمة</button>}
        {snapshot.capabilities.createMember && <button onClick={() => setShowCreateMember(true)} className="inline-flex items-center gap-2 rounded-md border border-teal-800 px-4 py-2 font-bold text-teal-900"><UserPlus className="size-4" aria-hidden="true" /> إضافة عضو</button>}
      </div>
    </div></header>
    <div className="mx-auto max-w-6xl px-5 py-6">
      {needsWhatsapp && <WhatsappProfilePrompt organizationId={organizationId} onSaved={() => setNeedsWhatsapp(false)} />}
      {actionError && <p role="alert" className="mb-4 text-sm font-bold text-red-700">{actionError}</p>}
      <SummaryBar summary={snapshot.summary} />

      {snapshot.stalled.length > 0 && <section aria-labelledby="stalled-heading" className="mt-8">
        <h2 id="stalled-heading" className="text-lg font-black text-red-800">مهام متعثرة</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{snapshot.stalled.map((row) => <TaskRowCard key={row.taskId} row={row} />)}</div>
      </section>}

      {snapshot.scope === 'employee' ? <>
        <section aria-labelledby="current-heading" className="mt-8">
          <h2 id="current-heading" className="text-lg font-black">مهامك الحالية</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(snapshot.currentTasks ?? []).map((row) => <TaskRowCard key={row.taskId} row={row} actions={<div className="flex gap-2">
              <button type="button" onClick={() => void completeStep(row)} className="inline-flex items-center gap-1 rounded-md bg-teal-800 px-2 py-1 text-xs font-bold text-white"><CheckSquare className="size-3.5" aria-hidden="true" /> إكمال الخطوة</button>
              {row.currentStepOrder > 0 && <button type="button" onClick={() => void sendBack(row)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold text-amber-800"><Undo2 className="size-3.5" aria-hidden="true" /> إرجاع خطوة</button>}
            </div>} />)}
            {(snapshot.currentTasks ?? []).length === 0 && <p className="text-sm text-gray-500">لا توجد مهام حالية.</p>}
          </div>
        </section>
        <section aria-labelledby="upcoming-heading" className="mt-8">
          <h2 id="upcoming-heading" className="text-lg font-black">قادمة إليك</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(snapshot.upcomingTasks ?? []).map((row) => <TaskRowCard key={row.taskId} row={row} />)}
            {(snapshot.upcomingTasks ?? []).length === 0 && <p className="text-sm text-gray-500">لا توجد مهام قادمة.</p>}
          </div>
        </section>
      </> : <section aria-labelledby="all-tasks-heading" className="mt-8">
        <h2 id="all-tasks-heading" className="text-lg font-black">{snapshot.scope === 'organization' ? 'كل مهام المؤسسة' : 'مهام القسم'}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.tasks.map((row) => <TaskRowCard key={row.taskId} row={row} />)}
          {snapshot.tasks.length === 0 && <p className="text-sm text-gray-500">لا توجد مهام نشطة.</p>}
        </div>
      </section>}
    </div>

    {showCreateTask && taskSnapshot && <TaskEditor
      mode="create" snapshot={taskSnapshot} task={null}
      {...(snapshot.scope === 'department' && snapshot.departmentId ? { initialDepartmentId: snapshot.departmentId } : {})}
      onClose={() => setShowCreateTask(false)} onSubmit={submitTask}
    />}
    {showCreateMember && taskSnapshot && <CreateMemberDialog
      departments={taskSnapshot.departments}
      onClose={() => setShowCreateMember(false)}
      onSubmit={async (input) => {
        const result = await employeeDirectoryClient.createDirect(organizationId, input)
        // Refresh in the background — see submitTask's comment above; the one-time password screen
        // must render regardless of whether this follow-up refresh succeeds.
        void load()
        return result
      }}
    />}
  </main>
}
