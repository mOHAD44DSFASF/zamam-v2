import { AlertTriangle, CalendarDays, ClipboardList, Columns3, FilterX, FolderKanban, GanttChart, Inbox, LayoutList, LoaderCircle, Plus, RefreshCw, Save, Search, SearchX } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import type { TaskClient, TaskScope, TaskSnapshot, TaskSummary } from './client'
import { TaskDetails, WhatsappReminderButton } from './TaskDetailPipeline'
import { TaskEditor } from './TaskEditor'
import { PriorityBadge } from './shared'
import { priorityOptions, statusLabel } from './constants'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

/**
 * Tasks list/board/calendar/timeline views, search/filter, and the master-detail layout that hosts
 * TaskDetails (TaskDetailPipeline.tsx, Subagent F) and TaskEditor (TaskEditor.tsx, Subagent E). Owned by
 * Phase 4's Subagent D. TaskManagementPage.tsx (the route entry) re-exports TaskManagementScreen from here
 * unchanged so existing imports (tests/task-ui.test.tsx) keep working.
 */

export type TaskView = 'list' | 'board' | 'calendar' | 'timeline'

// Shared button-group treatment for the scope and view-mode toggles: default/hover/active/pressed states
// all live here so the two `role="group"` clusters below stay visually identical.
const toggleButtonClass = 'inline-flex cursor-pointer items-center justify-center gap-2 border-l border-border-subtle px-3 py-2 text-body font-bold text-text-secondary transition-colors last:border-l-0 hover:bg-surface-hover hover:text-text-primary active:bg-brand-subtle/70 aria-pressed:bg-brand-subtle aria-pressed:text-brand-300 aria-pressed:hover:bg-brand-subtle aria-pressed:hover:text-brand-300'
const filterSelectClass = 'cursor-pointer rounded-md border border-border-strong bg-surface px-2 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary hover:bg-surface-hover'

