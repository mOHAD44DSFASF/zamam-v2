import { describe, expect, it } from 'vitest'
import { toTaskSnapshot } from '../apps/web/src/features/tasks/client'

describe('toTaskSnapshot (Tasks API response adapter)', () => {
  // Regression: POST /v1/tasks/query returns { items, nextCursor } (services/functions/src/task/query.ts),
  // not the rich TaskSnapshot shape { tasks, projects, workspaces, capabilities } this screen expects — a
  // fresh organization with zero tasks crashed with "Cannot read properties of undefined (reading '0')"
  // at TaskManagementPage.tsx because `snapshot.tasks` didn't exist on the raw response at all.
  it('turns an empty result into a valid, empty TaskSnapshot instead of a shape mismatch', () => {
    expect(toTaskSnapshot({ items: [], nextCursor: null })).toEqual({
      tasks: [], projects: [], workspaces: [],
      capabilities: { create: false, update: false, transition: false, assign: false, reopen: false, archive: false, saveView: false },
    })
  })

  it('maps a non-empty result to task summaries without crashing on the fields the backend does not send yet', () => {
    const snapshot = toTaskSnapshot({
      items: [
        { id: 'task-1', projectId: 'project-1', title: 'Write the homepage', description: 'Draft copy', status: 'in_progress', priority: 'high', dueAt: '2026-08-10T12:00:00.000Z', clientVisible: false, version: 3 },
        { id: 'task-2', projectId: 'project-1', title: 'Review PR', description: '', status: 'ready', priority: 'medium', clientVisible: true, version: 1 },
      ],
      nextCursor: null,
    })
    expect(snapshot.tasks).toHaveLength(2)
    expect(snapshot.tasks[0]).toMatchObject({
      id: 'task-1', projectId: 'project-1', title: 'Write the homepage', status: 'in_progress', priority: 'high', version: 3,
      assigneeNames: [], subtaskCount: 0, completedSubtaskCount: 0, checklistCount: 0, completedChecklistCount: 0,
    })
    expect(snapshot.tasks[0].workflow).toBeUndefined()
    // Both tasks share project-1 — the derived project list must be deduplicated, not one entry per task.
    expect(snapshot.projects).toEqual([{ id: 'project-1', name: 'project-1' }])
    expect(snapshot.workspaces).toEqual([])
  })

  it('fails closed on capabilities: no permission info comes back from this endpoint, so nothing is offered', () => {
    const snapshot = toTaskSnapshot({ items: [{ id: 't-1', projectId: 'p-1', title: 'x', status: 'draft', priority: 'low', clientVisible: false, version: 1 }], nextCursor: null })
    expect(Object.values(snapshot.capabilities).every((value) => value === false)).toBe(true)
  })

  it('tolerates malformed/missing fields on a raw record rather than throwing', () => {
    expect(() => toTaskSnapshot({ items: [{}], nextCursor: null })).not.toThrow()
    const snapshot = toTaskSnapshot({ items: [{}], nextCursor: null })
    expect(snapshot.tasks[0]).toMatchObject({ id: '', projectId: '', title: '', description: '', dueAt: null })
  })
})
