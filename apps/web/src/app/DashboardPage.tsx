import { AlertTriangle, Plus, RefreshCw, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../tenant/tenant-context'
import { dashboardClient, type DashboardSnapshot, type DashboardTaskRow } from '../features/dashboard/client'
import { SummaryBar, WhatsappProfilePrompt } from '../features/dashboard/shared'
import { OrganizationDashboardView } from '../features/dashboard/OrganizationDashboard'
import { DepartmentDashboardView } from '../features/dashboard/DepartmentDashboard'
import { EmployeeDashboardView } from '../features/dashboard/EmployeeDashboard'
import { taskClient, type TaskSnapshot } from '../features/tasks/client'
import { TaskEditor, type EditorInput } from '../features/tasks/TaskEditor'
import { TaskRowCard } from '../features/dashboard/shared'
import { employeeDirectoryClient } from '../features/employees/client'
import { CreateMemberDialog } from '../features/employees/CreateMemberDialog'
import { useAuth } from '../auth/auth-context'

/**
 * Thin data-loading + routing shell — the actual per-scope layout lives in
 * features/dashboard/{Organization,Department,Employee}Dashboard.tsx (Phase 4, one subagent per file).
 * Keep this file's job limited to: load data, own the completeStep/sendBack/create commands, render the
 * shared summary/stalled/quick-action chrome, and dispatch to the right scope view.
 */
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

  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  if (status === 'loading' && !snapshot) return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">جارٍ تحميل الرئيسية...</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
        <div><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-40 rounded-md bg-surface-hover" /></div>
        <div className="flex gap-2"><div className="h-10 w-28 rounded-md bg-surface-hover" /><div className="h-10 w-24 rounded-md bg-surface-hover" /></div>
      </div></header>
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="rounded-md border border-border-subtle bg-surface p-4"><div className="h-4 w-20 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-12 rounded-md bg-surface-hover" /></div>)}</div>
        <div className="mt-8 h-6 w-32 rounded-sm bg-surface-hover" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-24 rounded-md border border-border-subtle bg-surface" />)}</div>
      </div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><AlertTriangle className="mx-auto size-7 text-warning" aria-hidden="true" /><h1 className="mt-3 text-h1 font-extrabold text-text-primary">تعذر تحميل الرئيسية</h1><button onClick={() => void load()} className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 text-text-primary hover:bg-surface-hover"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>

  const completeStep = async (row: DashboardTaskRow) => {
    setActionError('')
    try { await taskClient.completeStep(organizationId, row.taskId, row.version); await load() }
    catch { setActionError('تعذر إكمال الخطوة.') }
  }
  const submitTask = async (input: EditorInput) => {
    await taskClient.create(organizationId, input)
    setShowCreateTask(false)
    // Refresh in the background — a refresh failure must never look like the create itself failed
    // (TaskEditor's caller only distinguishes success/failure by whether this promise threw).
    void load()
  }

  return <main dir="rtl" className="min-h-screen bg-canvas">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
      <div><p className="text-label font-semibold text-brand-300">الرئيسية</p><h1 className="text-display font-extrabold text-text-primary">لوحة التحكم</h1></div>
      <div className="flex flex-wrap items-center gap-2">
        {snapshot.capabilities.createTask && <button onClick={() => setShowCreateTask(true)} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary hover:bg-brand-400 active:scale-[0.98] transition-all"><Plus className="size-4" aria-hidden="true" /> إنشاء مهمة</button>}
        {snapshot.capabilities.createMember && <button onClick={() => setShowCreateMember(true)} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-brand-400 px-4 py-2 text-body font-bold text-brand-300 hover:bg-brand-subtle active:scale-[0.98] transition-all"><UserPlus className="size-4" aria-hidden="true" /> إضافة عضو</button>}
      </div>
    </div></header>
    <div className="mx-auto max-w-6xl px-5 py-6">
      {needsWhatsapp && <WhatsappProfilePrompt organizationId={organizationId} onSaved={() => setNeedsWhatsapp(false)} />}
      {actionError && <p role="alert" className="mb-4 text-body font-semibold text-danger">{actionError}</p>}
      <SummaryBar summary={snapshot.summary} />

      {snapshot.stalled.length > 0 && <section aria-labelledby="stalled-heading" className="mt-8">
        <h2 id="stalled-heading" className="text-h1 font-extrabold text-danger">مهام متعثرة</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{snapshot.stalled.map((row) => <TaskRowCard key={row.taskId} row={row} />)}</div>
      </section>}

      {snapshot.scope === 'employee'
        ? <EmployeeDashboardView snapshot={snapshot} onCompleteStep={(row) => void completeStep(row)} />
        : snapshot.scope === 'organization'
          ? <OrganizationDashboardView snapshot={snapshot} />
          : <DepartmentDashboardView snapshot={snapshot} />}
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
