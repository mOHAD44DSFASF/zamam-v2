// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceManagementScreen } from '../apps/web/src/features/workspaces/WorkspaceManagementPage'
import type { WorkspaceClient, WorkspaceSnapshot } from '../apps/web/src/features/workspaces/client'

afterEach(cleanup)

const snapshot: WorkspaceSnapshot = {
  workspaces: [{
    id: 'workspace-1', name: 'مساحة المحتوى', status: 'active', visibility: 'project',
    projectName: 'الموقع الجديد', teamName: null, activeMemberCount: 4, openTaskCount: 7, version: 1,
  }],
  projects: [{ id: 'project-1', name: 'الموقع الجديد', departmentId: 'dep-1' }],
  teams: [{ id: 'team-1', name: 'فريق المحتوى', departmentId: 'dep-1' }],
  capabilities: { create: true, manageMembers: true, archive: true },
}
function client(): WorkspaceClient {
  return { load: vi.fn().mockResolvedValue(snapshot), create: vi.fn().mockResolvedValue(undefined) }
}

describe('workspace management UI', () => {
  it('renders a scoped RTL list with no axe violations', async () => {
    const view = render(<WorkspaceManagementScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'مساحات العمل' })).toBeTruthy()
    expect(screen.getByText('مساحة المحتوى')).toBeTruthy()
    expect(screen.getByText(/الظهور في القائمة لا يمنح صلاحية/)).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('derives department scope from the selected team', async () => {
    const api = client()
    render(<WorkspaceManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'مساحات العمل' })
    fireEvent.click(screen.getByRole('button', { name: 'مساحة' }))
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'مساحة فريق' } })
    fireEvent.change(screen.getByLabelText('نطاق الرؤية'), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText('الفريق'), { target: { value: 'team-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', {
      name: 'مساحة فريق', visibility: 'team', ownerTeamId: 'team-1', departmentId: 'dep-1',
    }))
  })
})

