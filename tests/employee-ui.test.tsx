// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmployeeDirectoryScreen } from '../apps/web/src/features/employees/EmployeeDirectoryPage'
import type { EmployeeDirectoryClient, EmployeeDirectorySnapshot } from '../apps/web/src/features/employees/client'

afterEach(cleanup)

const snapshot: EmployeeDirectorySnapshot = {
  departments: [{ id: 'dep-1', name: 'المحتوى' }],
  items: [{
    userId: 'user-1', displayName: 'سارة أحمد', employeeNumber: 'EMP-1', jobTitle: 'كاتبة',
    departmentId: 'dep-1', departmentName: 'المحتوى', employmentType: 'employee', status: 'active',
  }],
  capabilities: { invite: true, update: true, disable: true, viewHr: false },
}

function client(value = snapshot): EmployeeDirectoryClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    invite: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
  }
}

describe('employee directory UI', () => {
  it('renders the sanitized Arabic directory with no axe violations', async () => {
    const view = render(<EmployeeDirectoryScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'دليل الموظفين' })).toBeTruthy()
    expect(screen.getByText('سارة أحمد')).toBeTruthy()
    expect(screen.queryByText(/@/)).toBeNull()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('invites with the default Employee role when the role picker is left untouched', async () => {
    const api = client()
    render(<EmployeeDirectoryScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'دليل الموظفين' })
    fireEvent.click(screen.getByRole('button', { name: 'دعوة موظف' }))
    expect(screen.getByLabelText('الدور')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'عمر خالد' } })
    fireEvent.change(screen.getByLabelText('الاسم الأول'), { target: { value: 'عمر' } })
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'omar@example.com' } })
    fireEvent.change(screen.getByLabelText('رقم الموظف'), { target: { value: 'EMP-2' } })
    fireEvent.change(screen.getByLabelText('المسمى الوظيفي'), { target: { value: 'مصمم' } })
    fireEvent.change(screen.getByLabelText('تاريخ البدء'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الدعوة' }))
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith('org-1', expect.objectContaining({
      email: 'omar@example.com', employeeNumber: 'EMP-2', primaryDepartmentId: 'dep-1', role: 'Employee',
    })))
  })

  it('invites a Department Lead when that role is explicitly chosen', async () => {
    const api = client()
    render(<EmployeeDirectoryScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'دليل الموظفين' })
    fireEvent.click(screen.getByRole('button', { name: 'دعوة موظف' }))
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'ليلى سعيد' } })
    fireEvent.change(screen.getByLabelText('الاسم الأول'), { target: { value: 'ليلى' } })
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'layla@example.com' } })
    fireEvent.change(screen.getByLabelText('رقم الموظف'), { target: { value: 'EMP-3' } })
    fireEvent.change(screen.getByLabelText('المسمى الوظيفي'), { target: { value: 'قائدة قسم' } })
    fireEvent.change(screen.getByLabelText('تاريخ البدء'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('الدور'), { target: { value: 'DepartmentLead' } })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال الدعوة' }))
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith('org-1', expect.objectContaining({
      email: 'layla@example.com', role: 'DepartmentLead',
    })))
  })

  it('requires a reason and confirmation before a sensitive disable command', async () => {
    const api = client()
    render(<EmployeeDirectoryScreen organizationId="org-1" client={api} />)
    await screen.findByText('سارة أحمد')
    fireEvent.click(screen.getByRole('button', { name: 'تعطيل' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('سبب التعطيل'), { target: { value: 'سبب إداري موثق للاختبار' } })
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التعطيل' }))
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith('org-1', 'user-1', 'سبب إداري موثق للاختبار'))
  })
})
