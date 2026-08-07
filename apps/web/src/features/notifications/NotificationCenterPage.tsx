import { Archive, Bell, Check, Inbox, LoaderCircle, Save, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import {
  notificationClient, type NotificationClient, type NotificationPreferenceSummary,
  type NotificationSnapshot,
} from './client'

const t = {
  loading: 'جارٍ تحميل الإشعارات...',
  error: 'تعذر تحيمل مركز الإشعارات',
  retry: 'إعادة المحاولة',
  heading: 'مركز الإشعارات',
  inbox: 'صندوق الوارد',
  all: 'الكل',
  unread: 'غير مقروء',
  read: 'مقروء',
  empty: 'لا توجد إشعارات ضمن هذا العرض.',
  markRead: 'تعليم كمقروء',
  archive: 'أرشفة',
  preferences: 'تفضيلات الإشعارات',
  inApp: 'داخل التطبيق',
  email: 'البريد الإلكتروني',
  digest: 'الإرسال',
  quietStart: 'بداية الهدوء',
  quietEnd: 'نهاية الهدوء',
  save: 'حفظ',
  saving: 'جارٍ الحفظ...',
  providerMissing: 'مزود البريد غير مهيأ. ستظل الإشعارات داخل التطبيق متاحة.',
  noTenant: 'لا توجد عضوية مؤسسة نشطة.',
}
const digestLabels = {
  immediate: 'فوري', daily: 'ملخص يومي',
  weekly: 'ملخص أسبوعي', never: 'بدون بريد',
}

export function NotificationCenterScreen({
  organizationId, client,
}: {
  organizationId: string
  client: NotificationClient
}) {
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const load = useCallback(async (next = filter) => {
    setStatus('loading')
    try {
      setSnapshot(await client.load(organizationId, next))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [client, filter, organizationId])
  useEffect(() => {
    let active = true
    client.load(organizationId, filter).then(
      (value) => { if (active) { setSnapshot(value); setStatus('ready') } },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, filter, organizationId])
  if (status === 'loading') return <main dir="rtl" className="min-h-screen bg-canvas">
    <p role="status" className="sr-only">{t.loading}</p>
    <div className="animate-pulse" aria-hidden="true">
      <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-40 rounded-md bg-surface-hover" /></div></header>
      <div className="mx-auto max-w-6xl px-5 py-6 space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 rounded-md border border-border-subtle bg-surface" />)}</div>
    </div>
  </main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><section className="text-center"><ShieldAlert className="mx-auto size-7 text-warning" aria-hidden="true" /><h1 className="mt-3 text-h1 font-extrabold text-text-primary">{t.error}</h1><button type="button" onClick={() => void load()} className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-bold text-text-primary transition-all hover:bg-surface-hover active:scale-[0.98]">{t.retry}</button></section></main>
  const setNotificationStatus = async (
    id: string, version: number, next: 'read' | 'archived',
  ) => {
    setPendingIds((prev) => new Set(prev).add(id))
    try {
      await client.setStatus(organizationId, id, version, next)
      await load()
    } finally {
      setPendingIds((prev) => { const copy = new Set(prev); copy.delete(id); return copy })
    }
  }
  const updateLocalPreference = (
    index: number, update: Partial<NotificationPreferenceSummary>,
  ) => setSnapshot({
    ...snapshot,
    preferences: snapshot.preferences.map((preference, current) =>
      current === index ? { ...preference, ...update } : preference),
  })
  const savePreference = async (index: number, preference: NotificationPreferenceSummary) => {
    setSavingIndex(index)
    try { await client.updatePreference(organizationId, preference); await load() }
    finally { setSavingIndex(null) }
  }
  return <main dir="rtl" className="min-h-screen bg-canvas">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-label font-semibold text-brand-300">{t.inbox}</p><h1 className="text-display font-extrabold text-text-primary">{t.heading}</h1></div></header>
    {!snapshot.emailProvider.configured && <div role="alert" className="mx-auto mt-5 flex max-w-6xl items-start gap-3 rounded-md border border-warning/30 bg-warning-subtle px-5 py-4 text-warning"><ShieldAlert className="size-5 shrink-0" aria-hidden="true" /><p className="text-body font-semibold">{t.providerMissing}</p></div>}
    <div className="mx-auto grid max-w-6xl gap-7 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="notification-list-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="notification-list-heading" className="text-h1 font-extrabold text-text-primary">{t.inbox}</h2>
          <div role="group" aria-label={t.inbox} className="inline-flex gap-1 rounded-md border border-border-subtle bg-surface p-1">
            {(['all', 'unread', 'read'] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className="cursor-pointer rounded-sm px-3 py-1.5 text-body font-bold text-text-secondary transition-colors hover:text-text-primary aria-pressed:bg-brand-subtle aria-pressed:text-brand-300">{t[value]}</button>)}
          </div>
        </div>
        <div className="space-y-3">
          {snapshot.notifications.map((notification) => {
            const unread = notification.status === 'unread'
            const pending = pendingIds.has(notification.id)
            return <article key={notification.id} className={`rounded-md border p-4 transition-colors hover:bg-surface-hover ${unread ? 'border-brand-400/30 bg-surface-raised' : 'border-border-subtle bg-surface'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className={`flex items-center gap-2 text-text-primary ${unread ? 'font-extrabold' : 'font-semibold'}`}>
                    {unread && <span className="size-2 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />}
                    <Bell className="size-4 shrink-0 text-brand-400" aria-hidden="true" />
                    <span className="truncate" title={notification.title}>{notification.title}</span>
                    {unread && <span className="sr-only">({t.unread})</span>}
                  </h3>
                  <p className="mt-1 text-body text-text-secondary">{notification.preview}</p>
                  <time className="mt-2 block text-caption text-text-tertiary">{notification.createdAt}</time>
                </div>
                <div className="flex shrink-0 gap-2">
                  {unread && <button type="button" disabled={pending} title={t.markRead} aria-label={`${t.markRead}: ${notification.title}`} onClick={() => void setNotificationStatus(notification.id, notification.version, 'read')} className="grid size-9 cursor-pointer place-items-center rounded-md border border-border-strong text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}</button>}
                  <button type="button" disabled={pending} title={t.archive} aria-label={`${t.archive}: ${notification.title}`} onClick={() => void setNotificationStatus(notification.id, notification.version, 'archived')} className="grid size-9 cursor-pointer place-items-center rounded-md border border-border-strong text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}</button>
                </div>
              </div>
            </article>
          })}
          {snapshot.notifications.length === 0 && <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface/50 px-6 py-12 text-center">
            <Inbox className="size-10 text-text-tertiary" aria-hidden="true" />
            <p className="text-h3 font-bold text-text-primary">{t.empty}</p>
          </div>}
        </div>
      </section>
      {snapshot.capabilities.managePreferences && <aside aria-labelledby="preferences-heading" className="h-fit rounded-md border border-border-subtle bg-surface p-5">
        <h2 id="preferences-heading" className="text-h2 font-bold text-text-primary">{t.preferences}</h2>
        <div className="mt-4 space-y-6">
          {snapshot.preferences.map((preference, index) => <fieldset key={preference.eventType} className="border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
            <legend className="text-label font-bold text-text-primary">{preference.label}</legend>
            <label className={`mt-3 flex items-center gap-2 text-body text-text-secondary ${preference.critical ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-text-primary'}`}>
              <input type="checkbox" checked={preference.inApp} disabled={preference.critical} onChange={(event) => updateLocalPreference(index, { inApp: event.target.checked })} className="size-4 rounded-sm border-border-strong accent-brand-500" /> {t.inApp}
            </label>
            <label className={`mt-2 flex items-center gap-2 text-body text-text-secondary ${preference.critical || !snapshot.emailProvider.configured ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-text-primary'}`}>
              <input type="checkbox" checked={preference.email} disabled={preference.critical || !snapshot.emailProvider.configured} onChange={(event) => updateLocalPreference(index, { email: event.target.checked })} className="size-4 rounded-sm border-border-strong accent-brand-500" /> {t.email}
            </label>
            <label className="mt-3 block text-label font-bold text-text-secondary">
              {t.digest}
              <select value={preference.digest} disabled={preference.critical} onChange={(event) => updateLocalPreference(index, { digest: event.target.value as NotificationPreferenceSummary['digest'] })} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary disabled:cursor-not-allowed disabled:opacity-50">
                {Object.entries(digestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-caption font-bold text-text-secondary">
                {t.quietStart}
                <input type="time" value={preference.quietHoursStart} onChange={(event) => updateLocalPreference(index, { quietHoursStart: event.target.value })} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary" />
              </label>
              <label className="text-caption font-bold text-text-secondary">
                {t.quietEnd}
                <input type="time" value={preference.quietHoursEnd} onChange={(event) => updateLocalPreference(index, { quietHoursEnd: event.target.value })} className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body text-text-primary transition-colors hover:border-text-tertiary" />
              </label>
            </div>
            <button type="button" disabled={savingIndex === index} onClick={() => void savePreference(index, preference)} className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-3 py-2 text-label font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
              {savingIndex === index ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />} {savingIndex === index ? t.saving : t.save}
            </button>
          </fieldset>)}
        </div>
      </aside>}
    </div>
  </main>
}

export function NotificationCenterPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center text-text-secondary">{t.noTenant}</main>
  return <NotificationCenterScreen organizationId={organizationId} client={notificationClient} />
}
