// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectManagementScreen } from '../apps/web/src/features/projects/ProjectManagementPage'
import type { ProjectManagementClient, ProjectManagementSnapshot } from '../apps/web/src/features/projects/client'

afterEach(cleanup)

const snapshot: ProjectManagementSnapshot = {
  projects: [{
    id: 'project-1', clientId: 'client-1', clientName: 'شركة العميل', name: 'الموقع الجديد',
    code: 'WEB-1', status: 'active', managerName: 'مدير المشروع', departmentName: 'التطوير',
    startsOn: '2026-08-01', dueOn: '2026-10-01', clientVisible: false,
    activeMemberCount: 4, openTaskCount: 12, version: 3,
  }],
  clients: [{ id: 'client-1', name: 'شركة العميل' }],
  departments: [{ id: 'dep-1', name: 'التطوير' }],
  managers: [{ userId: 'manager-1', displayName: 'مدير المشروع' }],
  capabilities: {
    create: true, manage: true, manageMembers: true, archive: true,
    viewFinancial: false, manageFinancial: false,
  },
}

function client(): ProjectManagementClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
    setClientVisibility: vi.fn().mockResolvedValue(undefined),
  }
}

describe('project management UI', () => {
  it('renders RTL list/detail with a financial permission state and no axe violations', async () => {
    const view = render(<ProjectManagementScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'المشاريع' })).toBeTruthy()
    expect(screen.getAllByText('الموقع الجديد').length).toBeGreaterThan(0)
    expect(screen.getByText('البيانات المالية غير متاحة ضمن صلاحياتك.')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('publishes client visibility only through an explicit command', async () => {
    const api = client()
    render(<ProjectManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المشاريع' })
    fireEvent.click(screen.getByRole('button', { name: 'نشر للعميل' }))
    await waitFor(() => expect(api.setClientVisibility).toHaveBeenCalledWith('org-1', 'project-1', 3, true))
  })

  it('submits a validated project without financial fields', async () => {
    const api = client()
    render(<ProjectManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المشاريع' })
    fireEvent.click(screen.getByRole('button', { name: /مشروع/ }))
    fireEvent.change(screen.getByLabelText('اسم المشروع'), { target: { value: 'حملة جديدة' } })
    fireEvent.change(screen.getByLabelText('الرمز'), { target: { value: 'CMP-1' } })
    fireEvent.change(screen.getByLabelText('تاريخ البدء'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('موعد التسليم'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      clientId: 'client-1', name: 'حملة جديدة', code: 'CMP-1', managerUserId: 'manager-1',
    })))
    expect(api.create).toHaveBeenCalledWith('org-1', expect.not.objectContaining({ budgetMinor: expect.anything() }))
  })
})
