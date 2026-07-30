import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth-context'

export function PublicOnlyRoute() {
  const auth = useAuth()
  if (auth.status === 'loading') return <main aria-busy="true" className="min-h-screen bg-gray-50" />
  if (auth.status === 'active') return <Navigate to="/workspace" replace />
  return <Outlet />
}
