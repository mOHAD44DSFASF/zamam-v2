import { signInWithEmailAndPassword } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { employeeDirectoryClient } from '../features/employees/client'
import { auth } from '../lib/firebase'
import { useTenant } from '../tenant/tenant-context'
import { useAuth } from './auth-context'

/**
 * Rendered inline by ProtectedRoute (see ProtectedRoute.tsx) when auth.status === 'must_change_password' —
 * same "block the whole app with an inline screen, not a redirect" idiom the existing inactive-account
 * screen uses. Blocks every other route until the member picks a new password, then calls
 * refreshSession() so AuthProvider re-reads sessionViews and clears the gate.
 */
export function ForcePasswordChangeScreen() {
  const { session, logout, refreshSession } = useAuth()
  const { organizationId } = useTenant()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password.length < 12) { setError('كلمة المرور يجب ألا تقل عن 12 حرفًا.'); return }
    if (password !== confirm) { setError('كلمتا المرور غير متطابقتين.'); return }
    if (!organizationId || !session?.email) { setError('تعذر تحديد المؤسسة الحالية.'); return }
    setSubmitting(true)
    try {
      await employeeDirectoryClient.changeOwnPassword(organizationId, password)
      // Changing a Firebase Auth user's password invalidates every ID/refresh token issued before the
      // change (same behavior as real Firebase Auth's tokensValidAfterTime) — a forced getIdToken(true)
      // isn't enough because the refresh token itself is invalid too. Re-authenticate with the new
      // password to get a fully fresh session, otherwise every API call 401s until the user reloads.
      await signInWithEmailAndPassword(auth, session.email, password)
      await refreshSession()
    } catch {
      setError('تعذر تحديث كلمة المرور. حاول مرة أخرى.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 grid place-items-center p-6">
      <section className="w-full max-w-md bg-white border border-gray-200 p-6 text-right shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">يلزم تعيين كلمة مرور جديدة</h1>
        <p className="mt-3 text-sm leading-7 text-gray-600">
          تم إنشاء حسابك بكلمة مرور مؤقتة. لمتابعة استخدام النظام، يرجى تعيين كلمة مرور جديدة الآن.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-gray-700">
            كلمة المرور الجديدة
            <input
              type="password" required minLength={12} value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 p-2.5"
            />
          </label>
          <label className="block text-sm font-bold text-gray-700">
            تأكيد كلمة المرور
            <input
              type="password" required minLength={12} value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 p-2.5"
            />
          </label>
          {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
          <button
            type="submit" disabled={submitting}
            className="w-full rounded-md bg-zamam-primary px-4 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {submitting ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
          </button>
        </form>
        <button type="button" onClick={() => void logout()} className="mt-6 inline-flex items-center gap-2 text-red-700">
          <LogOut aria-hidden="true" size={18} /> تسجيل الخروج
        </button>
      </section>
    </main>
  )
}
