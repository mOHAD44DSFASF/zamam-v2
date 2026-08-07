import { ArrowRight, Mail } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../auth/api'

export function PasswordReset() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await requestPasswordReset(email)
    } catch {
      // The public response intentionally does not reveal whether an account exists.
    } finally {
      setSubmitted(true)
      setBusy(false)
    }
  }

  return (
    <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="w-full max-w-md rounded-lg border border-border-subtle bg-surface p-7 text-right shadow-float">
        <span className="grid size-11 place-items-center rounded-full bg-brand-subtle text-brand-300"><Mail className="size-5" aria-hidden="true" /></span>
        <h1 className="mt-4 text-h1 font-extrabold text-text-primary">استعادة كلمة المرور</h1>
        {submitted ? (
          <p role="status" className="mt-4 leading-7 text-body text-text-secondary">
            إذا كان الحساب موجوداً فستصل تعليمات الاستعادة إلى البريد المسجل.
          </p>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={submit}>
            <label className="block text-label font-semibold text-text-secondary" htmlFor="reset-email">البريد الإلكتروني</label>
            <input id="reset-email" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-md border border-border-strong bg-canvas px-4 py-3 text-left text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400" />
            <button disabled={busy} className="w-full cursor-pointer rounded-md bg-brand-500 px-4 py-3 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'جارٍ الإرسال...' : 'إرسال التعليمات'}</button>
          </form>
        )}
        <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-label font-semibold text-brand-300 hover:text-brand-400"><ArrowRight size={17} aria-hidden="true" /> العودة لتسجيل الدخول</Link>
      </section>
    </main>
  )
}
