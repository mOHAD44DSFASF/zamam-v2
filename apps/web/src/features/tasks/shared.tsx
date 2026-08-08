import type { TaskSummary } from './client'
import { priorityBadgeClass, priorityBadgeLabel } from './constants'

/**
 * The priority badge shared across TasksListView.tsx (Subagent D), TaskEditor.tsx (Subagent E), and
 * TaskDetailPipeline.tsx (Subagent F) — kept in one file, owned by the lead pass, so all three build on
 * one consistent vocabulary. See DESIGN.md for the token system. Non-component constants live in
 * constants.ts (this file must stay component-only for react-refresh/only-export-components).
 */
export function PriorityBadge({ priority }: { priority: TaskSummary['priority'] }) {
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-caption font-semibold ${priorityBadgeClass[priority]}`}>{priorityBadgeLabel[priority]}</span>
}
