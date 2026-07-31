import { appCheckHeaders, auth } from '../../lib/firebase'

export interface TaskSummary {
  id: string
  projectId: string
  projectName: string
  workspaceName: string | null
  title: string
  description: string
  status: 'draft' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'approved' | 'completed' | 'cancelled' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueAt: string | null
  assigneeNames: readonly string[]
  clientVisible: boolean
  version: number
  subtaskCount: number
  completedSubtaskCount: number
  checklistCount: number
  completedChecklistCount: number
  workflow?: {
    instanceId: string
    workflowVersionId: string
    currentStageKey: string
    currentStageName: string
    concurrencyVersion: number
    stageDueAt: string | null
    availableTransitions: readonly { key: string; label: string; toStageName: string }[]
  }
}
export interface TaskSnapshot {
  tasks: readonly TaskSummary[]
  projects: readonly { id: string; name: string }[]
  workspaces: readonly { id: string; name: string; projectId?: string }[]
  capabilities: { create: boolean; update: boolean; transition: boolean; assign: boolean; reopen: boolean; archive: boolean; saveView: boolean }
}
export interface TaskClient {
  load(organizationId: string): Promise<TaskSnapshot>
  create(organizationId: string, input: {
    projectId: string; workspaceId?: string; title: string; description: string;
    priority: TaskSummary['priority']; dueAt?: string; clientVisible: boolean
  }): Promise<void>
  update(organizationId: string, input: {
    taskId: string; expectedVersion: number; title: string; description: string;
    priority: TaskSummary['priority']; dueAt: string | null; clientVisible: boolean
  }): Promise<void>
  saveView(organizationId: string, input: { name: string; view: 'list' | 'board' | 'calendar' | 'timeline' }): Promise<void>
  transitionWorkflow(organizationId: string, input: { instanceId: string; transitionKey: string; expectedConcurrencyVersion: number }): Promise<void>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL
  const user = auth.currentUser
  if (!baseUrl || !user) throw new Error('BACKEND_NOT_CONFIGURED')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      ...await appCheckHeaders(),
    },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as { data?: T; error?: { code: string } }
  if (!response.ok || envelope.error || envelope.data === undefined) throw new Error(envelope.error?.code ?? 'TASK_REQUEST_FAILED')
  return envelope.data
}

export interface RawTaskQueryResponse {
  items: readonly RawTaskRecord[]; nextCursor: unknown
  projects?: TaskSnapshot['projects']; workspaces?: TaskSnapshot['workspaces']; capabilities?: TaskSnapshot['capabilities']
}
export interface RawTaskRecord {
  id?: unknown; projectId?: unknown; title?: unknown; description?: unknown
  status?: unknown; priority?: unknown; dueAt?: unknown; clientVisible?: unknown; version?: unknown
}

/**
 * POST /v1/tasks/query (services/functions/src/task/query.ts) returns { items, nextCursor } — raw task
 * documents, not the enriched TaskSnapshot shape (project/workspace names, assignee names, subtask/
 * checklist counts, workflow summary, capability flags) this screen was built against. That enrichment
 * doesn't exist server-side yet. This adapter turns the real response into a valid, non-crashing
 * TaskSnapshot: an empty result becomes a correct empty state instead of throwing on `.tasks[0]`, and a
 * non-empty result renders with the fields the backend actually provides — projectName/workspaceName/
 * assigneeNames/counts/workflow are degraded to safe placeholders until that backend work lands.
 * capabilities defaults to all-false (fail closed) since this endpoint carries no permission
 * information — action buttons stay hidden rather than being shown and then rejected server-side.
 */
export function toTaskSnapshot(response: RawTaskQueryResponse): TaskSnapshot {
  const tasks: TaskSummary[] = response.items.map((item) => ({
    id: String(item.id ?? ''),
    projectId: String(item.projectId ?? ''),
    projectName: String(item.projectId ?? ''),
    workspaceName: null,
    title: typeof item.title === 'string' ? item.title : '',
    description: typeof item.description === 'string' ? item.description : '',
    status: item.status as TaskSummary['status'],
    priority: item.priority as TaskSummary['priority'],
    dueAt: typeof item.dueAt === 'string' ? item.dueAt : null,
    assigneeNames: [],
    clientVisible: Boolean(item.clientVisible),
    version: typeof item.version === 'number' ? item.version : 1,
    subtaskCount: 0, completedSubtaskCount: 0, checklistCount: 0, completedChecklistCount: 0,
  }))
  // Prefer the real project pick-list from the handler; fall back to deriving from task rows.
  const projects = response.projects && response.projects.length > 0
    ? response.projects
    : [...new Map(tasks.map((task) => [task.projectId, { id: task.projectId, name: task.projectName }])).values()]
  return {
    tasks, projects, workspaces: response.workspaces ?? [],
    capabilities: response.capabilities ?? { create: false, update: false, transition: false, assign: false, reopen: false, archive: false, saveView: false },
  }
}

export const taskClient: TaskClient = {
  load: async (organizationId) => toTaskSnapshot(await post('/v1/tasks/query', { organizationId, limit: 50 })),
  create: (organizationId, input) => post('/v1/tasks/create', { organizationId, id: crypto.randomUUID(), ...input }),
  update: (organizationId, input) => post('/v1/tasks/update', { organizationId, ...input }),
  saveView: (organizationId, input) => post('/v1/task-views/create', {
    organizationId, id: crypto.randomUUID(), resourceType: 'task',
    name: input.name, filters: { presentation: input.view }, visibility: 'private',
  }),
  transitionWorkflow: (organizationId, input) => post('/v1/workflows/instances/transition', { organizationId, ...input }),
}
