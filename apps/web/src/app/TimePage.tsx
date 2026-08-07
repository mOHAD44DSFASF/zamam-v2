import { useLocation, Link } from 'react-router-dom'
import { useTenant } from '../tenant/tenant-context'
import { AttendanceLeaveScreen } from '../features/attendance/AttendanceLeavePage'
import { attendanceLeaveClient } from '../features/attendance/client'

const TABS = [
  { to: '/time/attendance', label: 'الحضور' },
  { to: '/time/leave', label: 'الإجازات' },
] as const

/** Attendance and Leave used to be two separate sidebar destinations; this hosts both as tabs on one page
 * (/time/attendance, /time/leave) so the sidebar stays at 4 top-level items. Both tabs render the existing
 * AttendanceLeaveScreen (unchanged data loading), scoped to one section via its `section` prop. */
export function TimePage() {
  const { organizationId } = useTenant()
  const location = useLocation()
  const activeTab = location.pathname.startsWith('/time/leave') ? 'leave' : 'attendance'
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return (
    <div dir="rtl">
      <nav aria-label="أقسام الوقت" className="border-b bg-white px-5">
        <div className="mx-auto flex max-w-6xl gap-1 pt-3">
          {TABS.map((tab) => {
            const isActive = (tab.to === '/time/leave') === (activeTab === 'leave')
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
      <AttendanceLeaveScreen organizationId={organizationId} client={attendanceLeaveClient} section={activeTab} />
    </div>
  )
}
