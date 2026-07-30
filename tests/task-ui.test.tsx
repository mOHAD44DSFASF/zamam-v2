// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskManagementScreen } from '../apps/web/src/features/tasks/TaskManagementPage'
import type { TaskClient, TaskSnapshot } from '../apps/web/src/features/tasks/client'

afterEach(cleanup)

const snapshot: TaskSnapshot = {
  tasks: [{
    id: 'task-1', projectId: 'project-1', projectName: 'الموقع الجديد', workspaceName: 'مساحة التنفيذ',
    title: 'كتابة الصفحة الرئيسية', description: 'وصف المهمة', status: 'in_progress', priority: 'high',
    dueAt: '2026-08-10T12:00:00.000Z', assigneeNames: ['أحمد'], clientVisible: false, version: 4,
    subtaskCount: 2, completedSubtaskCount: 1, checklistCount: 3, completedChecklistCount: 2,
    workflow: {
      instanceId: 'instance-1', workflowVersionId: 'workflow-v1', currentStageKey: 'write',
      currentStageName: 'الكتابة', concurrencyVersion: 2, stageDueAt: null,
      availableTransitions: [{ key: 'submit', label: 'إرسال', toStageName: 'المراجعة' }],
    },
  }],
  projects: [{ id: 'project-1', name: 'الموقع الجديد' }],
  workspaces: [{ id: 'workspace-1', name: 'مساحة التنفيذ', projectId: 'project-1' }],
  capabilities: { create: true, update: true, transition: true, assign: true, reopen: true, archive: true, saveView: true },
}
function client(): TaskClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    saveView: vi.fn().mockResolvedValue(undefined),
    transitionWorkflow: vi.fn().mockResolvedValue(undefined),
  }
}

describe('task management UI', () => {
  it('renders RTL task details and accessible sections', async () => {
    const view = render(<TaskManagementScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'المهام' })).toBeTruthy()
    expect(screen.getAllByText('كتابة الصفحة الرئيسية').length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: 'أقسام المهمة' })).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('creates a task with project/workspace scope through the API client', async () => {
    const api = client()
    render(<TaskManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'مهمة' }))
    fireEvent.change(screen.getByLabelText('العنوان'), { target: { value: 'مهمة جديدة' } })
    fireEvent.change(screen.getByLabelText('مساحة العمل'), { target: { value: 'workspace-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      projectId: 'project-1', workspaceId: 'workspace-1', title: 'مهمة جديدة', clientVisible: false,
    })))
  })

  it('edits only mutable fields with the current concurrency version', async () => {
    const api = client()
    render(<TaskManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }))
    fireEvent.change(screen.getByLabelText('العنوان'), { target: { value: 'عنوان معدل' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
      taskId: 'task-1', expectedVersion: 4, title: 'عنوان معدل',
    })))
    expect(api.update).toHaveBeenCalledWith('org-1', expect.not.objectContaining({ projectId: expect.anything(), workspaceId: expect.anything() }))
  })

  it('renders board projection and saves it through an explicit command', async () => {
    const api = client()
    render(<TaskManagementScreen organizationId="org-1" client={api} view="board" />)
    expect(await screen.findByRole('region', { name: 'لوحة المهام' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'حفظ العرض' }))
    await waitFor(() => expect(api.saveView).toHaveBeenCalledWith('org-1', { name: 'عرض board', view: 'board' }))
  })

  it('uses the pinned workflow concurrency version for a transition command', async () => {
    const api = client()
    render(<TaskManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال إلى المراجعة' }))
    await waitFor(() => expect(api.transitionWorkflow).toHaveBeenCalledWith('org-1', {
      instanceId: 'instance-1', transitionKey: 'submit', expectedConcurrencyVersion: 2,
    }))
  })
})
