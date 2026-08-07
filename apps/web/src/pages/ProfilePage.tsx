import { Check, TriangleAlert, UserRound } from 'lucide-react'
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

  if (!session || !organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary">لا توجد جلسة نشطة.</main>

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
    <main dir="rtl" className="min-h-screen bg-canvas px-5 py-10">
      <div className="mx-auto max-w-lg rounded-lg border border-border-subtle bg-surface p-6 shadow-float">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-subtle text-brand-300"><UserRound className="size-5" aria-hidden="true" /></span>
          <h1 className="text-h1 font-extrabold text-text-primary">الملف الشخصي</h1>
        </div>
        <dl className="mt-5 space-y-2 border-t border-border-subtle pt-4 text-body">
          <div className="flex justify-between"><dt className="text-text-secondary">الاسم</dt><dd className="font-bold text-text-primary">{session.displayName}</dd></div>
          <div className="flex justify-between"><dt className="text-text-secondary">البريد الإلكتروني</dt><dd dir="ltr" className="font-bold text-text-primary">{session.email}</dd></div>
        </dl>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-label font-semibold text-text-secondary">
            رقم واتساب (مع رمز الدولة)
            <input
              type="tel" required placeholder="+9665xxxxxxxx" dir="ltr" value={whatsappPhone}
              onChange={(event) => setWhatsappPhone(event.target.value)}
              className="mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2.5 text-left text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400"
            />
          </label>
          {status === 'error' && <p role="alert" className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-label font-bold text-danger"><TriangleAlert className="size-4 shrink-0" aria-hidden="true" /> تعذر الحفظ، تحقق من الرقم وحاول مرة أخرى.</p>}
          {status === 'saved' && <p role="status" className="flex items-center gap-2 rounded-md border border-success/30 bg-success-subtle px-3 py-2 text-label font-bold text-success"><Check className="size-4 shrink-0" aria-hidden="true" /> تم الحفظ.</p>}
          <button type="submit" disabled={status === 'saving'} className="cursor-pointer rounded-md bg-brand-500 px-4 py-2.5 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
            {status === 'saving' ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </form>
      </div>
    </main>
  )
}
