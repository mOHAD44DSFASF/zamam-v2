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
    <main dir="rtl" className="min-h-screen bg-gray-50 grid place-items-center p-5">
      <section className="w-full max-w-md bg-white border border-gray-200 p-7 text-right shadow-sm">
        <Mail className="text-teal-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-bold text-gray-950">استعادة كلمة المرور</h1>
        {submitted ? (
          <p role="status" className="mt-4 leading-7 text-gray-600">
            إذا كان الحساب موجوداً فستصل تعليمات الاستعادة إلى البريد المسجل.
          </p>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-semibold text-gray-800" htmlFor="reset-email">البريد الإلكتروني</label>
            <input id="reset-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-teal-600" />
            <button disabled={busy} className="w-full bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? 'جارٍ الإرسال...' : 'إرسال التعليمات'}</button>
          </form>
        )}
        <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-teal-800"><ArrowRight size={17} aria-hidden="true" /> العودة لتسجيل الدخول</Link>
      </section>
    </main>
  )
}
