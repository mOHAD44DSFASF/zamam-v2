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
              <Route path="/projects" element={<p>projects page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TenantContext.Provider>
    </AuthContext.Provider>,
  )
}

// Every internal destination that must be discoverable from the persistent navigation. This is an
// internal-only team tool — Clients, Client Portal, Automation, AI, and Files are intentionally absent
// (their routes still exist and redirect to /tasks, but they are not nav destinations). Files' role —
// attaching evidence to a task/step — is covered by the plain Drive-link field on tasks/steps instead.
const EXPECTED_LINKS: [string, string][] = [
  ['المهام', '/tasks'], ['المشاريع', '/projects'], ['مساحات العمل', '/workspaces'],
  ['القوالب والعمل المتكرر', '/templates'], ['المراجعات والموافقات', '/approvals'],
  ['الموظفين', '/people'], ['الأقسام', '/admin/organization'],
  ['الحضور والإجازات', '/attendance'], ['كشوف الساعات', '/time'],
  ['التقارير', '/reports'], ['عبء العمل', '/workload'],
  ['إدارة المؤسسة', '/admin/organization'], ['الإشعارات', '/notifications'],
  ['الإدارة', '/admin'],
]

describe('AppShell navigation', () => {
  it('renders the persistent RTL navigation with every internal route for an Owner', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    for (const [label, href] of EXPECTED_LINKS) {
      const link = within(nav).getByRole('link', { name: label })
      expect(link).toHaveAttribute('href', href)
    }
    // Every internal route is discoverable (no page reachable only by typing a URL).
    expect(within(nav).getAllByRole('link')).toHaveLength(EXPECTED_LINKS.length)
  })

  it('does not expose Clients, Automation, AI Assistant, or Files — this is an internal-only tool', () => {
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' })
    expect(within(nav).queryByRole('link', { name: 'العملاء' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'الأتمتة' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'مساعد ZAMAM' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'الملفات' })).not.toBeInTheDocument()
  })

  it('shows the logged-in user, organization, and a logout action', () => {
    const auth = { ...ownerAuth, logout: vi.fn() }
    renderShell(auth)
    expect(screen.getByText('Zamam Owner')).toBeInTheDocument()
    expect(screen.getByText('owner@zamam.local')).toBeInTheDocument()
    expect(screen.getAllByText('org-demo').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /تسجيل الخروج/ }))
    expect(auth.logout).toHaveBeenCalled()
  })

  it('marks the current route as active and renders page content in the shell', () => {
    renderShell(ownerAuth, '/projects')
    expect(screen.getByText('projects page')).toBeInTheDocument()
    const active = screen.getByRole('link', { name: 'المشاريع' })
    expect(active.className).toContain('bg-zamam-primary')
    const inactive = screen.getByRole('link', { name: 'المهام' })
    expect(inactive.className).not.toContain('bg-zamam-primary')
  })

  it('lays out the shell right-to-left for Arabic', () => {
    const { container } = renderShell()
    expect(container.querySelector('div[dir="rtl"]')).not.toBeNull()
  })
})
