import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'
import { AppShell } from './app/AppShell'

const AdministrationUnavailable = lazy(() => import('./pages/AdministrationUnavailable').then((module) => ({ default: module.AdministrationUnavailable })))
const OrganizationAdminPage = lazy(() => import('./features/organization/OrganizationAdminPage').then((module) => ({ default: module.OrganizationAdminPage })))
const EmployeeDirectoryPage = lazy(() => import('./features/employees/EmployeeDirectoryPage').then((module) => ({ default: module.EmployeeDirectoryPage })))
const ProjectManagementPage = lazy(() => import('./features/projects/ProjectManagementPage').then((module) => ({ default: module.ProjectManagementPage })))
const WorkspaceManagementPage = lazy(() => import('./features/workspaces/WorkspaceManagementPage').then((module) => ({ default: module.WorkspaceManagementPage })))
const TaskManagementPage = lazy(() => import('./features/tasks/TaskManagementPage').then((module) => ({ default: module.TaskManagementPage })))
const WorkflowBuilderPage = lazy(() => import('./features/workflows/WorkflowBuilderPage').then((module) => ({ default: module.WorkflowBuilderPage })))
const ReviewInboxPage = lazy(() => import('./features/reviews/ReviewInboxPage').then((module) => ({ default: module.ReviewInboxPage })))
const TemplateManagementPage = lazy(() => import('./features/templates/TemplateManagementPage').then((module) => ({ default: module.TemplateManagementPage })))
const CollaborationPage = lazy(() => import('./features/collaboration/CollaborationPage').then((module) => ({ default: module.CollaborationPage })))
const NotificationCenterPage = lazy(() => import('./features/notifications/NotificationCenterPage').then((module) => ({ default: module.NotificationCenterPage })))
const WorkloadPage = lazy(() => import('./features/workload/WorkloadPage').then((module) => ({ default: module.WorkloadPage })))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const TeamPage = lazy(() => import('./app/TeamPage').then((module) => ({ default: module.TeamPage })))
const DashboardPage = lazy(() => import('./app/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const InvitationAcceptance = lazy(() => import('./pages/InvitationAcceptance').then((module) => ({ default: module.InvitationAcceptance })))
const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })))
const PasswordReset = lazy(() => import('./pages/PasswordReset').then((module) => ({ default: module.PasswordReset })))

function RouteLoading() {
  return (
    <div dir="rtl" role="status" aria-live="polite" className="min-h-screen grid place-items-center bg-gray-50 text-gray-700">
      جارٍ التحميل...
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/password-reset" element={<PasswordReset />} />
            <Route path="/invitations/accept" element={<InvitationAcceptance />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            {/* Internal shell: every internal/Owner page renders inside the persistent navigation. */}
            <Route element={<AppShell />}>
              <Route path="/workspace" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/admin" element={<AdministrationUnavailable />} />
              <Route path="/admin/organization" element={<OrganizationAdminPage />} />
              <Route path="/people" element={<EmployeeDirectoryPage />} />
              <Route path="/projects" element={<ProjectManagementPage />} />
              <Route path="/workspaces" element={<WorkspaceManagementPage />} />
              <Route path="/tasks" element={<TaskManagementPage />} />
              <Route path="/workflows/:templateId/builder" element={<WorkflowBuilderPage />} />
              <Route path="/approvals" element={<ReviewInboxPage />} />
              <Route path="/templates" element={<TemplateManagementPage />} />
              <Route path="/tasks/:taskId/collaboration" element={<CollaborationPage />} />
              <Route path="/notifications" element={<NotificationCenterPage />} />
              <Route path="/workload" element={<WorkloadPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              {/* Team is now a single sidebar destination with in-page tabs — Employees/Departments each stay
                  fully reachable at their own URL, just nested under a common section instead of being
                  separate top-level sidebar items. Nothing above (/people, /admin/organization) was removed
                  — these are additional, newer entry points to the same pages, not replacements. */}
              <Route path="/team" element={<Navigate to="/team/employees" replace />} />
              <Route path="/team/employees" element={<TeamPage />} />
              <Route path="/team/departments" element={<TeamPage />} />
              {/* Clients, Client Portal, Automation, AI, Files, and Attendance/Leave are out of scope for
                  this internal-only tool's navigation. The feature code and backend endpoints under
                  features/clients, features/attendance, features/time etc. are intentionally kept (not
                  deleted) in case this is revisited later — only reachability (routes + lazy imports) is
                  removed. Old bookmarks redirect to /tasks. Files' role — attaching evidence to a
                  task/step — is covered by the plain Drive-link field on tasks/steps instead of a real
                  upload/library feature. */}
              <Route path="/clients" element={<Navigate to="/tasks" replace />} />
              <Route path="/ai" element={<Navigate to="/tasks" replace />} />
              <Route path="/automations" element={<Navigate to="/tasks" replace />} />
              <Route path="/files" element={<Navigate to="/tasks" replace />} />
              <Route path="/time" element={<Navigate to="/tasks" replace />} />
              <Route path="/time/attendance" element={<Navigate to="/tasks" replace />} />
              <Route path="/time/leave" element={<Navigate to="/tasks" replace />} />
              <Route path="/attendance" element={<Navigate to="/tasks" replace />} />
            </Route>
            <Route path="/portal/:organizationSlug" element={<Navigate to="/tasks" replace />} />
            <Route path="/portal/:organizationSlug/projects/:projectId" element={<Navigate to="/tasks" replace />} />
          </Route>
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
