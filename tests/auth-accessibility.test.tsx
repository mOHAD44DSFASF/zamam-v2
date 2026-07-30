// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { InvitationAcceptance } from '../apps/web/src/pages/InvitationAcceptance'
import { Login } from '../apps/web/src/pages/Login'
import { PasswordReset } from '../apps/web/src/pages/PasswordReset'

afterEach(cleanup)

describe('authentication accessibility', () => {
  it.each([
    ['login', <Login />, '/login'],
    ['password reset', <PasswordReset />, '/password-reset'],
    ['invalid invitation', <InvitationAcceptance />, '/invitations/accept'],
  ])('has no axe violations on %s', async (_name, component, route) => {
    const { container } = render(<MemoryRouter initialEntries={[route]}>{component}</MemoryRouter>)
    const result = await axe(container)
    expect(result.violations).toEqual([])
  })
})
