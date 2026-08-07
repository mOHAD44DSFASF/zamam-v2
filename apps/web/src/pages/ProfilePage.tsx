import { useState } from 'react'
import { employeeDirectoryClient } from '../features/employees/client'
import { useAuth } from '../auth/auth-context'
import { useTenant } from '../tenant/tenant-context'

/**
 * Minimal self-service profile page — Area 1 needs somewhere to collect/edit whatsappPhone (required for
 * every member per the direct-creation form, but also for pre-existing accounts like owner@zamam.local
 * that predate the field; see DashboardPage's whatsapp-completion banner, which links here). Nothing else
 * on the profile is editable yet — displayName/email come from sessionViews and are shown read-only.
 */
export function ProfilePage() {
  const { session, refreshSession } = useAuth()
  const { organizationId } = useTenant()
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  if (!session || !organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد جلسة نشطة.</main>

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus('saving')
    try {
      await employeeDirectoryClient.updateOwnWhatsappPhone(organizationId, whatsappPhone)
      await refreshSession()
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 px-5 py-10">
      <div className="mx-auto max-w-lg bg-white border border-gray-200 p-6 shadow-sm">
        <h1 className="text-xl font-black text-gray-900">الملف الشخصي</h1>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">الاسم</dt><dd className="font-bold">{session.displayName}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">البريد الإلكتروني</dt><dd className="font-bold">{session.email}</dd></div>
        </dl>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-sm font-bold text-gray-700">
            رقم واتساب (مع رمز الدولة)
            <input
              type="tel" required placeholder="+9665xxxxxxxx" value={whatsappPhone}
              onChange={(event) => setWhatsappPhone(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 p-2.5"
            />
          </label>
          {status === 'error' && <p role="alert" className="text-sm font-bold text-red-700">تعذر الحفظ، تحقق من الرقم وحاول مرة أخرى.</p>}
          {status === 'saved' && <p role="status" className="text-sm font-bold text-green-700">تم الحفظ.</p>}
          <button type="submit" disabled={status === 'saving'} className="rounded-md bg-zamam-primary px-4 py-2.5 font-bold text-white disabled:opacity-50">
            {status === 'saving' ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </form>
      </div>
    </main>
  )
}
