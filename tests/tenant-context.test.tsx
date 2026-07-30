// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { TenantProvider } from '../apps/web/src/tenant/TenantProvider'
import { useTenant } from '../apps/web/src/tenant/tenant-context'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

const auth: AuthContextValue = {
  status: 'active',
  session: {
    userId: 'user-1', displayName: 'User', email: null, accountStatus: 'active',
    memberships: [
      { organizationId: 'org-1', status: 'active' },
      { organizationId: 'org-2', status: 'active' },
    ],
  },
  refreshSession: vi.fn(),
  logout: vi.fn(),
}

function Consumer() {
  const tenant = useTenant()
  const [error, setError] = useState('')
  return <>
    <output>{tenant.organizationId}</output>
    <button onClick={() => tenant.selectOrganization('org-2')}>switch</button>
    <button onClick={() => {
      try { tenant.selectOrganization('org-unknown') } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'UNKNOWN')
      }
    }}>invalid</button>
    {error && <p role="alert">{error}</p>}
  </>
}

describe('trusted tenant context', () => {
  it('selects only an active membership and persists the tab selection', () => {
    render(<AuthContext.Provider value={auth}><TenantProvider><Consumer /></TenantProvider></AuthContext.Provider>)
    expect(screen.getByText('org-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    expect(screen.getByText('org-2')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('zamam.selectedOrganizationId')).toBe('org-2')
  })

  it('fails closed when selecting a tenant absent from the trusted session view', () => {
    render(<AuthContext.Provider value={auth}><TenantProvider><Consumer /></TenantProvider></AuthContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'invalid' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CROSS_ORGANIZATION_DENIED')
    expect(screen.getByText('org-1')).toBeInTheDocument()
  })
})
