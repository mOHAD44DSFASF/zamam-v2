import type { TaskStep, TaskSummary } from './client'

/**
 * Constants and the priority badge shared across TasksListView.tsx (Subagent D), TaskEditor.tsx
 * (Subagent E), and TaskDetailPipeline.tsx (Subagent F) — kept in one file, owned by the lead pass, so all
 * three build on one consistent vocabulary. See DESIGN.md for the token system.
 */

export const statusLabel: Record<TaskSummary['status'], string> = {
  draft: 'مسودة', ready: 'جاهزة', in_progress: 'قيد التنفيذ', blocked: 'متوقفة',
  in_review: 'قيد المراجعة', approved: 'معتمدة', completed: 'مكتملة',
  cancelled: 'ملغاة', archived: 'مؤرشفة',
}
// Three product-facing tiers (عادي/مهم/عاجل) over the existing 4-value backend enum — reused as-is rather
// than adding a new field/enum: 'low' and 'medium' both read as "عادي" (the create form only ever offers
// medium/high/urgent going forward), 'high' as "مهم", 'urgent' as "عاجل".
export const priorityBadgeLabel = { low: 'عادي', medium: 'عادي', high: 'مهم', urgent: 'عاجل' } as const
const priorityBadgeClass = {
  low: 'bg-surface-hover text-text-secondary', medium: 'bg-surface-hover text-text-secondary',
  high: 'bg-warning-subtle text-warning', urgent: 'bg-danger-subtle text-danger',
} as const
export const priorityOptions = { medium: 'عادي', high: 'مهم', urgent: 'عاجل' } as const

export function PriorityBadge({ priority }: { priority: TaskSummary['priority'] }) {
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-caption font-semibold ${priorityBadgeClass[priority]}`}>{priorityBadgeLabel[priority]}</span>
}

export const stepStatusLabel: Record<TaskStep['status'], string> = {
  pending: 'قادمة', in_progress: 'جارية', done: 'منتهية', sent_back: 'أُعيدت',
}
