import { useLocation, Link } from 'react-router-dom'
import { useTenant } from '../tenant/tenant-context'
import { EmployeeDirectoryScreen } from '../features/employees/EmployeeDirectoryPage'
import { employeeDirectoryClient } from '../features/employees/client'
import { OrganizationDirectoryScreen } from '../features/organization/OrganizationAdminPage'
import { organizationDirectoryClient } from '../features/organization/client'

const TABS = [
  { to: '/team/employees', label: 'الموظفين' },
  { to: '/team/departments', label: 'الأقسام' },
] as const

/** Employees and Departments used to be two separate sidebar destinations; this hosts both as tabs on one
 * page (/team/employees, /team/departments) so the sidebar stays at 4 top-level items. Each tab embeds the
 * existing, untouched Screen component for that feature — no changes to either underlying page. */
export function TeamPage() {
  const { organizationId } = useTenant()
  const location = useLocation()
  const activeTab = location.pathname.startsWith('/team/departments') ? 'departments' : 'employees'
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  return (
    <div dir="rtl" className="min-h-screen bg-canvas">
      {/* This is the page's only header/chrome bar — the embedded screens below render with
          hideHeader so their own title bar doesn't stack a second one underneath this. */}
      <header className="border-b border-border-subtle bg-surface px-5">
        <div className="mx-auto max-w-7xl pt-6">
          <p className="text-label font-semibold text-brand-300">الفريق</p>
          <h1 className="mt-1 text-display font-extrabold text-text-primary">إدارة الفريق</h1>
        </div>
        <nav aria-label="أقسام الفريق" className="mx-auto mt-4 flex max-w-7xl gap-1">
          {TABS.map((tab) => {
            const isActive = (tab.to === '/team/departments') === (activeTab === 'departments')
            return (
              <Link
                key={tab.to} to={tab.to} aria-current={isActive ? 'page' : undefined}
                className={`rounded-t-md px-4 py-2.5 text-body font-bold transition-colors ${isActive ? 'border-b-2 border-brand-400 text-brand-300' : 'border-b-2 border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>
      {activeTab === 'employees'
        ? <EmployeeDirectoryScreen organizationId={organizationId} client={employeeDirectoryClient} hideHeader />
        : <OrganizationDirectoryScreen organizationId={organizationId} client={organizationDirectoryClient} hideHeader />}
    </div>
  )
}
