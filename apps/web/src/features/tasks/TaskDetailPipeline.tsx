import { Archive, Check, CheckSquare, Clock3, LinkIcon, ListChecks, LoaderCircle, MessageCircle, PauseCircle, Pencil, Play, Plus, UserRound, Undo2, UserRoundPen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { buildWhatsappLink, buildWhatsappReminderMessage } from '../../lib/whatsapp'
import type { Checklist, Subtask, TaskClient, TaskSnapshot, TaskStep, TaskSummary } from './client'
import { PriorityBadge } from './shared'
import { statusLabel, stepStatusLabel } from './constants'

/**
 * The task detail view + its step-pipeline — ZAMAM's signature screen (see DESIGN.md: "the pipeline is
 * the product"). Owned by Phase 4's Subagent F, which carries the most design attention of the whole
 * redesign. TasksListView.tsx renders this inside its master-detail layout; nothing else imports it.
 *
 * StepPipeline renders the chain as connected nodes on a vertical rail (DESIGN.md's "signature screen"
 * section): done = filled success node with a check, current = larger brand-ringed node with a glow (the
 * one place in the app where accent decoration beyond flat fill is earned) sitting on a raised card,
 * pending = outlined muted node. All per-step metadata, including the complete/send-back actions, lives
 * inside that step's own row so the chain stays the single source of truth for the task's state.
 */

/** Area 5: "إرسال تذكير واتساب" targets whoever the CURRENT step's assignee is — disabled with a clear
 * hint if it's a department-assigned step (no specific person yet) or the assignee has no whatsappPhone on
 * file, rather than generating a broken wa.me link. Both disabled states carry a neutral tinted background
 * so they read as an inert info chip, not a grayed-out version of the enabled (success-tinted) button. */
export function WhatsappReminderButton({ task, step, snapshot }: { task: TaskSummary; step: TaskStep; snapshot: TaskSnapshot }) {
  if (step.assigneeType === 'department') {
    return <span className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border-subtle bg-surface-hover px-3 py-2 text-caption font-bold text-text-tertiary" title="الخطوة مسندة لقسم بأكمله — حدد شخصًا أولًا لإرسال تذكير">
      <MessageCircle className="size-4" aria-hidden="true" /> تذكير واتساب (اختر شخصًا أولًا)
    </span>
  }
  const member = snapshot.members.find((m) => m.userId === step.assigneeUserId)
  if (!member?.whatsappPhone) {
    return <span className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border-subtle bg-surface-hover px-3 py-2 text-caption font-bold text-text-tertiary" title="لا يوجد رقم واتساب مسجل لهذا العضو">
      <MessageCircle className="size-4" aria-hidden="true" /> تذكير واتساب (لا يوجد رقم)
    </span>
  }
  const href = buildWhatsappLink(member.whatsappPhone, buildWhatsappReminderMessage({
    taskTitle: task.title, ...(task.projectName ? { projectName: task.projectName } : {}),
    stepName: step.name, priority: task.priority, ...(step.dueAt ? { dueAt: step.dueAt } : {}),
    ...(task.description ? { description: task.description } : {}),
  }))
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-md border border-success/40 bg-success-subtle px-3 py-2 text-body font-bold text-success transition-colors hover:bg-success/20">
    <MessageCircle className="size-4" aria-hidden="true" /> إرسال تذكير واتساب
  </a>
}

export function StepPipeline({ task, snapshot, viewerUserId, onCompleteStep, onSendBack, onReassign, onSetWaiting, onResume, onSetStepDueDate }: {
  task: TaskSummary
  snapshot: TaskSnapshot
  viewerUserId: string | null
  onCompleteStep: () => Promise<void>
  onSendBack: () => void
  onReassign: () => void
  onSetWaiting: () => void
  onResume: () => Promise<void>
  onSetStepDueDate: (order: number, expectedVersion: number, dueAt: string | null) => Promise<void>
}) {
  const memberName = (userId?: string) => userId ? snapshot.members.find((m) => m.userId === userId)?.displayName ?? userId : ''
  const departmentName = (departmentId?: string) => departmentId ? snapshot.departments.find((d) => d.id === departmentId)?.name ?? departmentId : ''
  const current = task.steps.find((step) => step.order === task.currentStepOrder)
  const isTerminal = task.status === 'completed' || task.status === 'cancelled' || task.status === 'archived'
  const viewerMightBeCurrentHolder = Boolean(current && viewerUserId && (
    (current.assigneeType === 'person' && current.assigneeUserId === viewerUserId)
    || current.assigneeType === 'department'
  ))
  // Reassignment also allows the task creator. Managers/Department Leads may be shown this control by the
  // permissive holder heuristic; the server's audited four-way check remains the authority.
  const viewerMightReassign = Boolean(viewerMightBeCurrentHolder || (viewerUserId && task.createdBy === viewerUserId))
  return <section aria-labelledby="task-pipeline-heading" className="mt-6 border-t border-border-subtle pt-5">
    <h3 id="task-pipeline-heading" className="text-h2 font-extrabold text-text-primary">مسار الخطوات ({isTerminal ? task.stepCount : task.currentStepOrder + 1}/{task.stepCount})</h3>
    {/* Connected chain: each step is a node on a vertical rail, not a free-floating bordered box — the
        rail + node fill are the "where is this task right now" signal, legible before reading any text. */}
    <ol className="mt-4">
      {task.steps.map((step, index) => {
        const isCurrent = step.order === task.currentStepOrder && !isTerminal
        const isDone = step.status === 'done'
        const isSentBack = step.status === 'sent_back'
        const isWaiting = step.status === 'waiting'
        const isLast = index === task.steps.length - 1

        let nodeClasses = 'relative z-10 grid shrink-0 place-items-center rounded-full text-label font-extrabold transition-all duration-200 '
        if (isDone) nodeClasses += 'size-8 bg-success text-canvas'
        else if (isWaiting) nodeClasses += 'size-10 border-2 border-border-strong bg-surface-hover text-text-secondary'
        else if (isCurrent) nodeClasses += 'size-10 bg-brand-400/20 text-brand-300 ring-2 ring-brand-400 shadow-[0_0_0_6px_rgba(29,122,153,0.18)] animate-node-settle'
        else if (isSentBack) nodeClasses += 'size-8 border-2 border-warning/60 bg-warning-subtle text-warning'
        else nodeClasses += 'size-8 border-2 border-border-strong bg-surface text-text-tertiary'

        const nodeContent = isDone
          ? <Check className="size-4" aria-hidden="true" />
          : isWaiting
            ? <PauseCircle className="size-4" aria-hidden="true" />
          : isSentBack
            ? <Undo2 className="size-3.5" aria-hidden="true" />
            : <span>{step.order + 1}</span>

        const pillClasses = `shrink-0 rounded-sm px-1.5 py-0.5 text-caption font-bold ${
          isDone ? 'bg-success-subtle text-success' : isWaiting ? 'bg-surface-hover text-text-secondary' : isCurrent ? 'bg-brand-subtle text-brand-300' : isSentBack ? 'bg-warning-subtle text-warning' : 'bg-surface-hover text-text-secondary'
        }`

        const cardClasses = `min-w-0 flex-1 rounded-md border p-3 transition-colors duration-200 ${
          isWaiting ? 'border-border-strong bg-surface-hover' : isCurrent ? 'border-brand-400/40 bg-surface-raised' : 'border-border-subtle bg-surface'
        }`

        return <li key={step.id} className="relative pb-4 last:pb-0">
          <div className="flex items-start gap-3">
            {/* Fixed-footprint node slot so the rail stays perfectly straight whether the node inside is
                the small pending/done size or the larger current-step size. */}
            <div className="relative flex size-10 shrink-0 items-center justify-center">
              <span className={nodeClasses}>{nodeContent}</span>
            </div>
            <div className={cardClasses}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-bold text-text-primary" title={step.name}>{step.name}</p>
                    <span className={pillClasses}>{stepStatusLabel[step.status]}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-label text-text-secondary">
                    <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{step.assigneeType === 'person' ? memberName(step.assigneeUserId) : `فريق: ${departmentName(step.assigneeDepartmentId)}`}</span>
                  </p>
                  {step.driveLink && <a href={step.driveLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-label font-semibold text-brand-300 underline underline-offset-2 hover:text-brand-400">
                    <LinkIcon className="size-3" aria-hidden="true" /> رابط Drive
                  </a>}
                  {step.waitingReason && <p className="mt-2 flex items-start gap-1.5 text-label text-text-secondary">
                    <PauseCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> <span>سبب التعليق: {step.waitingReason}</span>
                  </p>}
                </div>
                {isCurrent && <WhatsappReminderButton task={task} step={step} snapshot={snapshot} />}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-caption font-semibold text-text-secondary">
                  موعد استحقاق الخطوة
                  <input
                    type="date" value={step.dueAt?.slice(0, 10) ?? ''}
                    onChange={(event) => void onSetStepDueDate(step.order, step.version, event.target.value ? new Date(event.target.value).toISOString() : null)}
                    className="rounded-sm border border-border-strong bg-surface px-2 py-1 text-text-primary"
                  />
                </label>
                {isCurrent && (viewerMightBeCurrentHolder || viewerMightReassign) && <div className="flex flex-wrap gap-2">
                  {viewerMightBeCurrentHolder && isWaiting && <button type="button" onClick={() => void onResume()} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-surface-raised px-3 py-2 text-body font-bold text-text-primary hover:bg-surface active:scale-[0.98] transition-all"><Play className="size-4" aria-hidden="true" /> استئناف</button>}
                  {viewerMightBeCurrentHolder && step.status === 'in_progress' && <>
                    <button type="button" onClick={() => void onCompleteStep()} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-body font-bold text-text-primary hover:bg-brand-400 active:scale-[0.98] transition-all"><CheckSquare className="size-4" aria-hidden="true" /> إنهاء الخطوة الحالية</button>
                    {task.currentStepOrder > 0 && <button type="button" onClick={onSendBack} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-body font-bold text-warning hover:bg-surface-hover active:scale-[0.98] transition-all"><Undo2 className="size-4" aria-hidden="true" /> إرجاع إلى خطوة سابقة</button>}
                    <button type="button" onClick={onSetWaiting} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-body font-bold text-text-secondary hover:bg-surface-hover active:scale-[0.98] transition-all"><PauseCircle className="size-4" aria-hidden="true" /> تعليق الخطوة</button>
                  </>}
                  {viewerMightReassign && <button type="button" onClick={onReassign} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-body font-bold text-text-primary hover:bg-surface-hover active:scale-[0.98] transition-all"><UserRoundPen className="size-4" aria-hidden="true" /> تحويل لشخص آخر</button>}
                </div>}
              </div>
            </div>
          </div>
          {/* The rail segment between this node and the next — colored success once this step is done, so
              a completed run of the chain reads as a solid line at a glance. */}
          {/* insetInlineStart, not -End: the node column is the flex row's FIRST child, which under this
              app's permanent dir="rtl" renders at the row's visual right edge — inline-start resolves to
              physical `right` in RTL, matching where the nodes actually sit. (Verified bug: -End resolved
              to `left`, pinning the rail to the wrong side of the row, disconnected from the nodes.) */}
          {!isLast && <span aria-hidden="true" className={`absolute bottom-0 top-10 w-0.5 transition-colors duration-200 ${isDone ? 'bg-success/50' : 'bg-border-subtle'}`} style={{ insetInlineStart: '19px' }} />}
        </li>
      })}
    </ol>
  </section>
}

const subtaskStatusLabel = { ready: 'جاهزة', in_progress: 'قيد التنفيذ', done: 'منتهية' } as const

/** Both panels share the same load-on-mount + local mutate-then-refetch shape: no optimistic update, since
 * these are low-frequency actions where a round-trip is imperceptible and refetching keeps the version
 * numbers (needed for the next mutation) always correct without duplicating the server's state machine. */
function SubtasksPanel({ task, client, organizationId, canManage }: { task: TaskSummary; client: TaskClient; organizationId: string; canManage: boolean }) {
  const [subtasks, setSubtasks] = useState<Subtask[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const load = useCallback(async () => {
    try { setSubtasks((await client.loadChecklistAndSubtasks(organizationId, task.id)).subtasks as Subtask[]); setStatus('ready') }
    catch { setStatus('error') }
  }, [client, organizationId, task.id])
  // No setStatus('loading') here on purpose — status already starts as 'loading'. A refetch after a
  // mutation (see onChange handlers below) intentionally does NOT reset to the loading spinner — it swaps
  // the list in place once the new data arrives, which reads better for a small in-panel list.
  // The Promise.resolve().then() wrapper (not just calling load() directly) is required for
  // react-hooks/set-state-in-effect: the rule flags any setState call it can trace as reachable directly
  // from the effect body, even one only reached after an await inside load() itself; nesting the call one
  // microtask deeper, the same fix already used in TasksListView.tsx's mount effect, satisfies it.
  useEffect(() => { void Promise.resolve().then(() => load()) }, [load])

  if (status === 'loading') return <p role="status" className="py-8 text-center text-text-secondary"><LoaderCircle className="inline size-4 animate-spin" aria-hidden="true" /> جارٍ التحميل...</p>
  if (status === 'error' || !subtasks) return <p className="py-8 text-center text-danger">تعذر تحميل المهام الفرعية.</p>

  return <div className="py-5">
    {canManage && <form className="mb-4 flex gap-2" onSubmit={async (event) => {
      event.preventDefault()
      if (!title.trim()) return
      setSubmitting(true)
      try { await client.addSubtask(organizationId, { taskId: task.id, title: title.trim() }); setTitle(''); await load() }
      finally { setSubmitting(false) }
    }}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مهمة فرعية جديدة..." className="flex-1 rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary placeholder:text-text-tertiary" />
      <button type="submit" disabled={submitting || !title.trim()} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-body font-bold text-text-primary hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" aria-hidden="true" /> إضافة</button>
    </form>}
    {subtasks.length === 0
      ? <p className="py-6 text-center text-text-tertiary">لا توجد مهام فرعية بعد.</p>
      : <ul className="space-y-2">{subtasks.map((subtask) => <li key={subtask.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface p-3">
          <div className="min-w-0"><p className="truncate font-bold text-text-primary">{subtask.title}</p>{subtask.assigneeName && <p className="text-caption text-text-secondary">{subtask.assigneeName}</p>}</div>
          {canManage
            ? <select value={subtask.status} onChange={async (event) => { await client.setSubtaskStatus(organizationId, { subtaskId: subtask.id, expectedVersion: subtask.version, status: event.target.value as Subtask['status'] }); await load() }} className="cursor-pointer rounded-sm border border-border-strong bg-canvas px-2 py-1 text-caption text-text-primary">
                {Object.entries(subtaskStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            : <span className="rounded-sm bg-surface-hover px-2 py-1 text-caption font-bold text-text-secondary">{subtaskStatusLabel[subtask.status]}</span>}
        </li>)}</ul>}
  </div>
}

function ChecklistPanel({ task, client, organizationId, canManage }: { task: TaskSummary; client: TaskClient; organizationId: string; canManage: boolean }) {
  const [checklists, setChecklists] = useState<Checklist[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const load = useCallback(async () => {
    // See SubtasksPanel's load() above for why there's no setStatus('loading') here.
    try { setChecklists((await client.loadChecklistAndSubtasks(organizationId, task.id)).checklists as Checklist[]); setStatus('ready') }
    catch { setStatus('error') }
  }, [client, organizationId, task.id])
  // See SubtasksPanel's mount effect above for why this goes through Promise.resolve().then() rather than
  // calling load() directly.
  useEffect(() => { void Promise.resolve().then(() => load()) }, [load])

  if (status === 'loading') return <p role="status" className="py-8 text-center text-text-secondary"><LoaderCircle className="inline size-4 animate-spin" aria-hidden="true" /> جارٍ التحميل...</p>
  if (status === 'error' || !checklists) return <p className="py-8 text-center text-danger">تعذر تحميل قائمة التحقق.</p>

  // The backend only supports creating a checklist with its items in one shot (no "add item to an existing
  // checklist" command) — so each "إضافة" call creates its own single-item checklist, and this panel flattens
  // every checklist's items into one list. Functionally identical to one running checklist from the user's
  // point of view; avoids inventing a new backend command for something the tab genuinely just needs to render.
  const items = checklists.flatMap((checklist) => checklist.items.map((item) => ({ ...item, checklistId: checklist.id })))
  return <div className="py-5">
    {canManage && <form className="mb-4 flex gap-2" onSubmit={async (event) => {
      event.preventDefault()
      if (!text.trim()) return
      setSubmitting(true)
      try { await client.createChecklist(organizationId, { taskId: task.id, title: 'قائمة تحقق', required: false, items: [{ text: text.trim(), required: false }] }); setText(''); await load() }
      finally { setSubmitting(false) }
    }}>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="بند جديد..." className="flex-1 rounded-md border border-border-strong bg-canvas px-3 py-2 text-text-primary placeholder:text-text-tertiary" />
      <button type="submit" disabled={submitting || !text.trim()} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-body font-bold text-text-primary hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="size-4" aria-hidden="true" /> إضافة</button>
    </form>}
    {items.length === 0
      ? <p className="py-6 text-center text-text-tertiary">لا توجد بنود بعد.</p>
      : <ul className="space-y-2">{items.map((item) => <li key={item.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface p-3">
          <input
            type="checkbox" checked={item.completed} disabled={!canManage}
            onChange={async (event) => { await client.setChecklistItem(organizationId, { itemId: item.id, expectedVersion: item.version, completed: event.target.checked }); await load() }}
            className="size-4 cursor-pointer rounded-sm border-border-strong accent-brand-500 disabled:cursor-not-allowed"
          />
          <span className={item.completed ? 'text-text-tertiary line-through' : 'text-text-primary'}>{item.text}</span>
        </li>)}</ul>}
  </div>
}

export function TaskDetails({ task, snapshot, viewerUserId, canEdit, client, organizationId, onEdit, onCompleteStep, onSendBack, onReassign, onSetWaiting, onResume, onSetStepDueDate, onArchive }: {
  task: TaskSummary
  snapshot: TaskSnapshot
  viewerUserId: string | null
  canEdit: boolean
  client: TaskClient
  organizationId: string
  onEdit: () => void
  onCompleteStep: () => Promise<void>
  onSendBack: () => void
  onReassign: () => void
  onSetWaiting: () => void
  onResume: () => Promise<void>
  onSetStepDueDate: (order: number, expectedVersion: number, dueAt: string | null) => Promise<void>
  onArchive?: () => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'subtasks' | 'checklist'>('overview')
  const canManageSubItems = canEdit && !['completed', 'cancelled', 'archived'].includes(task.status)
  const tabClass = (tab: typeof activeTab) => `-mb-px cursor-pointer border-b-2 px-1 pb-3 pt-4 transition-colors ${activeTab === tab ? 'border-brand-400 text-brand-300' : 'border-transparent text-text-secondary hover:text-text-primary'}`
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle pb-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-h1 font-extrabold text-text-primary">{task.title}</h2>
          <span className="rounded-sm bg-surface-hover px-2 py-1 text-caption font-bold text-text-secondary">{statusLabel[task.status]}</span>
          <PriorityBadge priority={task.priority} />
        </div>
        <p className="mt-1 text-body text-text-secondary">{task.projectName || 'بدون مشروع'}{task.workspaceName ? ` · ${task.workspaceName}` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        {canEdit && !['completed', 'cancelled', 'archived'].includes(task.status) && <button onClick={onEdit} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-body font-bold text-text-primary hover:bg-surface-hover"><Pencil className="size-4" aria-hidden="true" /> تعديل</button>}
        {/* Archive is only a legal transition from completed/cancelled (see assertTaskStatusTransition in
            @zamam/domain) — showing it any earlier would let the user click into a guaranteed backend
            rejection instead of a clear reason why the action isn't available yet. */}
        {onArchive && ['completed', 'cancelled'].includes(task.status) && <button onClick={() => void onArchive()} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-body font-bold text-text-secondary hover:border-danger/40 hover:bg-danger-subtle hover:text-danger"><Archive className="size-4" aria-hidden="true" /> أرشفة</button>}
      </div>
    </div>
    <nav aria-label="أقسام المهمة" className="flex gap-5 overflow-x-auto border-b border-border-subtle text-body font-bold">
      <button type="button" onClick={() => setActiveTab('overview')} className={tabClass('overview')}>نظرة عامة</button>
      <button type="button" onClick={() => setActiveTab('subtasks')} className={tabClass('subtasks')}>المهام الفرعية</button>
      <button type="button" onClick={() => setActiveTab('checklist')} className={tabClass('checklist')}>قائمة التحقق</button>
      <a href={`/tasks/${task.id}/collaboration`} className="-mb-px border-b-2 border-transparent px-1 pb-3 pt-4 text-text-secondary transition-colors hover:border-brand-400/50 hover:text-brand-300">التعليقات والنشاط</a>
    </nav>
    {activeTab === 'subtasks' && <SubtasksPanel task={task} client={client} organizationId={organizationId} canManage={canManageSubItems} />}
    {activeTab === 'checklist' && <ChecklistPanel task={task} client={client} organizationId={organizationId} canManage={canManageSubItems} />}
    {activeTab === 'overview' && <>
      <p className="min-h-28 whitespace-pre-wrap py-6 text-text-secondary">{task.description || 'لا يوجد وصف.'}</p>
      <div className="grid gap-4 border-t border-border-subtle pt-5 sm:grid-cols-2">
        <div className="flex gap-2 text-text-secondary"><Clock3 className="size-4" aria-hidden="true" /><span>{task.dueAt ?? 'دون موعد'}</span></div>
        <div className="flex gap-2 text-text-secondary"><UserRound className="size-4" aria-hidden="true" /><span>{task.assigneeNames.join('، ') || 'غير مسندة'}</span></div>
      </div>
      {task.driveLink && <p className="mt-3"><a href={task.driveLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-body font-bold text-brand-300 underline"><LinkIcon className="size-4" aria-hidden="true" /> رابط Drive للمهمة</a></p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => setActiveTab('checklist')} className="inline-flex cursor-pointer items-center gap-2 rounded-sm bg-surface-hover px-2.5 py-1 text-label font-semibold text-text-secondary hover:bg-surface-raised"><CheckSquare className="size-3.5" aria-hidden="true" /> قائمة التحقق</button>
        <button type="button" onClick={() => setActiveTab('subtasks')} className="inline-flex cursor-pointer items-center gap-2 rounded-sm bg-surface-hover px-2.5 py-1 text-label font-semibold text-text-secondary hover:bg-surface-raised"><ListChecks className="size-3.5" aria-hidden="true" /> المهام الفرعية</button>
      </div>
    </>}
    {/* The pipeline stays visible under every tab, not just Overview — it's the signature screen and the
        complete/send-back actions live there; hiding it while checking off subtasks would be a regression. */}
    <StepPipeline task={task} snapshot={snapshot} viewerUserId={viewerUserId} onCompleteStep={onCompleteStep} onSendBack={onSendBack} onReassign={onReassign} onSetWaiting={onSetWaiting} onResume={onResume} onSetStepDueDate={onSetStepDueDate} />
  </>
}
