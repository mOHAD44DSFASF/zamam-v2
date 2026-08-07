import { signInWithEmailAndPassword } from 'firebase/auth'
import { KeyRound, LogOut } from 'lucide-react'
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
    <main dir="rtl" className="min-h-screen min-h-[100dvh] bg-canvas grid place-items-center p-6">
      <section className="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-8 text-right shadow-float">
        <div className="mb-6 flex justify-center">
          <span className="grid size-12 place-items-center rounded-full bg-brand-subtle text-brand-300">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>
        </div>

        <h1 className="text-h1 font-extrabold text-text-primary text-center">يلزم تعيين كلمة مرور جديدة</h1>
        <p className="mt-3 text-body leading-7 text-text-secondary text-center">
          تم إنشاء حسابك بكلمة مرور مؤقتة. لمتابعة استخدام النظام، يرجى تعيين كلمة مرور جديدة الآن.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <div className="space-y-2">
            <label htmlFor="force-password-new" className="block text-label font-semibold text-text-secondary mr-1">
              كلمة المرور الجديدة
            </label>
            <input
              id="force-password-new"
              type="password" required minLength={12} value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-border-strong bg-canvas p-3 text-body text-text-primary transition-colors focus:border-brand-400 placeholder:text-text-tertiary"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="force-password-confirm" className="block text-label font-semibold text-text-secondary mr-1">
              تأكيد كلمة المرور
            </label>
            <input
              id="force-password-confirm"
              type="password" required minLength={12} value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full rounded-md border border-border-strong bg-canvas p-3 text-body text-text-primary transition-colors focus:border-brand-400 placeholder:text-text-tertiary"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body font-semibold text-danger">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={submitting}
            className="w-full rounded-md bg-brand-500 px-4 py-3 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] active:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 cursor-pointer"
          >
            {submitting ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
          </button>
        </form>

        <button
          type="button" onClick={() => void logout()}
          className="mt-6 inline-flex items-center gap-2 rounded-sm text-label font-semibold text-danger transition-colors hover:text-danger/80 cursor-pointer"
        >
          <LogOut aria-hidden="true" size={16} /> تسجيل الخروج
        </button>
      </section>
    </main>
  )
}
