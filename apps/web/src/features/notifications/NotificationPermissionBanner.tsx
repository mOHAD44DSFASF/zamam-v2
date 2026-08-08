import { Bell, X } from 'lucide-react'
import { useState } from 'react'
import { getPermission, requestNotificationPermission } from '../../lib/pushNotifications'

const DISMISSED_KEY = 'zamam:push-banner-dismissed'

/** A dismissible banner, not a jarring immediate browser permission popup on first paint — the browser's
 * own prompt only appears once the user explicitly opts in here, which is both less annoying and more
 * likely to be granted than an unprompted request on page load. */
export function NotificationPermissionBanner() {
  // getPermission()/localStorage are synchronous browser globals — no fetch, no subscription, nothing
  // that needs an effect. A lazy useState initializer reads them once on first render, which is both
  // simpler than an effect and immune to react-hooks/set-state-in-effect (there's no setState-in-an-effect
  // to flag when the read happens during render instead).
  const [visible, setVisible] = useState(() => getPermission() === 'default' && localStorage.getItem(DISMISSED_KEY) !== '1')
  const [requesting, setRequesting] = useState(false)

  if (!visible) return null

  const dismiss = () => { localStorage.setItem(DISMISSED_KEY, '1'); setVisible(false) }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-brand-subtle px-5 py-3 animate-banner-in">
      <Bell className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
      <p className="flex-1 text-body font-semibold text-text-primary">فعّل إشعارات المتصفح لتصلك تنبيهات فورية عند وصول مهمة إليك أو إرجاع خطوة أو تعليق جديد.</p>
      <button
        type="button" disabled={requesting}
        onClick={async () => {
          setRequesting(true)
          try { await requestNotificationPermission() } finally { setRequesting(false); dismiss() }
        }}
        className="cursor-pointer rounded-md bg-brand-500 px-3 py-1.5 text-label font-bold text-text-primary transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {requesting ? 'جارٍ الطلب...' : 'تفعيل الإشعارات'}
      </button>
      <button type="button" onClick={dismiss} aria-label="إغلاق" className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
