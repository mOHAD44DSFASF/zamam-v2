import { Archive, Bell, Check, LoaderCircle, Save, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import {
  notificationClient, type NotificationClient, type NotificationPreferenceSummary,
  type NotificationSnapshot,
} from './client'

const t = {
  loading: '\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a...',
  error: '\u062a\u0639\u0630\u0631 \u062a\u062d\u064a\u0645\u0644 \u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a',
  heading: '\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a',
  inbox: '\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0648\u0627\u0631\u062f',
  all: '\u0627\u0644\u0643\u0644',
  unread: '\u063a\u064a\u0631 \u0645\u0642\u0631\u0648\u0621',
  read: '\u0645\u0642\u0631\u0648\u0621',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0636\u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0639\u0631\u0636.',
  markRead: '\u062a\u0639\u0644\u064a\u0645 \u0643\u0645\u0642\u0631\u0648\u0621',
  archive: '\u0623\u0631\u0634\u0641\u0629',
  preferences: '\u062a\u0641\u0636\u064a\u0644\u0627\u062a \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a',
  inApp: '\u062f\u0627\u062e\u0644 \u0627\u0644\u062a\u0637\u0628\u064a\u0642',
  email: '\u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a',
  digest: '\u0627\u0644\u0625\u0631\u0633\u0627\u0644',
  quietStart: '\u0628\u062f\u0627\u064a\u0629 \u0627\u0644\u0647\u062f\u0648\u0621',
  quietEnd: '\u0646\u0647\u0627\u064a\u0629 \u0627\u0644\u0647\u062f\u0648\u0621',
  save: '\u062d\u0641\u0638',
  providerMissing: '\u0645\u0632\u0648\u062f \u0627\u0644\u0628\u0631\u064a\u062f \u063a\u064a\u0631 \u0645\u0647\u064a\u0623. \u0633\u062a\u0638\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u062f\u0627\u062e\u0644 \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u062a\u0627\u062d\u0629.',
  noTenant: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0636\u0648\u064a\u0629 \u0645\u0624\u0633\u0633\u0629 \u0646\u0634\u0637\u0629.',
}
const digestLabels = {
  immediate: '\u0641\u0648\u0631\u064a', daily: '\u0645\u0644\u062e\u0635 \u064a\u0648\u0645\u064a',
  weekly: '\u0645\u0644\u062e\u0635 \u0623\u0633\u0628\u0648\u0639\u064a', never: '\u0628\u062f\u0648\u0646 \u0628\u0631\u064a\u062f',
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
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> {t.loading}</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>{t.error}</h1></main>
  const setNotificationStatus = async (
    id: string, version: number, next: 'read' | 'archived',
  ) => {
    await client.setStatus(organizationId, id, version, next)
    await load()
  }
  const updateLocalPreference = (
    index: number, update: Partial<NotificationPreferenceSummary>,
  ) => setSnapshot({
    ...snapshot,
    preferences: snapshot.preferences.map((preference, current) =>
      current === index ? { ...preference, ...update } : preference),
  })
  return <main dir="rtl" className="min-h-screen bg-gray-50 text-gray-950">
    <header className="border-b bg-white"><div className="mx-auto max-w-6xl px-5 py-6"><p className="text-sm font-bold text-teal-800">{t.inbox}</p><h1 className="text-2xl font-black">{t.heading}</h1></div></header>
    {!snapshot.emailProvider.configured && <div role="alert" className="mx-auto mt-5 flex max-w-6xl gap-3 border border-amber-300 bg-amber-50 p-4 text-amber-950"><ShieldAlert className="size-5 shrink-0" aria-hidden="true" /><p>{t.providerMissing}</p></div>}
    <div className="mx-auto grid max-w-6xl gap-7 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="notification-list-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="notification-list-heading" className="text-lg font-black">{t.inbox}</h2>
          <div role="group" aria-label={t.inbox} className="flex rounded-md border bg-white p-1">
            {(['all', 'unread', 'read'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className="rounded px-3 py-1.5 text-sm font-bold aria-pressed:bg-teal-800 aria-pressed:text-white">{t[value]}</button>)}
          </div>
        </div>
        <div className="space-y-3">{snapshot.notifications.map((notification) => <article key={notification.id} className={`border bg-white p-4 ${notification.status === 'unread' ? 'border-r-4 border-r-teal-700' : ''}`}>
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="flex items-center gap-2 font-black"><Bell className="size-4 text-teal-800" aria-hidden="true" />{notification.title}</h3><p className="mt-1 text-sm text-gray-700">{notification.preview}</p><time className="mt-2 block text-xs text-gray-500">{notification.createdAt}</time></div><div className="flex shrink-0 gap-2">{notification.status === 'unread' && <button title={t.markRead} aria-label={`${t.markRead}: ${notification.title}`} onClick={() => void setNotificationStatus(notification.id, notification.version, 'read')} className="grid size-9 place-items-center rounded-md border"><Check className="size-4" aria-hidden="true" /></button>}<button title={t.archive} aria-label={`${t.archive}: ${notification.title}`} onClick={() => void setNotificationStatus(notification.id, notification.version, 'archived')} className="grid size-9 place-items-center rounded-md border"><Archive className="size-4" aria-hidden="true" /></button></div></div>
        </article>)}{snapshot.notifications.length === 0 && <div className="border bg-white p-10 text-center text-gray-500">{t.empty}</div>}</div>
      </section>
      {snapshot.capabilities.managePreferences && <aside aria-labelledby="preferences-heading" className="border bg-white p-5"><h2 id="preferences-heading" className="font-black">{t.preferences}</h2><div className="mt-4 space-y-6">{snapshot.preferences.map((preference, index) => <fieldset key={preference.eventType} className="border-t pt-4"><legend className="font-bold">{preference.label}</legend><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={preference.inApp} disabled={preference.critical} onChange={(event) => updateLocalPreference(index, { inApp: event.target.checked })} /> {t.inApp}</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={preference.email} disabled={preference.critical || !snapshot.emailProvider.configured} onChange={(event) => updateLocalPreference(index, { email: event.target.checked })} /> {t.email}</label><label className="mt-3 block text-sm font-bold">{t.digest}<select value={preference.digest} disabled={preference.critical} onChange={(event) => updateLocalPreference(index, { digest: event.target.value as NotificationPreferenceSummary['digest'] })} className="mt-1 w-full rounded-md border p-2">{Object.entries(digestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs font-bold">{t.quietStart}<input type="time" value={preference.quietHoursStart} onChange={(event) => updateLocalPreference(index, { quietHoursStart: event.target.value })} className="mt-1 w-full rounded-md border p-2" /></label><label className="text-xs font-bold">{t.quietEnd}<input type="time" value={preference.quietHoursEnd} onChange={(event) => updateLocalPreference(index, { quietHoursEnd: event.target.value })} className="mt-1 w-full rounded-md border p-2" /></label></div><button onClick={() => void client.updatePreference(organizationId, preference).then(() => load())} className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 text-sm font-bold text-white"><Save className="size-4" aria-hidden="true" /> {t.save}</button></fieldset>)}</div></aside>}
    </div>
  </main>
}

export function NotificationCenterPage() {
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center">{t.noTenant}</main>
  return <NotificationCenterScreen organizationId={organizationId} client={notificationClient} />
}
