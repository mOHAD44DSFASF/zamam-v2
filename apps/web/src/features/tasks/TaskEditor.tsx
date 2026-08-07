import { LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TaskSnapshot, TaskStepInputForm, TaskSummary } from './client'
import { priorityOptions } from './shared'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

/**
 * The task creation/edit flow, including the dynamic step-pipeline builder. Owned by Phase 4's Subagent E.
 * Reused as-is by the dashboard's "إنشاء مهمة" quick action (DashboardPage.tsx) and by TasksListView.tsx —
 * one form, not two drifting copies.
 */

// Shared field/label vocabulary so every input in this form reads identically — default, hover, focus and
// (for selects/dates) a pointer cursor, per DESIGN.md's Components floor.
const fieldClass = 'mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2.5 text-body text-text-primary placeholder:text-text-tertiary transition-colors duration-150 hover:border-text-tertiary focus:border-brand-400'
const labelClass = 'block text-body font-bold text-text-primary'
const stepLabelClass = 'block text-label font-semibold text-text-secondary'

function StepBuilder({ steps, snapshot, onChange }: {
  steps: readonly TaskStepInputForm[]
  snapshot: TaskSnapshot
  onChange: (steps: readonly TaskStepInputForm[]) => void
}) {
  const update = (index: number, patch: Partial<TaskStepInputForm>) =>
    onChange(steps.map((step, i) => i === index ? { ...step, ...patch } : step))
  return <div className="mt-5">
    <div className="flex items-center justify-between gap-3">
      <p className="text-body font-bold text-text-primary">خطوات المهمة *</p>
      <button
        type="button"
        onClick={() => onChange([...steps, { name: '', assigneeType: 'person', assigneeUserId: snapshot.members[0]?.userId ?? '' }])}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-brand-400/40 px-3 py-1.5 text-label font-bold text-brand-300 transition-colors duration-150 hover:border-brand-400 hover:bg-brand-subtle active:scale-[0.98]"
      >
        <Plus className="size-4" aria-hidden="true" /> إضافة خطوة
      </button>
    </div>
    {/* Numbered nodes + a connecting rail rhyme with the live pipeline's node language (DESIGN.md's
        signature screen), without borrowing its done/current/pending color states or the current-step glow
        — every step here is an equal, still-being-drafted node, none of them is "current" yet. */}
    <ol className="mt-3">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return <li key={index} className={`flex gap-3 ${isLast ? '' : 'pb-3'}`}>
          <div className="flex flex-col items-center">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-brand-400/40 bg-brand-subtle text-label font-extrabold text-brand-300">
              {index + 1}
            </span>
            {!isLast && <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border-subtle" />}
          </div>
          <div className="min-w-0 flex-1 rounded-md border border-border-subtle bg-surface p-3 transition-colors duration-150 hover:border-border-strong">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-extrabold text-text-tertiary">الخطوة {index + 1}</span>
              {steps.length > 1 && <button
                type="button"
                onClick={() => onChange(steps.filter((_, i) => i !== index))}
                aria-label={`حذف الخطوة ${index + 1}`}
                className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-danger-subtle hover:text-danger active:scale-95"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>}
            </div>
            <label className={`mt-2 ${stepLabelClass}`}>اسم الخطوة
              <input required minLength={2} value={step.name} onChange={(event) => update(index, { name: event.target.value })} className={fieldClass} />
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className={stepLabelClass}>نوع المُسند إليه</p>
                <div role="group" aria-label="نوع المُسند إليه" className="mt-2 inline-flex w-full rounded-md border border-border-strong bg-canvas p-0.5">
                  <button
                    type="button"
                    onClick={() => update(index, { assigneeType: 'person', assigneeUserId: undefined, assigneeDepartmentId: undefined })}
                    className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-label font-bold transition-colors duration-150 ${step.assigneeType === 'person' ? 'bg-brand-500 text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}
                  >
                    شخص
                  </button>
                  <button
                    type="button"
                    onClick={() => update(index, { assigneeType: 'department', assigneeUserId: undefined, assigneeDepartmentId: undefined })}
                    className={`flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-label font-bold transition-colors duration-150 ${step.assigneeType === 'department' ? 'bg-brand-500 text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}
                  >
                    قسم
                  </button>
                </div>
              </div>
              {step.assigneeType === 'person'
                ? <label className={stepLabelClass}>الشخص
                    <select required value={step.assigneeUserId ?? ''} onChange={(event) => update(index, { assigneeUserId: event.target.value })} className={`${fieldClass} cursor-pointer`}>
                      <option value="" disabled>اختر شخصًا</option>
                      {snapshot.members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                    </select>
                  </label>
                : <label className={stepLabelClass}>القسم
                    <select required value={step.assigneeDepartmentId ?? ''} onChange={(event) => update(index, { assigneeDepartmentId: event.target.value })} className={`${fieldClass} cursor-pointer`}>
                      <option value="" disabled>اختر قسمًا</option>
                      {snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </label>}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className={stepLabelClass}>رابط Drive (اختياري)
                <input type="url" dir="ltr" placeholder="https://drive.google.com/…" value={step.driveLink ?? ''} onChange={(event) => update(index, { driveLink: event.target.value })} className={`${fieldClass} text-left`} />
              </label>
              <label className={stepLabelClass}>موعد استحقاق الخطوة (اختياري)
                <input type="date" value={step.dueAt?.slice(0, 10) ?? ''} onChange={(event) => update(index, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} className={`${fieldClass} cursor-pointer`} />
              </label>
            </div>
          </div>
        </li>
      })}
    </ol>
  </div>
}

export type EditorInput = {
  projectId?: string; workspaceId?: string; departmentId?: string; title: string; description: string
  priority: TaskSummary['priority']; dueAt?: string; driveLink?: string; clientVisible: boolean
  steps: readonly TaskStepInputForm[]
}
/** Exported so the dashboard's "إنشاء مهمة" quick-action (Area 3) can reuse the exact same
 * create/edit form and step-pipeline builder instead of maintaining a second, drifting copy. */
export function TaskEditor({ mode, snapshot, task, initialDepartmentId, onClose, onSubmit }: {
  mode: 'create' | 'edit'; snapshot: TaskSnapshot; task: TaskSummary | null; initialDepartmentId?: string
  onClose: () => void; onSubmit: (input: EditorInput) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  const [workspaceId, setWorkspaceId] = useState('')
  const [departmentId, setDepartmentId] = useState(task?.departmentId ?? initialDepartmentId ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskSummary['priority']>(task?.priority ?? 'medium')
  const [dueAt, setDueAt] = useState(task?.dueAt?.slice(0, 16) ?? '')
  const [driveLink, setDriveLink] = useState(task?.driveLink ?? '')
  const [steps, setSteps] = useState<readonly TaskStepInputForm[]>([{ name: '', assigneeType: 'person', assigneeUserId: snapshot.members[0]?.userId ?? '' }])
  const [submitting, setSubmitting] = useState(false)
  const availableWorkspaces = useMemo(() => snapshot.workspaces.filter((item) => !item.projectId || item.projectId === projectId), [snapshot.workspaces, projectId])
  useEscapeToClose(onClose)
  return <div role="presentation" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 animate-backdrop-in"><form role="dialog" aria-modal="true" aria-labelledby="task-editor-title" className="my-6 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in" onSubmit={async (event) => {
    event.preventDefault(); setSubmitting(true)
    try {
      await onSubmit({
        ...(projectId ? { projectId } : {}), ...(workspaceId ? { workspaceId } : {}), ...(departmentId ? { departmentId } : {}),
        title, description, priority, ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(driveLink ? { driveLink } : {}), clientVisible: task?.clientVisible ?? false, steps,
      })
    } finally { setSubmitting(false) }
  }}>
    <div className="flex items-center justify-between gap-4">
      <h2 id="task-editor-title" className="text-h1 font-extrabold text-text-primary">{mode === 'create' ? 'مهمة جديدة' : 'تعديل المهمة'}</h2>
      <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-95">
        <X className="size-5" aria-hidden="true" />
      </button>
    </div>
    <label className={`mt-5 ${labelClass}`}>العنوان<input required minLength={2} value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} /></label>
    {mode === 'create' && <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>المشروع (اختياري)<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setWorkspaceId('') }} className={`${fieldClass} cursor-pointer`}><option value="">بدون مشروع</option>{snapshot.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className={labelClass}>القسم (اختياري)<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={`${fieldClass} cursor-pointer`}><option value="">بدون قسم محدد</option>{snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      </div>
      {projectId && <label className={`mt-4 ${labelClass}`}>مساحة العمل<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={`${fieldClass} cursor-pointer`}><option value="">دون مساحة</option>{availableWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
    </>}
    <label className={`mt-4 ${labelClass}`}>الوصف<textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${fieldClass} min-h-28`} /></label>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className={labelClass}>الأولوية<select value={priority} onChange={(event) => setPriority(event.target.value as TaskSummary['priority'])} className={`${fieldClass} cursor-pointer`}>{Object.entries(priorityOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={labelClass}>موعد التسليم<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className={`${fieldClass} cursor-pointer`} /></label>
    </div>
    {mode === 'create' && <label className={`mt-4 ${labelClass}`}>رابط Drive للمهمة (اختياري)<input type="url" dir="ltr" placeholder="https://drive.google.com/…" value={driveLink} onChange={(event) => setDriveLink(event.target.value)} className={`${fieldClass} text-left`} /></label>}
    {mode === 'create' && <StepBuilder steps={steps} snapshot={snapshot} onChange={setSteps} />}
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-colors duration-150 hover:bg-surface-hover active:scale-[0.98]">إلغاء</button>
      <button type="submit" disabled={submitting} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all duration-150 hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100">
        {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {submitting ? 'جارٍ الحفظ...' : 'حفظ'}
      </button>
    </div>
  </form></div>
}
