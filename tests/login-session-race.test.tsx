// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../apps/web/src/auth/auth-context'
import { Login } from '../apps/web/src/pages/Login'

vi.mock('../apps/web/src/lib/firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({
  browserLocalPersistence: 'local',
  browserSessionPersistence: 'session',
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({ user: { uid: 'owner-1' } }),
}))

const { setPersistence, signInWithEmailAndPassword } = await import('firebase/auth')

afterEach(() => { cleanup(); vi.clearAllMocks() })

function renderLogin(refreshSession: () => Promise<void>) {
  const authValue: AuthContextValue = { status: 'anonymous', session: null, refreshSession, logout: vi.fn() }
  render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/workspace" element={<p>workspace stub</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function submitLoginForm() {
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'owner@zamam.local' } })
  fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'Owner-Password-12345' } })
  fireEvent.click(screen.getByRole('button', { name: /تسجيل الدخول/ }))
}

describe('Login session race (double-prompt regression)', () => {
  // Reproduces the bug reported after commit 5b1ca23: Login navigated to the protected route
  // immediately once signInWithEmailAndPassword() resolved, without waiting for AuthProvider's
  // asynchronous session resolution (which reads sessionViews/{uid}) to update auth.status away from
  // the stale 'anonymous' it still held from before sign-in. ProtectedRoute then saw 'anonymous' and
  // bounced straight back to /login, which read as the page silently reprompting for credentials.
  it('does not navigate to the protected route until refreshSession() has resolved', async () => {
    let resolveRefresh: () => void = () => {}
    const refreshSession = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    renderLogin(refreshSession)

    await submitLoginForm()

    await waitFor(() => expect(signInWithEmailAndPassword).toHaveBeenCalled())
    await waitFor(() => expect(refreshSession).toHaveBeenCalled())
    // Sign-in succeeded but the session hasn't resolved yet — navigation must still be pending.
    expect(screen.queryByText('workspace stub')).not.toBeInTheDocument()
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeInTheDocument()

    resolveRefresh()
    await waitFor(() => expect(screen.getByText('workspace stub')).toBeInTheDocument())
  })

  it('navigates once refreshSession() resolves immediately (no artificial delay)', async () => {
    const refreshSession = vi.fn().mockResolvedValue(undefined)
    renderLogin(refreshSession)
    await submitLoginForm()
    await waitFor(() => expect(screen.getByText('workspace stub')).toBeInTheDocument())
    expect(setPersistence).toHaveBeenCalled()
    expect(refreshSession).toHaveBeenCalled()
  })
})
