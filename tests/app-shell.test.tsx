// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../apps/web/src/app/AppShell'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { TenantContext, type TenantContextValue } from '../apps/web/src/tenant/tenant-context'

afterEach(cleanup)

const ownerAuth: AuthContextValue = {
  status: 'active',
  session: { userId: 'owner-1', displayName: 'Zamam Owner', email: 'owner@zamam.local', accountStatus: 'active', memberships: [{ organizationId: 'org-demo', status: 'active' }] },
  refreshSession: vi.fn(),
  logout: vi.fn(),
}
const tenant: TenantContextValue = { organizationId: 'org-demo', availableOrganizationIds: ['org-demo'], selectOrganization: vi.fn() }

function renderShell(auth: AuthContextValue = ownerAuth, initialPath = '/tasks') {
  return render(
    <AuthContext.Provider value={auth}>
      <TenantContext.Provider value={tenant}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/tasks" element={<p>tasks page</p>} />
              <Route path="/team/employees" element={<p>team employees page</p>} />
              <Route path="/team/departments" element={<p>team departments page</p>} />
              <Route path="/time/attendance" element={<p>time attendance page</p>} />
              <Route path="/workload" element={<p>workload page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TenantContext.Provider>
    </AuthContext.Provider>,
  )
}

// Exactly 4 top-level destinations for daily use — everything else lives as in-page tabs under one of
// these (Team -> Employees/Departments, Time -> Attendance/Leave) or moved off the sidebar entirely
// (Notifications -> header bell, Settings -> profile menu). See app/TeamPage.tsx, app/TimePage.tsx.
const EXPECTED_LINKS: [string, string][] = [
  ['المهام', '/tasks'], ['الفريق', '/team/employees'], ['الوقت', '/time/attendance'], ['التقارير', '/workload'],
]

describe('AppShell navigation', () => {
  it('renders exactly 4 top-level nav destinations', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    for (const [label, href] of EXPECTED_LINKS) {
      const link = within(nav).getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', href)
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(EXPECTED_LINKS.length)
  })

  it('does not expose removed/merged items as separate sidebar destinations (Clients/Automation/AI/Files were removed earlier; Employees/Departments/Attendance/Leave/Notifications/Settings moved off the sidebar)', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    for (const label of ['العملاء', 'الأتمتة', 'مساعد ZAMAM', 'الملفات', 'الموظفين', 'الأقسام', 'الحضور والإجازات', 'الإشعارات', 'الإعدادات', 'المشاريع']) {
      expect(within(nav).queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
  })

  it('keeps "الفريق" highlighted across its /team/* sub-routes, and "الوقت" across /time/*', () => {
    renderShell(ownerAuth, '/team/departments')
    let active = screen.getByRole('link', { name: 'الفريق' })
    expect(active).toHaveAttribute('aria-current', 'page')

    cleanup()
    renderShell(ownerAuth, '/time/attendance')
    active = screen.getByRole('link', { name: 'الوقت' })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('marks the current top-level route active and renders page content in the shell', () => {
    renderShell(ownerAuth, '/tasks')
    expect(screen.getByText('tasks page')).toBeInTheDocument()
    const active = screen.getByRole('link', { name: 'المهام' })
    expect(active.className).toContain('bg-zamam-primary')
    const inactive = screen.getByRole('link', { name: 'الفريق' })
    expect(inactive.className).not.toContain('bg-zamam-primary')
  })

  it('lays out the shell right-to-left for Arabic', () => {
    const { container } = renderShell()
    expect(container.querySelector('div[dir="rtl"]')).not.toBeNull()
  })
})

describe('AppShell header: notification bell', () => {
  it('renders a bell button in the header (not a sidebar nav item)', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    expect(within(nav).queryByRole('link', { name: 'الإشعارات' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'الإشعارات' })).toBeInTheDocument()
  })

  it('opens a dropdown panel with a link to the full inbox, not a route change', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'الإشعارات' }))
    expect(screen.getByRole('link', { name: 'عرض الكل' })).toHaveAttribute('href', '/notifications')
    // Still on the same page — opening the bell did not navigate away.
    expect(screen.getByText('tasks page')).toBeInTheDocument()
  })
})

describe('AppShell header: profile menu (houses Settings)', () => {
  it('shows the logged-in user identity and a logout action inside the profile menu, not always-visible in the sidebar', () => {
    const auth = { ...ownerAuth, logout: vi.fn() }
    renderShell(auth)
    expect(screen.queryByText('owner@zamam.local')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'قائمة الحساب' }))
    expect(screen.getAllByText('Zamam Owner').length).toBeGreaterThan(0)
    expect(screen.getByText('owner@zamam.local')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /تسجيل الخروج/ }))
    expect(auth.logout).toHaveBeenCalled()
  })

  it('offers "الإعدادات" (organization administration) inside the profile menu, not as a sidebar tab', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'قائمة الحساب' }))
    expect(screen.getByRole('link', { name: 'الإعدادات' })).toHaveAttribute('href', '/admin/organization')
  })
})
