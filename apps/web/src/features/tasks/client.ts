import { appCheckHeaders, auth } from '../../lib/firebase'

export interface TaskStep {
  id: string
  order: number
  name: string
  assigneeType: 'person' | 'department'
  assigneeUserId?: string
  assigneeDepartmentId?: string
  driveLink?: string
  dueAt?: string
  status: 'pending' | 'in_progress' | 'done' | 'sent_back'
  version: number
}
export interface TaskSummary {
  id: string
  projectId: string | null
  projectName: string
  workspaceName: string | null
  departmentId: string | null
  title: string
  description: string
  status: 'draft' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'approved' | 'completed' | 'cancelled' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueAt: string | null
  driveLink: string | null
  assigneeNames: readonly string[]
  clientVisible: boolean
  version: number
  currentStepOrder: number
  stepCount: number
  steps: readonly TaskStep[]
  subtaskCount: number
  completedSubtaskCount: number
  checklistCount: number
  completedChecklistCount: number
}
export interface TaskStepInputForm {
  name: string
  assigneeType: 'person' | 'department'
  assigneeUserId?: string
  assigneeDepartmentId?: string
  driveLink?: string
  dueAt?: string
}
export interface TaskSnapshot {
  tasks: readonly TaskSummary[]
  projects: readonly { id: string; name: string }[]
  workspaces: readonly { id: string; name: string; projectId?: string }[]
  departments: readonly { id: string; name: string }[]
  members: readonly { userId: string; displayName: string; whatsappPhone: string | null }[]
  capabilities: { create: boolean; update: boolean; transition: boolean; assign: boolean; reopen: boolean; archive: boolean; saveView: boolean }
}
export type TaskScope = 'self' | 'organization'
export interface TaskClient {
  load(organizationId: string, scope?: TaskScope): Promise<TaskSnapshot>
  create(organizationId: string, input: {
    projectId?: string; workspaceId?: string; departmentId?: string; title: string; description: string;
    priority: TaskSummary['priority']; dueAt?: string; driveLink?: string; clientVisible: boolean
    steps: readonly TaskStepInputForm[]
  }): Promise<void>
  update(organizationId: string, input: {
    taskId: string; expectedVersion: number; title: string; description: string;
    priority: TaskSummary['priority']; dueAt: string | null; clientVisible: boolean
  }): Promise<void>
  completeStep(organizationId: string, taskId: string, expectedVersion: number): Promise<void>
  sendBackStep(organizationId: string, input: { taskId: string; expectedVersion: number; targetStepOrder: number; reason: string }): Promise<void>
  setStepDueDate(organizationId: string, input: { taskId: string; stepOrder: number; expectedVersion: number; dueAt: string | null }): Promise<void>
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
  projects?: TaskSnapshot['projects']; workspaces?: TaskSnapshot['workspaces']
  departments?: TaskSnapshot['departments']; members?: TaskSnapshot['members']
  capabilities?: TaskSnapshot['capabilities']
}
export interface RawTaskStepRecord {
  id?: unknown; order?: unknown; name?: unknown; assigneeType?: unknown
  assigneeUserId?: unknown; assigneeDepartmentId?: unknown; driveLink?: unknown; dueAt?: unknown; status?: unknown; version?: unknown
}
export interface RawTaskRecord {
  id?: unknown; projectId?: unknown; departmentId?: unknown; title?: unknown; description?: unknown
  status?: unknown; priority?: unknown; dueAt?: unknown; driveLink?: unknown; clientVisible?: unknown; version?: unknown
  currentStepOrder?: unknown; stepCount?: unknown; steps?: readonly RawTaskStepRecord[]
}

