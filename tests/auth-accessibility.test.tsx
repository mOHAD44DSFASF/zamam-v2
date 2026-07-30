// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { InvitationAcceptance } from '../apps/web/src/pages/InvitationAcceptance'
import { Login } from '../apps/web/src/pages/Login'
import { PasswordReset } from '../apps/web/src/pages/PasswordReset'

afterEach(cleanup)

const anonymousAuth: AuthContextValue = {
  status: 'anonymous', session: null, refreshSession: vi.fn(), logout: vi.fn(),
}

describe('authentication accessibility', () => {
  it.each([
    ['login', <Login />, '/login'],
    ['password reset', <PasswordReset />, '/password-reset'],
    ['invalid invitation', <InvitationAcceptance />, '/invitations/accept'],
  ])('has no axe violations on %s', async (_name, component, route) => {
    const { container } = render(
      <AuthContext.Provider value={anonymousAuth}>
        <MemoryRouter initialEntries={[route]}>{component}</MemoryRouter>
      </AuthContext.Provider>,
    )
    const result = await axe(container)
    expect(result.violations).toEqual([])
  })
})
