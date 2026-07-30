// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { ProtectedRoute } from '../apps/web/src/auth/ProtectedRoute'

const baseContext: AuthContextValue = {
  status: 'anonymous',
  session: null,
  refreshSession: vi.fn(),
  logout: vi.fn(),
}

function renderRoute(value: AuthContextValue) {
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/workspace']}>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/workspace" element={<p>sensitive workspace data</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('ProtectedRoute', () => {
  it('never renders protected data for an anonymous session', () => {
    renderRoute(baseContext)
    expect(screen.getByText('login screen')).toBeInTheDocument()
    expect(screen.queryByText('sensitive workspace data')).not.toBeInTheDocument()
  })

  it('never renders protected data for an inactive account', () => {
    renderRoute({ ...baseContext, status: 'inactive', reason: 'ACCOUNT_INACTIVE' })
    expect(screen.getByText('تعذر فتح مساحة العمل')).toBeInTheDocument()
    expect(screen.queryByText('sensitive workspace data')).not.toBeInTheDocument()
  })

  it('renders protected data only for an active membership', () => {
    renderRoute({
      ...baseContext,
      status: 'active',
      session: {
        userId: 'user-1', displayName: 'User', email: 'user@example.com', accountStatus: 'active',
        memberships: [{ organizationId: 'org-1', status: 'active' }],
      },
    })
    expect(screen.getByText('sensitive workspace data')).toBeInTheDocument()
  })
})