function TaskAlternateView({ view, tasks, onSelectTask, canCreate, onCreateTask }: {
  view: Exclude<TaskView, 'list'>
  tasks: readonly TaskSummary[]
  onSelectTask: (taskId: string) => void
  canCreate: boolean
  onCreateTask: () => void
}) {
  if (tasks.length === 0) return <section dir="rtl" className="mx-auto max-w-7xl px-5 py-5">
    <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-surface-hover"><Inbox className="size-7 text-text-tertiary" aria-hidden="true" /></div>
      <div><p className="text-h3 font-bold text-text-primary">لا توجد مهام لهذا العرض</p><p className="mt-1 text-body text-text-secondary">لا توجد أي مهام ضمن نطاقك الحالي بعد.</p></div>
      {canCreate && <button type="button" onClick={onCreateTask} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] active:bg-brand-600"><Plus className="size-4" aria-hidden="true" /> إنشاء مهمة</button>}
    </div>
  </section>
  if (view === 'board') {
    const groups = ['ready', 'in_progress', 'blocked', 'in_review', 'completed'] as const
    return <section aria-label="لوحة المهام" className="mx-auto grid max-w-7xl gap-3 overflow-x-auto px-5 py-5 md:grid-cols-5">
      {groups.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status)
        return <div key={status} className="min-w-52 rounded-md border border-border-subtle bg-surface p-3">
          <h2 className="mb-3 flex items-center justify-between gap-2 text-label font-extrabold text-text-secondary">
            <span>{statusLabel[status]}</span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-caption text-text-tertiary">{columnTasks.length}</span>
          </h2>
          <div className="space-y-2">
            {columnTasks.map((task) => <button key={task.id} type="button" onClick={() => onSelectTask(task.id)} className="block w-full cursor-pointer rounded-md border border-border-subtle bg-surface-raised p-3 text-right text-body transition-colors hover:border-border-strong hover:bg-surface-hover active:scale-[0.98]">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-bold text-text-primary" title={task.title}>{task.title}</p>
                <PriorityBadge priority={task.priority} />
              </div>
              <p className="mt-1 truncate text-caption text-text-secondary">{task.projectName || 'بدون مشروع'}</p>
            </button>)}
            {columnTasks.length === 0 && <p className="rounded-md border border-dashed border-border-subtle px-3 py-4 text-center text-caption text-text-tertiary">لا مهام</p>}
          </div>
        </div>
      })}
    </section>
  }
  const sorted = [...tasks].filter(({ dueAt }) => dueAt).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
  if (view === 'calendar') return <section aria-label="تقويم المهام" className="mx-auto max-w-7xl px-5 py-5">
    {sorted.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface px-6 py-14 text-center"><CalendarDays className="size-7 text-text-tertiary" aria-hidden="true" /><p className="font-bold text-text-secondary">لا توجد مهام بموعد تسليم محدد.</p></div>
      : <div className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">{sorted.map((task) => <button key={task.id} type="button" onClick={() => onSelectTask(task.id)} className="grid w-full cursor-pointer items-center gap-2 p-4 text-right transition-colors hover:bg-surface-hover active:bg-surface-hover/80 sm:grid-cols-[140px_1fr_auto]">
        <time dir="ltr" className="text-body font-semibold text-text-secondary">{task.dueAt?.slice(0, 10)}</time>
        <div className="min-w-0"><h2 className="truncate font-bold text-text-primary" title={task.title}>{task.title}</h2><p className="truncate text-caption text-text-secondary">{task.projectName || 'بدون مشروع'} · {statusLabel[task.status]}</p></div>
        <PriorityBadge priority={task.priority} />
      </button>)}</div>}
  </section>
  return <section aria-label="الخط الزمني للمهام" className="mx-auto max-w-7xl px-5 py-5">
    {sorted.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface px-6 py-14 text-center"><GanttChart className="size-7 text-text-tertiary" aria-hidden="true" /><p className="font-bold text-text-secondary">لا توجد مهام بموعد تسليم محدد لعرضها على الخط الزمني.</p></div>
      : <ol className="rounded-md border border-border-subtle bg-surface p-5">{sorted.map((task, index) => <li key={task.id} className="relative border-r-2 border-brand-500/50">
        <button type="button" onClick={() => onSelectTask(task.id)} className="block w-full cursor-pointer rounded-md py-3 pr-6 text-right transition-colors hover:bg-surface-hover active:bg-surface-hover/80">
          <span className="absolute -right-[7px] top-4 size-3 rounded-full border-2 border-canvas bg-brand-500" aria-hidden="true" />
          <p className="text-caption font-semibold text-text-secondary">{index + 1} · <time dir="ltr">{task.dueAt?.slice(0, 10)}</time></p>
          <span className="mt-0.5 flex items-center gap-2"><span className="min-w-0 truncate font-bold text-text-primary" title={task.title}>{task.title}</span><PriorityBadge priority={task.priority} /></span>
        </button>
      </li>)}</ol>}
  </section>
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
  useEscapeToClose(onClose)
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <form className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in" onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); try { await onSubmit(targetStepOrder, reason) } finally { setSubmitting(false) } }}>
      <h2 id={titleId} className="text-h1 font-extrabold text-text-primary">إرجاع إلى خطوة سابقة</h2>
      <p className="mt-1 text-body text-text-secondary">اختر الخطوة التي تريد إرجاع المهمة إليها، مع توضيح السبب.</p>
      <label className="mt-4 block text-body font-bold text-text-primary">الخطوة المستهدفة<select required value={targetStepOrder} onChange={(event) => setTargetStepOrder(Number(event.target.value))} className="mt-2 w-full cursor-pointer rounded-md border border-border-strong bg-canvas p-2 text-text-primary transition-colors hover:border-text-tertiary">{priorSteps.map((step) => <option key={step.id} value={step.order}>{step.order + 1}. {step.name}</option>)}</select></label>
      <label className="mt-4 block text-body font-bold text-text-primary">السبب<textarea required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border border-border-strong bg-canvas p-2 text-text-primary transition-colors hover:border-text-tertiary" /></label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover active:scale-[0.98]">إلغاء</button>
        <button type="submit" disabled={submitting} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-warning px-4 py-2 font-bold text-canvas transition-all hover:bg-warning/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{submitting ? 'جارٍ الإرسال...' : 'إرجاع'}</button>
      </div>
    </form>
  </div>
}

