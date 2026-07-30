import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import type { AtomicStore, AtomicTransaction, PageQuery, StoredDocument } from '@zamam/firestore'
import {
  SavedTaskViewService, TaskQueryService, buildTaskViewQuery,
  type TaskQueryAuthorizationGate, type TaskQueryStore,
} from '../services/functions/src'

const principal: AuthorizationPrincipal = {
  userId: 'user-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
class Gate implements TaskQueryAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(_principal: AuthorizationPrincipal, request: AuthorizationRequest) { this.requests.push(request) }
}
class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    const working = new Map(this.records)
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => { if (working.has(path)) throw new Error('ALREADY_EXISTS'); working.set(path, data) },
      update: (path, data) => { working.set(path, { ...working.get(path), ...data }) },
    }
    const result = await operation(transaction); this.records = working; return result
  }
}

describe('task view query planning', () => {
  it('uses the assignment index for My Tasks and bounds every page', () => {
    expect(buildTaskViewQuery({ organizationId: 'org-1', scope: { type: 'self', userId: 'user-1' } })).toMatchObject({
      entityKind: 'task_assignment', limit: 50,
      filters: [{ field: 'userId', value: 'user-1' }, { field: 'status', value: 'accepted' }],
    })
    expect(() => buildTaskViewQuery({ organizationId: 'org-1', scope: { type: 'organization' }, limit: 51 }))
      .toThrow('UNBOUNDED_QUERY_DENIED')
  })

  it('rejects a filter that attempts to broaden or switch project scope', () => {
    expect(() => buildTaskViewQuery({
      organizationId: 'org-1', scope: { type: 'project', projectId: 'project-1' },
      filters: { projectId: 'project-2' },
    })).toThrow('FILTER_SCOPE_ESCALATION')
  })

  it('keeps status, priority, workspace and due filters in the server query', () => {
    const query = buildTaskViewQuery({
      organizationId: 'org-1', scope: { type: 'organization' },
      filters: { statuses: ['ready'], priorities: ['urgent'], workspaceId: 'workspace-1', dueBefore: '2026-08-01T00:00:00.000Z' },
    })
    expect(query.filters).toEqual(expect.arrayContaining([
      { field: 'status', operator: 'in', value: ['ready'] },
      { field: 'priority', operator: 'in', value: ['urgent'] },
      { field: 'workspaceId', operator: '==', value: 'workspace-1' },
    ]))
  })

  it('resolves task assignments to a bounded task batch after authorization', async () => {
    const queries: PageQuery[] = []
    const store: TaskQueryStore = {
      list: async (query) => { queries.push(query); return { items: [{ taskId: 'task-1' }, { taskId: 'task-1' }], nextCursor: null } },
      getTasksByIds: vi.fn().mockResolvedValue([{ id: 'task-1', organizationId: 'org-1' }]),
    }
    const gate = new Gate()
    const service = new TaskQueryService(store, gate, { searchTaskIds: vi.fn() })
    const page = await service.list(principal, { organizationId: 'org-1', scope: { type: 'self', userId: 'user-1' } })
    expect(page.items).toHaveLength(1)
    expect(store.getTasksByIds).toHaveBeenCalledWith('org-1', ['task-1'])
    expect(gate.requests[0]).toMatchObject({ permission: 'task.view', organizationId: 'org-1' })
    expect(queries[0]?.limit).toBe(50)
  })

  it('bounds search results and passes only server-resolved project scopes', async () => {
    const searchTaskIds = vi.fn().mockResolvedValue(['task-1'])
    const getTasksByIds = vi.fn().mockResolvedValue([{ id: 'task-1' }])
    const service = new TaskQueryService({ list: vi.fn(), getTasksByIds }, new Gate(), { searchTaskIds })
    await service.searchTasks(principal, {
      organizationId: 'org-1', query: 'تصميم', permittedProjectIds: ['project-1'], limit: 10,
    })
    expect(searchTaskIds).toHaveBeenCalledWith({
      organizationId: 'org-1', query: 'تصميم', permittedProjectIds: ['project-1'], limit: 10,
    })
    await expect(service.searchTasks(principal, { organizationId: 'org-1', query: 'x', limit: 10 }))
      .rejects.toThrow('INVALID_SEARCH_QUERY')
  })
})

describe('saved task views', () => {
  it('validates filters and audits private saved views', async () => {
    const store = new MemoryStore()
    const service = new SavedTaskViewService(store, new Gate())
    await service.create({
      organizationId: 'org-1', principal, correlationId: 'correlation-1',
      idempotencyKey: 'idempotency-1', fingerprint: 'fingerprint-1',
    }, {
      id: 'view-1', name: 'المهام العاجلة', resourceType: 'task',
      filters: { priorities: ['urgent'], presentation: 'board' }, visibility: 'private',
    })
    expect(store.records.get('v2Organizations/org-1/saved_view/view-1')).toMatchObject({
      ownerUserId: 'user-1', visibility: 'private', resourceType: 'task',
    })
    expect([...store.records.keys()].some((path) => path.includes('/_auditEvents/'))).toBe(true)
  })
})

