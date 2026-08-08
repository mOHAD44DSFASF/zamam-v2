// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OrganizationDirectoryScreen,
} from '../apps/web/src/features/organization/OrganizationAdminPage'
import type {
  OrganizationDirectoryClient,
  OrganizationDirectorySnapshot,
} from '../apps/web/src/features/organization/client'

afterEach(cleanup)

const snapshot: OrganizationDirectorySnapshot = {
  organization: { id: 'org-1', name: 'وكالة زمام', locale: 'ar', timezone: 'Africa/Cairo' },
  departments: [{
    id: 'dep-content', name: 'المحتوى', code: 'CONTENT', managerName: 'مدير المحتوى', activeTeamCount: 1,
  }],
  teams: [{
    id: 'team-seo', departmentId: 'dep-content', name: 'تحسين البحث', code: 'SEO', leaderName: null, activeMemberCount: 3,
  }],
  capabilities: {
    createDepartment: true,
    createTeam: true,
    manageMembership: true,
    archiveStructure: true,
  },
}

function client(value = snapshot): OrganizationDirectoryClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    createDepartment: vi.fn().mockResolvedValue(undefined),
    createTeam: vi.fn().mockResolvedValue(undefined),
  }
}

describe('organization administration UI', () => {
  it('renders the server-projected hierarchy in RTL without axe violations', async () => {
    const view = render(<OrganizationDirectoryScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'وكالة زمام' })).toBeTruthy()
    expect(screen.getByText('تحسين البحث')).toBeTruthy()
    expect(view.container.querySelector('main')?.getAttribute('dir')).toBe('rtl')
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('shows an honest empty state and hides commands not granted by server capabilities', async () => {
    const restricted: OrganizationDirectorySnapshot = {
      ...snapshot,
      departments: [],
      teams: [],
      capabilities: {
        createDepartment: false,
        createTeam: false,
        manageMembership: false,
        archiveStructure: false,
      },
    }
    render(<OrganizationDirectoryScreen organizationId="org-1" client={client(restricted)} />)
    expect(await screen.findByRole('heading', { name: 'لا توجد أقسام بعد' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'قسم' })).toBeNull()
  })

  it('submits a department command through the injected trusted-backend client and reloads', async () => {
    const api = client()
    render(<OrganizationDirectoryScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'وكالة زمام' })
    fireEvent.click(screen.getByRole('button', { name: 'قسم' }))
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'الإنتاج' } })
    fireEvent.change(screen.getByLabelText('الرمز'), { target: { value: 'PRODUCTION' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.createDepartment).toHaveBeenCalledWith('org-1', {
      name: 'الإنتاج', code: 'PRODUCTION',
    }))
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2))
  })
})
