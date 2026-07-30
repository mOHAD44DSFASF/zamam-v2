import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { acceptInvitation } from '../auth/api'

export function InvitationAcceptance() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const validTokenShape = useMemo(() => /^[A-Za-z0-9_-]{32,512}$/.test(token), [token])
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validTokenShape) return setState('error')
    setState('busy')
    try {
      await acceptInvitation(token, password)
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 grid place-items-center p-5">
      <section className="w-full max-w-md bg-white border border-gray-200 p-7 text-right shadow-sm">
        <ShieldCheck className="text-teal-700" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-bold">قبول دعوة ZAMAM</h1>
        {state === 'done' ? <p role="status" className="mt-5 text-green-800">تم قبول الدعوة. يمكنك تسجيل الدخول الآن.</p> : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            <label htmlFor="invite-password" className="block text-sm font-semibold">كلمة مرور جديدة</label>
            <input id="invite-password" type="password" minLength={12} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full border border-gray-300 px-4 py-3 focus:ring-2 focus:ring-teal-600" />
            <button disabled={!validTokenShape || state === 'busy'} className="w-full bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">{state === 'busy' ? 'جارٍ التحقق...' : 'قبول الدعوة'}</button>
          </form>
        )}
        {(state === 'error' || !validTokenShape) && <p role="alert" className="mt-4 text-sm text-red-700">الدعوة غير صالحة أو منتهية. اطلب دعوة جديدة من مسؤول المؤسسة.</p>}
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-teal-800">تسجيل الدخول</Link>
      </section>
    </main>
  )
}
