import { useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  Bell, CheckSquare, ChevronDown, Gauge, LayoutDashboard, LogOut, Menu, Settings, UserRound, Users, X,
} from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useTenant } from '../tenant/tenant-context'
import { notificationClient, type NotificationSummary } from '../features/notifications/client'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import zamamIcon from '../assets/ZAMAM/1T-optimized.webp'

/**
 * Persistent internal-shell navigation, trimmed to exactly 4 top-level destinations for daily use —
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
    'flex items-center gap-3 rounded-md px-3 py-2.5 text-body font-bold transition-colors',
    isActive
      ? 'bg-brand-500 text-text-primary'
      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  ].join(' ')

/** A plain path-prefix match (not react-router's NavLink, whose built-in matching is exact-or-descendant
 * of its own `to`) so /team stays highlighted across every one of its sub-tab routes (/team/employees,
 * /team/departments, ...). */
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
  useEscapeToClose(useCallback(() => setOpen(false), []))
  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-label="الإشعارات" aria-expanded={open}
        className="relative grid size-10 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unread.length > 0 && (
          <span aria-hidden="true" className="absolute -top-0.5 -left-0.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 py-0.5 text-[10px] font-black leading-none text-canvas">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
        {unread.length > 0 && <span className="sr-only">{unread.length} إشعار غير مقروء</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div dir="rtl" className="absolute left-0 z-50 mt-2 w-80 max-w-[90vw] rounded-lg border border-border-subtle bg-surface-raised shadow-float animate-dropdown-in">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <p className="font-extrabold text-text-primary">الإشعارات</p>
              <Link to="/notifications" onClick={() => setOpen(false)} className="text-caption font-bold text-brand-300">عرض الكل</Link>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {unread.slice(0, 5).map((notification) => (
                <li key={notification.id} className="border-b border-border-subtle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => { void notificationClient.setStatus(organizationId, notification.id, notification.version, 'read').then(load) }}
                    className="block w-full cursor-pointer px-4 py-3 text-right hover:bg-surface-hover"
                  >
                    <p className="text-body font-bold text-text-primary">{notification.title}</p>
                    {notification.preview && <p className="mt-0.5 truncate text-caption text-text-secondary">{notification.preview}</p>}
                    <p className="mt-1 text-[11px] text-text-tertiary">{timeAgo(notification.createdAt)}</p>
                  </button>
                </li>
              ))}
              {unread.length === 0 && <li className="px-4 py-8 text-center text-body text-text-secondary">لا توجد إشعارات غير مقروءة.</li>}
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
  useEscapeToClose(useCallback(() => setOpen(false), []))
  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-label="قائمة الحساب" aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 rounded-full py-1 pe-1 ps-2.5 transition-colors hover:bg-surface-hover"
      >
        <span className="hidden text-body font-bold text-text-primary sm:inline">{displayName}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 text-label font-black text-text-primary">{initial}</span>
        <ChevronDown className="size-4 text-text-secondary" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div dir="rtl" className="absolute left-0 z-50 mt-2 w-64 max-w-[90vw] rounded-lg border border-border-subtle bg-surface-raised shadow-float animate-dropdown-in">
            <div className="border-b border-border-subtle px-4 py-3">
              <p className="truncate text-body font-bold text-text-primary">{displayName}</p>
              <p className="truncate text-caption text-text-secondary">{email}</p>
            </div>
            <div className="p-2">
              <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-body font-bold text-text-secondary hover:bg-surface-hover hover:text-text-primary">
                <UserRound className="size-4" aria-hidden="true" /> الملف الشخصي
              </Link>
              <Link to="/admin/organization" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-body font-bold text-text-secondary hover:bg-surface-hover hover:text-text-primary">
                <Settings className="size-4" aria-hidden="true" /> الإعدادات
              </Link>
              <button
                type="button" onClick={() => { setOpen(false); onLogout() }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-body font-bold text-danger hover:bg-danger-subtle"
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
  useEscapeToClose(useCallback(() => setMobileOpen(false), []))

  return (
    <div dir="rtl" className="flex min-h-screen bg-canvas">
      {/* Desktop sidebar (right side in RTL) — the "second neutral layer" (DESIGN.md), a distinct darker
          plane from the content surface so the shell reads as its own region. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-border-subtle bg-sidebar lg:flex">
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-5">
          <img src={zamamIcon} alt="زمام" className="size-10 rounded-md object-contain" />
          <div className="leading-tight">
            <p className="text-h3 font-black text-text-primary">زمام | ZAMAM</p>
            <p className="text-caption font-semibold text-text-secondary">{organizationId ?? 'مساحة العمل'}</p>
          </div>
        </div>
        <NavContents />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — every breakpoint. Carries the mobile menu toggle + brand (desktop already shows the
            brand in its sidebar) and, always, the notification bell and the profile/settings menu. */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-3">
          <div className="flex items-center gap-2 lg:hidden">
            <img src={zamamIcon} alt="زمام" className="size-8 rounded-md object-contain" />
            <span className="font-black text-text-primary">زمام</span>
          </div>
          <button
            type="button" aria-label="فتح القائمة" aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)} className="cursor-pointer rounded-md p-2 text-text-primary hover:bg-surface-hover lg:hidden"
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
            <div className="absolute inset-0 bg-black/60 animate-backdrop-in" onClick={() => setMobileOpen(false)} aria-hidden="true" />
            <aside dir="rtl" className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col bg-sidebar shadow-float animate-drawer-in">
              <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                <span className="font-black text-text-primary">القائمة</span>
                <button type="button" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} className="cursor-pointer rounded-md p-2 text-text-primary hover:bg-surface-hover">
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