export function TaskManagementScreen({ organizationId, client, view = 'list', onViewChange, initialTaskId, openSendBackFor }: {
  organizationId: string
  client: TaskClient
  view?: TaskView
  onViewChange?: (view: TaskView) => void
  // Deep-link support so another screen (dashboard task cards, the post-transition WhatsApp prompt) can
  // land the viewer straight on a specific task's pipeline instead of the generic first-in-list default —
  // see TaskManagementPage.tsx, which reads these from the URL's ?task=/&sendback= params.
  initialTaskId?: string
  openSendBackFor?: string
}) {
  const { session } = useAuth()
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
  const [manualSendBackTarget, setManualSendBackTarget] = useState<TaskSummary | null>(null)
  // Dismissing the deep-linked send-back dialog (?sendback=1) must not reopen it on the next render — this
  // records which openSendBackFor value was dismissed so the derived target below stays closed for it,
  // without needing an effect to sync url-derived state (see load()'s isInitial comment for the same reasoning).
  const [dismissedSendBackFor, setDismissedSendBackFor] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  // Area 5b: right after the current viewer advances a task's step, offer a one-shot "شارك التذكير" prompt
  // for whoever the step just landed on — cleared on the next completeStep/task switch, never persisted.
  const [justTransitionedTaskId, setJustTransitionedTaskId] = useState<string | null>(null)
  // undefined = the backend's own smart default (self-scope unless the caller has task.view_all); once the
  // user picks a scope explicitly it's pinned, so this is a real filter within the page, not a route.
  const [scope, setScope] = useState<TaskScope | undefined>(undefined)
  // Area 4: simple client-side search/filter over the already-loaded scope — the list is bounded (max 50
  // per load()) so there is no need for a second server round-trip just to narrow what's already in memory.
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskSummary['status'] | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<TaskSummary['priority'] | ''>('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  // Deep-linked task/send-back requests are honored once — after the first successful load, further
  // scope/data refreshes must not keep re-selecting or re-opening the dialog every time.
  const consumedDeepLinkRef = useRef<string | null>(null)
  // Single fetch path for both the initial mount and every manual retry, so they can never drift (they
  // previously had two separately-written copies of the same "load tasks" logic, one of which was missing
  // the organization-scope permission fallback the other had).
  const load = useCallback(async (isInitial = false) => {
    // Skip re-setting 'loading' on the very first call — the state already starts as 'loading', and
    // setting it again synchronously from the mount effect is what react-hooks/set-state-in-effect flags.
    if (!isInitial) setStatus('loading')
    try {
      const value = await client.load(organizationId, scope)
      setSnapshot(value)
      setSelectedId((current) => {
        if (isInitial && initialTaskId && consumedDeepLinkRef.current !== initialTaskId && value.tasks.some(({ id }) => id === initialTaskId)) {
          consumedDeepLinkRef.current = initialTaskId
          return initialTaskId
        }
        return current && value.tasks.some(({ id }) => id === current) ? current : value.tasks[0]?.id ?? null
      })
      setStatus('ready'); setActionError('')
    } catch {
      if (scope === 'organization') { setActionError('ليست لديك صلاحية عرض كل المهام. تم عرض مهامك فقط.'); setScope('self') }
      else setStatus('error')
    }
  }, [client, organizationId, scope, initialTaskId])
  useEffect(() => { void Promise.resolve().then(() => load(true)) }, [load])
  // Once the deep-linked task's full data (with steps) is in hand, the send-back dialog opens for it —
  // this is what lets the Employee dashboard's "إرجاع خطوة" action reuse this exact dialog (with its real
  // target-step picker) instead of a second, lesser implementation. Derived at render time rather than
  // synced via effect, since manualSendBackTarget already covers the button-triggered case below.
  const deepLinkSendBackTarget = openSendBackFor && openSendBackFor !== dismissedSendBackFor
    ? snapshot?.tasks.find((task) => task.id === openSendBackFor) ?? null
    : null
  const sendBackTarget = manualSendBackTarget ?? deepLinkSendBackTarget
  const closeSendBack = () => {
    setManualSendBackTarget(null)
    if (openSendBackFor) setDismissedSendBackFor(openSendBackFor)
  }
  // Lets a board/calendar/timeline card jump straight to the task's pipeline detail — reuses the same
  // selection state the list view already drives, just also flips the view mode back to 'list'.
  const goToTaskDetail = (taskId: string) => { setSelectedId(taskId); onViewChange?.('list') }
  const clearFilters = () => { setSearchQuery(''); setStatusFilter(''); setPriorityFilter(''); setAssigneeFilter(''); setDepartmentFilter('') }

  if (status === 'loading') return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">جارٍ تحميل المهام...</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-6"><div className="h-8 w-28 rounded-md bg-surface-hover" /><div className="flex gap-2"><div className="h-10 w-28 rounded-md bg-surface-hover" /><div className="h-10 w-24 rounded-md bg-surface-hover" /></div></div></header>
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-5 pt-6"><div className="h-10 w-40 rounded-md bg-surface-hover" /><div className="h-10 w-56 rounded-md bg-surface-hover" /></div>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-5 pt-3"><div className="h-10 flex-1 rounded-md bg-surface-hover" /><div className="h-10 w-32 rounded-md bg-surface-hover" /><div className="h-10 w-32 rounded-md bg-surface-hover" /></div>
      <div className="mx-auto grid max-w-7xl gap-4 px-5 py-5 lg:grid-cols-[350px_1fr]">
        <div className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="space-y-2 px-4 py-4"><div className="h-4 w-3/4 rounded bg-surface-hover" /><div className="h-3 w-1/2 rounded bg-surface-hover" /></div>)}</div>
        <div className="space-y-4 rounded-md border border-border-subtle bg-surface p-6"><div className="h-6 w-1/3 rounded bg-surface-hover" /><div className="h-4 w-2/3 rounded bg-surface-hover" /><div className="h-24 w-full rounded bg-surface-hover" /><div className="h-4 w-1/2 rounded bg-surface-hover" /></div>
      </div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas px-4"><section className="max-w-sm rounded-lg border border-border-subtle bg-surface p-8 text-center"><div className="mx-auto grid size-14 place-items-center rounded-full bg-danger-subtle"><AlertTriangle className="size-7 text-danger" aria-hidden="true" /></div><h1 className="mt-4 text-h1 font-extrabold text-text-primary">تعذر تحميل المهام</h1><p className="mt-2 text-body text-text-secondary">حدث خطأ أثناء الاتصال بالخادم. تحقق من اتصال الشبكة وأعد المحاولة.</p><button onClick={() => void load()} className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover active:scale-[0.98]"><RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة</button></section></main>
  const selected = snapshot.tasks.find(({ id }) => id === selectedId) ?? null
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredTasks = snapshot.tasks.filter((task) => {
    if (normalizedQuery && !task.title.toLowerCase().includes(normalizedQuery) && !task.description.toLowerCase().includes(normalizedQuery)) return false
    if (statusFilter && task.status !== statusFilter) return false
    if (priorityFilter && task.priority !== priorityFilter) return false
    if (assigneeFilter && !task.steps.some((step) => step.assigneeUserId === assigneeFilter)) return false
    if (departmentFilter && task.departmentId !== departmentFilter && !task.steps.some((step) => step.assigneeDepartmentId === departmentFilter)) return false
    return true
  })
  const hasActiveFilters = Boolean(searchQuery || statusFilter || priorityFilter || assigneeFilter || departmentFilter)
  return <main dir="rtl" className="min-h-screen bg-canvas">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-6"><h1 className="text-display font-extrabold text-text-primary">المهام</h1><div className="flex flex-wrap items-center gap-2"><Link to="/projects" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover active:scale-[0.98]"><FolderKanban className="size-4" aria-hidden="true" /> مشروع جديد</Link>{snapshot.capabilities.create && <button onClick={() => setEditor('create')} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] active:bg-brand-600"><Plus className="size-4" aria-hidden="true" /> مهمة</button>}</div></div></header>
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 pt-6">
      <div role="group" aria-label="نطاق المهام" className="inline-flex overflow-hidden rounded-md border border-border-subtle bg-surface">
        {([['self', 'مهامي'], ['organization', 'كل المهام']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={(scope ?? 'self') === key} onClick={() => setScope(key)} className={toggleButtonClass}>{label}</button>)}
      </div>
      <div role="group" aria-label="طريقة عرض المهام" className="inline-flex overflow-hidden rounded-md border border-border-subtle bg-surface">
        {([
          ['list', 'قائمة', LayoutList], ['board', 'لوحة', Columns3],
          ['calendar', 'تقويم', CalendarDays], ['timeline', 'خط زمني', GanttChart],
        ] as const).map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => onViewChange?.(key)} className={`min-w-20 ${toggleButtonClass}`}><Icon className="size-4" aria-hidden="true" /> {label}</button>)}
      </div>
      {snapshot.capabilities.saveView && <button type="button" onClick={() => void client.saveView(organizationId, { name: `عرض ${view}`, view })} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-body font-bold text-text-primary transition-colors hover:bg-surface-hover active:scale-[0.98]"><Save className="size-4" aria-hidden="true" /> حفظ العرض</button>}
    </div>
    <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-5 pt-3">
      <label className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
        <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="بحث في المهام..." aria-label="بحث في المهام" className="w-full rounded-md border border-border-strong bg-surface py-2 pe-3 ps-9 text-body text-text-primary placeholder:text-text-tertiary transition-colors hover:border-text-tertiary" />
      </label>
      <select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskSummary['status'] | '')} className={filterSelectClass}><option value="">كل الحالات</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="تصفية حسب الأولوية" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TaskSummary['priority'] | '')} className={filterSelectClass}><option value="">كل الأولويات</option>{Object.entries(priorityOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="low">عادي (قديم)</option></select>
      <select aria-label="تصفية حسب المسؤول" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className={filterSelectClass}><option value="">كل المسؤولين</option>{snapshot.members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select>
      <select aria-label="تصفية حسب القسم" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className={filterSelectClass}><option value="">كل الأقسام</option>{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
      {hasActiveFilters && <button type="button" onClick={clearFilters} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-2 text-body font-bold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-[0.98]"><FilterX className="size-4" aria-hidden="true" /> مسح الفلاتر</button>}
    </div>
    {actionError && <div className="mx-auto mt-4 max-w-7xl px-5"><p role="alert" className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body font-semibold text-danger"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> {actionError}</p></div>}
    {view === 'list' ? <div className="mx-auto grid max-w-7xl px-5 py-5 lg:grid-cols-[350px_1fr]">
      <aside className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface">{filteredTasks.map((task) => <button key={task.id} onClick={() => setSelectedId(task.id)} aria-current={task.id === selectedId ? 'true' : undefined} className="block w-full cursor-pointer px-4 py-4 text-right transition-colors hover:bg-surface-hover active:bg-surface-hover/80 aria-[current=true]:bg-brand-subtle"><span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate font-bold text-text-primary" title={task.title}>{task.title}</span><PriorityBadge priority={task.priority} /></span><span className="mt-1 block truncate text-caption text-text-secondary">{task.projectName || 'بدون مشروع'} · {statusLabel[task.status]}</span></button>)}
        {filteredTasks.length === 0 && (snapshot.tasks.length === 0
          ? <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-surface-hover"><Inbox className="size-6 text-text-tertiary" aria-hidden="true" /></div>
            <div><p className="font-bold text-text-primary">لا توجد مهام ضمن نطاقك</p><p className="mt-1 text-caption text-text-secondary">{(scope ?? 'self') === 'organization' ? 'لا توجد أي مهام في المؤسسة بعد.' : 'لم يتم إسناد أي مهمة إليك بعد.'}</p></div>
            {snapshot.capabilities.create && <button type="button" onClick={() => setEditor('create')} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-caption font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98]"><Plus className="size-4" aria-hidden="true" /> إنشاء مهمة</button>}
          </div>
          : <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-surface-hover"><SearchX className="size-6 text-text-tertiary" aria-hidden="true" /></div>
            <div><p className="font-bold text-text-primary">لا نتائج مطابقة</p><p className="mt-1 text-caption text-text-secondary">جرّب تعديل كلمة البحث أو الفلاتر المستخدمة.</p></div>
            <button type="button" onClick={clearFilters} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-caption font-bold text-text-primary transition-colors hover:bg-surface-hover active:scale-[0.98]"><FilterX className="size-4" aria-hidden="true" /> مسح الفلاتر</button>
          </div>)}</aside>
      <section className="rounded-md rounded-s-none border border-r-0 border-border-subtle bg-surface p-6">{!selected ? <div className="grid min-h-72 place-items-center"><div className="flex flex-col items-center gap-2 text-center"><ClipboardList className="size-8 text-text-tertiary" aria-hidden="true" /><p className="font-bold text-text-secondary">اختر مهمة من القائمة لعرض تفاصيلها.</p></div></div> : <TaskDetails
        task={selected} snapshot={snapshot} viewerUserId={session?.userId ?? null}
        canEdit={snapshot.capabilities.update} onEdit={() => setEditor('edit')}
        onCompleteStep={async () => {
          setActionError('')
          try {
            await client.completeStep(organizationId, selected.id, selected.version)
            await load()
            setJustTransitionedTaskId(selected.id)
          }
          catch { setActionError('تعذر إكمال الخطوة. تأكد أنك الشخص أو القسم المسند إليه الدور الحالي.') }
        }}
        onSendBack={() => setManualSendBackTarget(selected)}
        onSetStepDueDate={async (order, expectedVersion, dueAt) => {
          setActionError('')
          try { await client.setStepDueDate(organizationId, { taskId: selected.id, stepOrder: order, expectedVersion, dueAt }); await load() }
          catch { setActionError('تعذر تحديث موعد الخطوة.') }
        }}
      />}
      {justTransitionedTaskId === selected?.id && (() => {
        const justAdvancedTask = snapshot.tasks.find((t) => t.id === justTransitionedTaskId)
        const nextStep = justAdvancedTask?.steps.find((step) => step.order === justAdvancedTask.currentStepOrder)
        if (!justAdvancedTask || !nextStep || nextStep.status === 'done' || justAdvancedTask.status !== 'in_progress') return null
        return <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-400/40 bg-brand-subtle p-4 animate-banner-in">
          <p className="text-body font-bold text-brand-300">انتقلت المهمة للخطوة التالية — شارك تذكيرًا مع المسؤول الجديد؟</p>
          <div className="flex items-center gap-2">
            <WhatsappReminderButton task={justAdvancedTask} step={nextStep} snapshot={snapshot} />
            <button type="button" onClick={() => setJustTransitionedTaskId(null)} className="cursor-pointer rounded-md px-2 py-1 text-body font-bold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-[0.98]">تجاهل</button>
          </div>
        </div>
      })()}</section>
    </div> : <TaskAlternateView view={view} tasks={snapshot.tasks} onSelectTask={goToTaskDetail} canCreate={snapshot.capabilities.create} onCreateTask={() => setEditor('create')} />}
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
    {sendBackTarget && <SendBackDialog task={sendBackTarget} onClose={closeSendBack} onSubmit={async (targetStepOrder, reason) => {
      setActionError('')
      try {
        await client.sendBackStep(organizationId, { taskId: sendBackTarget.id, expectedVersion: sendBackTarget.version, targetStepOrder, reason })
        closeSendBack(); await load()
      } catch { setActionError('تعذر إرجاع الخطوة. تأكد من السبب واختيار خطوة سابقة صحيحة.') }
    }} />}
  </main>
}
