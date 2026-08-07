import { LogOut } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth-context'
import { ForcePasswordChangeScreen } from './ForcePasswordChangeScreen'

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') {
    return <main aria-busy="true" className="min-h-screen bg-canvas p-8" />
  }
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (auth.status === 'must_change_password') {
    return <ForcePasswordChangeScreen />
  }
  if (auth.status !== 'active') {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas p-6">
        <section className="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-6 text-right shadow-float">
          <h1 className="text-h1 font-extrabold text-text-primary">تعذر فتح مساحة العمل</h1>
          <p className="mt-3 text-body leading-7 text-text-secondary">
            الحساب غير نشط أو لا يملك عضوية مؤسسة فعالة. تواصل مع مسؤول المؤسسة.
          </p>
          <button type="button" onClick={auth.logout} className="mt-6 inline-flex cursor-pointer items-center gap-2 text-body font-bold text-danger transition-colors hover:text-danger/80">
            <LogOut aria-hidden="true" size={18} /> تسجيل الخروج
          </button>
        </section>
      </main>
    )
  }
  return <Outlet />
}
