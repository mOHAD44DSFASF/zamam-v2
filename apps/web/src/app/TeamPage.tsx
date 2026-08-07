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
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return (
    <div dir="rtl">
      <nav aria-label="أقسام الفريق" className="border-b bg-white px-5">
        <div className="mx-auto flex max-w-7xl gap-1 pt-3">
          {TABS.map((tab) => {
            const isActive = (tab.to === '/team/departments') === (activeTab === 'departments')
            return (
              <Link
                key={tab.to} to={tab.to} aria-current={isActive ? 'page' : undefined}
                className={`rounded-t-md px-4 py-2.5 text-sm font-bold ${isActive ? 'border-b-2 border-teal-800 text-teal-900' : 'text-gray-500 hover:text-teal-800'}`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </nav>
      {activeTab === 'employees'
        ? <EmployeeDirectoryScreen organizationId={organizationId} client={employeeDirectoryClient} />
        : <OrganizationDirectoryScreen organizationId={organizationId} client={organizationDirectoryClient} />}
    </div>
  )
}
