import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  Bell, CheckSquare, ChevronDown, Gauge, LayoutDashboard, LogOut, Menu, Settings, UserRound, Users, X,
} from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useTenant } from '../tenant/tenant-context'
import { notificationClient, type NotificationSummary } from '../features/notifications/client'

/**
 * Persistent internal-shell navigation, trimmed to exactly 3 top-level destinations for daily use —
 * everything else either lives as in-page tabs under one of these (Team -> Employees/Departments; see
 * app/TeamPage.tsx) or moved out of the sidebar entirely (Notifications -> the header bell below;
 * Settings -> the profile menu below). Clients, Client Portal, Automation, AI, Files, and Attendance/Leave
 * remain out of scope for this internal-only tool; their routes redirect to /tasks or /dashboard (see
 * App.tsx) and their feature code is kept, just unreachable. Per the IA doc (§3 note) navigation
 * filtering is a UX affordance, not authorization — the backend enforces every command — and there is no
 * client-side role→route map to reuse, so every active member sees every nav destination.
 */
interface NavItem { to: string; label: string; icon: typeof CheckSquare }
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { to: '/tasks', label: 'المهام', icon: CheckSquare },
  { to: '/team/employees', label: 'الفريق', icon: Users },
  { to: '/workload', label: 'التقارير', icon: Gauge },
]

const linkClasses = (isActive: boolean) =>
  [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors',
    isActive
      ? 'bg-zamam-primary text-white shadow-sm'
      : 'text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary',
  ].join(' ')

/** A plain path-prefix match (not react-router's NavLink, whose built-in matching is exact-or-descendant
 * of its own `to`) so /team stays highlighted across every one of its sub-tab routes (/team/employees,
 * /team/departments, ...), same for /time. */
const isSectionActive = (pathname: string, to: string) => {
  const section = to.split('/')[1]
  return section ? pathname === to || pathname.startsWith(`/${section}/`) : pathname === to
}

function NavContents({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="التنقل الرئيسي" className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <Link to={item.to} onClick={onNavigate} aria-current={isSectionActive(pathname, item.to) ? 'page' : undefined} className={linkClasses(isSectionActive(pathname, item.to))}>
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const diffMs = Date.now() - Date.parse(iso)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `منذ ${minutes} د`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `منذ ${hours} س`
  return `منذ ${Math.floor(hours / 24)} يوم`
}

function NotificationBell({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState<readonly NotificationSummary[]>([])
  const load = useCallback(() => {
    notificationClient.load(organizationId, 'unread').then((snapshot) => setUnread(snapshot.notifications)).catch(() => {})
  }, [organizationId])
  useEffect(() => { load() }, [load])
  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-label="الإشعارات" aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-full text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread.length > 0 && (
          <span aria-hidden="true" className="absolute -top-0.5 -left-0.5 grid min-w-4.5 place-items-center rounded-full bg-red-600 px-1 py-0.5 text-[10px] font-black leading-none text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
        {unread.length > 0 && <span className="sr-only">{unread.length} إشعار غير مقروء</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div dir="rtl" className="absolute left-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-zamam-gray/60 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-zamam-gray/60 px-4 py-3">
              <p className="font-black text-zamam-textDark">الإشعارات</p>
              <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs font-bold text-zamam-primary">عرض الكل</Link>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {unread.slice(0, 5).map((notification) => (
                <li key={notification.id} className="border-b border-zamam-gray/40 px-4 py-3 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { void notificationClient.setStatus(organizationId, notification.id, notification.version, 'read').then(load) }}
                    className="block w-full text-right"
                  >
                    <p className="text-sm font-bold text-zamam-textDark">{notification.title}</p>
                    {notification.preview && <p className="mt-0.5 truncate text-xs text-zamam-textGray">{notification.preview}</p>}
                    <p className="mt-1 text-[11px] text-zamam-textGray/70">{timeAgo(notification.createdAt)}</p>
                  </button>
                </li>
              ))}
              {unread.length === 0 && <li className="px-4 py-8 text-center text-sm text-zamam-textGray">لا توجد إشعارات غير مقروءة.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function ProfileMenu({ displayName, email, initial, onLogout }: {
  displayName: string
  email: string
  initial: string
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-label="قائمة الحساب" aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pe-1 ps-2.5 hover:bg-zamam-light"
      >
        <span className="hidden text-sm font-bold text-zamam-textDark sm:inline">{displayName}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zamam-primary to-zamam-navy text-xs font-black text-white">{initial}</span>
        <ChevronDown className="size-4 text-zamam-textGray" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div dir="rtl" className="absolute left-0 z-50 mt-2 w-64 max-w-[90vw] rounded-xl border border-zamam-gray/60 bg-white shadow-lg">
            <div className="border-b border-zamam-gray/60 px-4 py-3">
              <p className="truncate text-sm font-bold text-zamam-textDark">{displayName}</p>
              <p className="truncate text-xs text-zamam-textGray">{email}</p>
            </div>
            <div className="p-2">
              <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary">
                <UserRound className="size-4" aria-hidden="true" /> الملف الشخصي
              </Link>
              <Link to="/admin/organization" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary">
                <Settings className="size-4" aria-hidden="true" /> الإعدادات
              </Link>
              <button
                type="button" onClick={() => { setOpen(false); onLogout() }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50"
              >
                <LogOut className="size-4" aria-hidden="true" /> تسجيل الخروج
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell() {
  const { session, logout } = useAuth()
  const { organizationId } = useTenant()
  const [mobileOpen, setMobileOpen] = useState(false)
  const displayName = session?.displayName || 'مستخدم'
  const initial = displayName.trim().charAt(0) || '?'

  return (
    <div dir="rtl" className="flex min-h-screen bg-zamam-light font-['Cairo']">
      {/* Desktop sidebar (right side in RTL) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-zamam-gray/60 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-zamam-gray/60 px-5 py-5">
          <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-zamam-primary to-zamam-navy font-black text-white">Z</div>
          <div className="leading-tight">
            <p className="text-base font-black text-zamam-textDark">زمام | ZAMAM</p>
            <p className="text-xs font-bold text-zamam-textGray">{organizationId ?? 'مساحة العمل'}</p>
          </div>
        </div>
        <NavContents />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — every breakpoint. Carries the mobile menu toggle + brand (desktop already shows the
            brand in its sidebar) and, always, the notification bell and the profile/settings menu. */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zamam-gray/60 bg-white px-4 py-3">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-sm font-black text-white">Z</div>
            <span className="font-black text-zamam-textDark">زمام</span>
          </div>
          <button
            type="button" aria-label="فتح القائمة" aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-zamam-textDark hover:bg-zamam-light lg:hidden"
          >
            <Menu className="size-6" aria-hidden="true" />
          </button>
          <div className="flex flex-1 items-center justify-end gap-2">
            {organizationId && <NotificationBell organizationId={organizationId} />}
            <ProfileMenu displayName={displayName} email={session?.email ?? ''} initial={initial} onLogout={() => void logout()} />
          </div>
        </header>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
            <aside dir="rtl" className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-zamam-gray/60 px-4 py-3">
                <span className="font-black text-zamam-textDark">القائمة</span>
                <button type="button" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-zamam-light">
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <NavContents onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
