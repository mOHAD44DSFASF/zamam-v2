import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Bell, Boxes, Building2, CalendarClock, CheckSquare, ClipboardCheck, Clock3, FileText,
  FolderKanban, Gauge, LayoutList, LogOut, Menu, Settings, Users, X,
} from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useTenant } from '../tenant/tenant-context'

/**
 * Persistent internal-shell navigation. This is an internal team task/workflow tool only (no client-facing
 * modules) — Clients, Client Portal, Automation, and AI are intentionally absent here; their routes redirect
 * to /tasks (see App.tsx) and their feature code is kept, just unreachable. Per the IA doc (§3 note)
 * navigation filtering is a UX affordance, not authorization — the backend enforces every command — and
 * there is no client-side role→route map to reuse, so every active member sees every nav destination.
 */
interface NavItem { to: string; label: string; icon: typeof CheckSquare; end?: boolean }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'العمل',
    items: [
      { to: '/tasks', label: 'المهام', icon: CheckSquare },
      { to: '/projects', label: 'المشاريع', icon: FolderKanban },
      { to: '/workspaces', label: 'مساحات العمل', icon: Boxes },
      { to: '/templates', label: 'القوالب والعمل المتكرر', icon: LayoutList },
      { to: '/approvals', label: 'المراجعات والموافقات', icon: ClipboardCheck },
    ],
  },
  {
    title: 'الفريق',
    items: [
      { to: '/people', label: 'الموظفين', icon: Users },
      { to: '/admin/organization', label: 'الأقسام', icon: Building2 },
    ],
  },
  {
    title: 'الوقت',
    items: [
      { to: '/attendance', label: 'الحضور والإجازات', icon: CalendarClock },
      { to: '/time', label: 'كشوف الساعات', icon: Clock3 },
    ],
  },
  {
    title: 'التقارير',
    items: [
      { to: '/reports', label: 'التقارير', icon: FileText },
      { to: '/workload', label: 'عبء العمل', icon: Gauge },
    ],
  },
  {
    title: 'الإعدادات',
    items: [
      { to: '/admin/organization', label: 'إدارة المؤسسة', icon: Settings },
      { to: '/notifications', label: 'الإشعارات', icon: Bell },
      { to: '/files', label: 'الملفات', icon: FolderKanban },
      { to: '/admin', label: 'الإدارة', icon: Settings, end: true },
    ],
  },
]

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors',
    isActive
      ? 'bg-zamam-primary text-white shadow-sm'
      : 'text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary',
  ].join(' ')

function NavContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="التنقل الرئيسي" className="flex-1 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="mb-5">
          <p className="mb-2 px-3 text-xs font-black uppercase tracking-wide text-zamam-textGray/70">{group.title}</p>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={`${group.title}-${item.to}`}>
                <NavLink to={item.to} end={item.end} className={linkClasses} onClick={onNavigate}>
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { session, logout } = useAuth()
  const { organizationId } = useTenant()
  const [mobileOpen, setMobileOpen] = useState(false)
  const displayName = session?.displayName || 'مستخدم'
  const initial = displayName.trim().charAt(0) || '?'

  const brandAndUser = (
    <>
      <div className="flex items-center gap-3 border-b border-zamam-gray/60 px-5 py-5">
        <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-zamam-primary to-zamam-navy font-black text-white">Z</div>
        <div className="leading-tight">
          <p className="text-base font-black text-zamam-textDark">زمام | ZAMAM</p>
          <p className="text-xs font-bold text-zamam-textGray">{organizationId ?? 'مساحة العمل'}</p>
        </div>
      </div>
      <div className="border-t border-zamam-gray/60 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl bg-zamam-light px-3 py-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-sm font-black text-white">{initial}</div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-zamam-textDark">{displayName}</p>
            <p className="truncate text-xs text-zamam-textGray">{session?.email ?? ''}</p>
          </div>
        </div>
        <button
          type="button" onClick={() => void logout()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50"
        >
          <LogOut className="size-4" aria-hidden="true" /> تسجيل الخروج
        </button>
      </div>
    </>
  )

  return (
    <div dir="rtl" className="flex min-h-screen bg-zamam-light font-['Cairo']">
      {/* Desktop sidebar (right side in RTL) */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-l border-zamam-gray/60 bg-white lg:flex">
        {brandAndUser}
        <NavContents />
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zamam-gray/60 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-sm font-black text-white">Z</div>
            <span className="font-black text-zamam-textDark">زمام</span>
          </div>
          <button
            type="button" aria-label="فتح القائمة" aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-zamam-textDark hover:bg-zamam-light"
          >
            <Menu className="size-6" aria-hidden="true" />
          </button>
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
              {brandAndUser}
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
