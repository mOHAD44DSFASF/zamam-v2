// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { TaskManagementScreen } from '../apps/web/src/features/tasks/TaskManagementPage'
import type { TaskClient, TaskSnapshot } from '../apps/web/src/features/tasks/client'

afterEach(cleanup)

const ownerAuth: AuthContextValue = {
  status: 'active',
  session: { userId: 'user-2', displayName: 'أحمد', email: 'ahmed@zamam.local', accountStatus: 'active', memberships: [{ organizationId: 'org-1', status: 'active' }] },
  refreshSession: vi.fn(), logout: vi.fn(),
}

function snapshotWith(
  overrides: Partial<TaskSnapshot['tasks'][number]> = {},
  capabilityOverrides: Partial<TaskSnapshot['capabilities']> = {},
): TaskSnapshot {
  return {
    tasks: [{
      id: 'task-1', projectId: 'project-1', projectName: 'الموقع الجديد', workspaceName: 'مساحة التنفيذ', departmentId: null,
      title: 'كتابة الصفحة الرئيسية', description: 'وصف المهمة', status: 'in_progress', priority: 'high',
      dueAt: '2026-08-10T12:00:00.000Z', driveLink: null, assigneeNames: ['أحمد'], clientVisible: false, version: 4,
      currentStepOrder: 0, stepCount: 2,
      steps: [
        { id: 'task-1-step-0', order: 0, name: 'الكتابة', assigneeType: 'person', assigneeUserId: 'user-2', status: 'in_progress', version: 1 },
        { id: 'task-1-step-1', order: 1, name: 'المراجعة', assigneeType: 'person', assigneeUserId: 'user-3', status: 'pending', version: 1 },
      ],
      subtaskCount: 2, completedSubtaskCount: 1, checklistCount: 3, completedChecklistCount: 2,
      ...overrides,
    }],
    projects: [{ id: 'project-1', name: 'الموقع الجديد' }],
    workspaces: [{ id: 'workspace-1', name: 'مساحة التنفيذ', projectId: 'project-1' }],
    departments: [{ id: 'dep-1', name: 'المحتوى' }],
    members: [{ userId: 'user-2', displayName: 'أحمد' }, { userId: 'user-3', displayName: 'سارة' }],
    capabilities: { create: true, update: true, transition: true, assign: true, reopen: true, archive: true, saveView: true, ...capabilityOverrides },
  }
}
function client(snapshot: TaskSnapshot = snapshotWith()): TaskClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    completeStep: vi.fn().mockResolvedValue(undefined),
    sendBackStep: vi.fn().mockResolvedValue(undefined),
    saveView: vi.fn().mockResolvedValue(undefined),
    transitionWorkflow: vi.fn().mockResolvedValue(undefined),
  }
}
function renderScreen(client_: TaskClient, view?: 'board') {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={ownerAuth}>
        <TaskManagementScreen organizationId="org-1" client={client_} {...(view ? { view } : {})} />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('task management UI', () => {
  it('renders RTL task details, the step pipeline, and accessible sections', async () => {
    const view = renderScreen(client())
    expect(await screen.findByRole('heading', { name: 'المهام' })).toBeTruthy()
    expect(screen.getAllByText('كتابة الصفحة الرئيسية').length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: 'أقسام المهمة' })).toBeTruthy()
    expect(screen.getByText('مسار الخطوات (1/2)')).toBeTruthy()
    expect(screen.getByText('الكتابة')).toBeTruthy()
    expect(screen.getByText('المراجعة')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('offers a project-creation entry point in place of a separate Projects nav destination', async () => {
    renderScreen(client())
    await screen.findByRole('heading', { name: 'المهام' })
    expect(screen.getByRole('link', { name: /مشروع جديد/ })).toHaveAttribute('href', '/projects')
  })

  it('switches between "مهامي" and "كل المهام" as a filter within the page, not a route change', async () => {
    const api = client()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    expect(api.load).toHaveBeenCalledWith('org-1', undefined)
    const scopeGroup = screen.getByRole('group', { name: 'نطاق المهام' })
    fireEvent.click(within(scopeGroup).getByRole('button', { name: 'كل المهام' }))
    await waitFor(() => expect(api.load).toHaveBeenCalledWith('org-1', 'organization'))
    expect(screen.getByRole('heading', { name: 'المهام' })).toBeTruthy()
  })

  it('falls back to "مهامي" with an error message if the caller lacks permission to view all tasks', async () => {
    const api = client()
    api.load = vi.fn()
      .mockResolvedValueOnce(snapshotWith())
      .mockRejectedValueOnce(new Error('AUTHORIZATION_DENIED'))
      .mockResolvedValueOnce(snapshotWith())
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(within(screen.getByRole('group', { name: 'نطاق المهام' })).getByRole('button', { name: 'كل المهام' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ليست لديك صلاحية عرض كل المهام'))
    await waitFor(() => expect(api.load).toHaveBeenLastCalledWith('org-1', 'self'))
  })

  it('creates a task with a dynamic step (project is optional; steps are required)', async () => {
    const api = client()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'مهمة' }))
    fireEvent.change(screen.getByLabelText('العنوان'), { target: { value: 'مهمة جديدة' } })
    fireEvent.change(screen.getByLabelText(/المشروع/), { target: { value: 'project-1' } })
    fireEvent.change(screen.getByLabelText(/مساحة العمل/), { target: { value: 'workspace-1' } })
    fireEvent.change(screen.getByLabelText('اسم الخطوة'), { target: { value: 'الخطوة الأولى' } })
    fireEvent.change(screen.getByLabelText('الشخص'), { target: { value: 'user-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      projectId: 'project-1', workspaceId: 'workspace-1', title: 'مهمة جديدة', clientVisible: false,
      steps: [{ name: 'الخطوة الأولى', assigneeType: 'person', assigneeUserId: 'user-3' }],
    })))
  })

  it('adds a second, department-assigned step through the dynamic step builder', async () => {
    const api = client()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'مهمة' }))
    fireEvent.change(screen.getByLabelText('العنوان'), { target: { value: 'مهمة متعددة الخطوات' } })
    fireEvent.change(screen.getByLabelText('اسم الخطوة'), { target: { value: 'الصياغة' } })
    fireEvent.change(screen.getByLabelText('الشخص'), { target: { value: 'user-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'إضافة خطوة' }))
    const stepTwoName = screen.getAllByLabelText('اسم الخطوة')[1]!
    fireEvent.change(stepTwoName, { target: { value: 'مراجعة القسم' } })
    // Assignee-type is a segmented button toggle (شخص/قسم), not a <select> — click "قسم" within the
    // second step's own group (each step renders its own role="group" aria-label="نوع المُسند إليه").
    const stepTwoTypeGroup = screen.getAllByRole('group', { name: 'نوع المُسند إليه' })[1]!
    fireEvent.click(within(stepTwoTypeGroup).getByRole('button', { name: 'قسم' }))
    const stepTwoDepartment = screen.getAllByLabelText('القسم')[0]!
    fireEvent.change(stepTwoDepartment, { target: { value: 'dep-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      steps: [
        { name: 'الصياغة', assigneeType: 'person', assigneeUserId: 'user-2' },
        { name: 'مراجعة القسم', assigneeType: 'department', assigneeDepartmentId: 'dep-1' },
      ],
    })))
  })

  it('edits only mutable fields with the current concurrency version (steps are not editable after creation)', async () => {
    const api = client()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }))
    expect(screen.queryByText('خطوات المهمة *')).toBeNull()
    fireEvent.change(screen.getByLabelText('العنوان'), { target: { value: 'عنوان معدل' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
      taskId: 'task-1', expectedVersion: 4, title: 'عنوان معدل',
    })))
    expect(api.update).toHaveBeenCalledWith('org-1', expect.not.objectContaining({ projectId: expect.anything(), workspaceId: expect.anything() }))
  })

  it('renders board projection and saves it through an explicit command', async () => {
    const api = client()
    renderScreen(api, 'board')
    expect(await screen.findByRole('region', { name: 'لوحة المهام' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'حفظ العرض' }))
    await waitFor(() => expect(api.saveView).toHaveBeenCalledWith('org-1', { name: 'عرض board', view: 'board' }))
  })

  it("lets the current step's holder complete it (auto-advance is server-driven, the UI just calls the command)", async () => {
    const api = client()
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    // ownerAuth's session userId (user-2) matches step 0's assigneeUserId, so the action is offered.
    fireEvent.click(screen.getByRole('button', { name: 'إنهاء الخطوة الحالية' }))
    await waitFor(() => expect(api.completeStep).toHaveBeenCalledWith('org-1', 'task-1', 4))
  })

  it("offers the complete-step action to the step's assignee even when capabilities.transition is false (an ordinary Employee's task.transition grant is scoped to 'self', not organization-wide, so the flat capability flag is always false for them — eligibility must be judged per-step, not from that one boolean)", async () => {
    const api = client(snapshotWith({}, { transition: false }))
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    expect(screen.getByRole('button', { name: 'إنهاء الخطوة الحالية' })).toBeTruthy()
  })

  it('hides the complete-step/send-back actions from someone who is not the current step holder', async () => {
    const api = client(snapshotWith({
      steps: [
        { id: 'task-1-step-0', order: 0, name: 'الكتابة', assigneeType: 'person', assigneeUserId: 'user-3', status: 'in_progress', version: 1 },
        { id: 'task-1-step-1', order: 1, name: 'المراجعة', assigneeType: 'person', assigneeUserId: 'user-4', status: 'pending', version: 1 },
      ],
    }))
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    expect(screen.queryByRole('button', { name: 'إنهاء الخطوة الحالية' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'إرجاع إلى خطوة سابقة' })).toBeNull()
  })

  it('sends the current step back to an earlier step with a required reason', async () => {
    const api = client(snapshotWith({
      currentStepOrder: 1,
      steps: [
        { id: 'task-1-step-0', order: 0, name: 'الكتابة', assigneeType: 'person', assigneeUserId: 'user-3', status: 'done', version: 2 },
        { id: 'task-1-step-1', order: 1, name: 'المراجعة', assigneeType: 'person', assigneeUserId: 'user-2', status: 'in_progress', version: 1 },
      ],
    }))
    renderScreen(api)
    await screen.findByRole('heading', { name: 'المهام' })
    fireEvent.click(screen.getByRole('button', { name: 'إرجاع إلى خطوة سابقة' }))
    const dialog = screen.getByRole('dialog', { name: 'إرجاع إلى خطوة سابقة' })
    fireEvent.change(within(dialog).getByLabelText('السبب'), { target: { value: 'نقص في المحتوى الأساسي' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'إرجاع' }))
    await waitFor(() => expect(api.sendBackStep).toHaveBeenCalledWith('org-1', {
      taskId: 'task-1', expectedVersion: 4, targetStepOrder: 0, reason: 'نقص في المحتوى الأساسي',
    }))
  })
})
