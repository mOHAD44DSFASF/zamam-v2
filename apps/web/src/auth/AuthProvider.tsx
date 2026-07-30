import { onIdTokenChanged, signOut, type User } from 'firebase/auth'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth } from '../lib/firebase'
import { AuthContext } from './auth-context'
import { readSessionView } from './session-reader'
import type { AuthState } from './types'

async function resolveUser(user: User | null): Promise<AuthState> {
  if (!user) return { status: 'anonymous', session: null }
  const session = await readSessionView(user.uid)
  if (!session) return { status: 'inactive', session: null, reason: 'NO_ACTIVE_MEMBERSHIP' }
  if (session.accountStatus !== 'active') {
    return { status: 'inactive', session, reason: 'ACCOUNT_INACTIVE' }
  }
  if (!session.memberships.some(({ status }) => status === 'active')) {
    return { status: 'inactive', session, reason: 'NO_ACTIVE_MEMBERSHIP' }
  }
  return { status: 'active', session }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null })

  const refreshSession = useCallback(async () => {
    try {
      const next = await resolveUser(auth.currentUser)
      if (next.status === 'inactive' && next.reason === 'ACCOUNT_INACTIVE') await signOut(auth)
      setState(next)
    } catch {
      setState({ status: 'error', session: null, reason: 'SESSION_LOOKUP_FAILED' })
    }
  }, [])

  useEffect(() => onIdTokenChanged(auth, async (user) => {
    try {
      const next = await resolveUser(user)
      if (next.status === 'inactive' && next.reason === 'ACCOUNT_INACTIVE') await signOut(auth)
      setState(next)
    } catch {
      setState({ status: 'error', session: null, reason: 'SESSION_LOOKUP_FAILED' })
    }
  }), [])

  useEffect(() => {
    const interval = window.setInterval(refreshSession, 300_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSession()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshSession])

  const logout = useCallback(async () => {
    await signOut(auth)
    setState({ status: 'anonymous', session: null })
  }, [])

  const value = useMemo(() => ({ ...state, refreshSession, logout }), [state, refreshSession, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
