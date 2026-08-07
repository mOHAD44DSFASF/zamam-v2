import { LogOut } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { ForcePasswordChangeScreen } from './ForcePasswordChangeScreen'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') {
    return <main aria-busy="true" className="min-h-screen bg-gray-50 p-8" />
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (auth.status === 'must_change_password') {
    return <ForcePasswordChangeScreen />
  }
  if (auth.status !== 'active') {
    return (
      <main dir="rtl" className="min-h-screen bg-gray-50 grid place-items-center p-6">
        <section className="w-full max-w-md bg-white border border-gray-200 p-6 text-right shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">تعذر فتح مساحة العمل</h1>
          <p className="mt-3 text-sm leading-7 text-gray-600">
            الحساب غير نشط أو لا يملك عضوية مؤسسة فعالة. تواصل مع مسؤول المؤسسة.
          </p>
          <button type="button" onClick={auth.logout} className="mt-6 inline-flex items-center gap-2 text-red-700">
            <LogOut aria-hidden="true" size={18} /> تسجيل الخروج
          </button>
        </section>
      </main>
    )
  }
  return <Outlet />
}
