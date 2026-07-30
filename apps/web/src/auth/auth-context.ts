import { createContext, useContext } from 'react'
import type { AuthState } from './types'

export interface AuthContextValue extends AuthState {
  refreshSession: () => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