function toStep(raw: RawTaskStepRecord): TaskStep {
  return {
    id: String(raw.id ?? ''), order: typeof raw.order === 'number' ? raw.order : 0,
    name: typeof raw.name === 'string' ? raw.name : '',
    assigneeType: raw.assigneeType === 'department' ? 'department' : 'person',
    ...(typeof raw.assigneeUserId === 'string' ? { assigneeUserId: raw.assigneeUserId } : {}),
    ...(typeof raw.assigneeDepartmentId === 'string' ? { assigneeDepartmentId: raw.assigneeDepartmentId } : {}),
    ...(typeof raw.driveLink === 'string' ? { driveLink: raw.driveLink } : {}),
    ...(typeof raw.dueAt === 'string' ? { dueAt: raw.dueAt } : {}),
    status: (typeof raw.status === 'string' ? raw.status : 'pending') as TaskStep['status'],
    version: typeof raw.version === 'number' ? raw.version : 1,
  }
}

/**
 * POST /v1/tasks/query (services/functions/src/task/query.ts) returns { items, nextCursor } — raw task
 * documents (with a resolved `steps` array from task_step) rather than a fully enriched TaskSnapshot.
 * assigneeNames/subtask/checklist counts are still degraded to safe placeholders until that composition
 * lands server-side; capabilities defaults to all-false (fail closed) since the endpoint carries no
 * permission information on its own beyond what evaluateCapabilities returns.
 */
export function toTaskSnapshot(response: RawTaskQueryResponse): TaskSnapshot {
  const tasks: TaskSummary[] = response.items.map((item) => ({
    id: String(item.id ?? ''),
    projectId: typeof item.projectId === 'string' ? item.projectId : null,
    projectName: typeof item.projectId === 'string' ? item.projectId : '',
    workspaceName: null,
    departmentId: typeof item.departmentId === 'string' ? item.departmentId : null,
    title: typeof item.title === 'string' ? item.title : '',
    description: typeof item.description === 'string' ? item.description : '',
    status: item.status as TaskSummary['status'],
    priority: item.priority as TaskSummary['priority'],
    dueAt: typeof item.dueAt === 'string' ? item.dueAt : null,
    driveLink: typeof item.driveLink === 'string' ? item.driveLink : null,
    assigneeNames: [],
    clientVisible: Boolean(item.clientVisible),
    version: typeof item.version === 'number' ? item.version : 1,
    currentStepOrder: typeof item.currentStepOrder === 'number' ? item.currentStepOrder : 0,
    stepCount: typeof item.stepCount === 'number' ? item.stepCount : (item.steps?.length ?? 0),
    steps: (item.steps ?? []).map(toStep),
    subtaskCount: 0, completedSubtaskCount: 0, checklistCount: 0, completedChecklistCount: 0,
  }))
  const projects = response.projects && response.projects.length > 0
    ? response.projects
    : [...new Map(tasks.filter((task) => task.projectId).map((task) => [task.projectId!, { id: task.projectId!, name: task.projectName }])).values()]
  return {
    tasks, projects, workspaces: response.workspaces ?? [], departments: response.departments ?? [], members: response.members ?? [],
    capabilities: response.capabilities ?? { create: false, update: false, transition: false, assign: false, reopen: false, archive: false, saveView: false },
  }
}

export const taskClient: TaskClient = {
  load: async (organizationId, scope) => toTaskSnapshot(await post('/v1/tasks/query', {
    organizationId, limit: 50, ...(scope ? { scope: { type: scope } } : {}),
  })),
  create: (organizationId, input) => post('/v1/tasks/create', { organizationId, id: crypto.randomUUID(), ...input }),
  update: (organizationId, input) => post('/v1/tasks/update', { organizationId, ...input }),
  completeStep: (organizationId, taskId, expectedVersion) => post('/v1/tasks/complete-step', { organizationId, taskId, expectedVersion }),
  sendBackStep: (organizationId, input) => post('/v1/tasks/send-back-step', { organizationId, ...input }),
  setStepDueDate: (organizationId, input) => post('/v1/tasks/steps/set-due-date', { organizationId, ...input }),
  saveView: (organizationId, input) => post('/v1/task-views/create', {
    organizationId, id: crypto.randomUUID(), resourceType: 'task',
    name: input.name, filters: { presentation: input.view }, visibility: 'private',
  }),
  transitionWorkflow: (organizationId, input) => post('/v1/workflows/instances/transition', { organizationId, ...input }),
}
