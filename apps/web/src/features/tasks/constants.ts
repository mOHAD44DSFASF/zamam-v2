import type { TaskStep, TaskSummary } from './client'

/**
 * Non-component constants shared across the tasks feature — split out from shared.tsx (which now holds
 * only PriorityBadge) so that file can stay component-only for react-refresh/only-export-components.
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
export const priorityBadgeClass = {
  low: 'bg-surface-hover text-text-secondary', medium: 'bg-surface-hover text-text-secondary',
  high: 'bg-warning-subtle text-warning', urgent: 'bg-danger-subtle text-danger',
} as const
export const priorityOptions = { medium: 'عادي', high: 'مهم', urgent: 'عاجل' } as const

export const stepStatusLabel: Record<TaskStep['status'], string> = {
  pending: 'قادمة', in_progress: 'جارية', done: 'منتهية', sent_back: 'أُعيدت',
}
