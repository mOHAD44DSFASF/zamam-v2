import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'

const AdministrationUnavailable = lazy(() => import('./pages/AdministrationUnavailable').then((module) => ({ default: module.AdministrationUnavailable })))
const OrganizationAdminPage = lazy(() => import('./features/organization/OrganizationAdminPage').then((module) => ({ default: module.OrganizationAdminPage })))
const EmployeeDirectoryPage = lazy(() => import('./features/employees/EmployeeDirectoryPage').then((module) => ({ default: module.EmployeeDirectoryPage })))
const ClientManagementPage = lazy(() => import('./features/clients/ClientManagementPage').then((module) => ({ default: module.ClientManagementPage })))
const ProjectManagementPage = lazy(() => import('./features/projects/ProjectManagementPage').then((module) => ({ default: module.ProjectManagementPage })))
const WorkspaceManagementPage = lazy(() => import('./features/workspaces/WorkspaceManagementPage').then((module) => ({ default: module.WorkspaceManagementPage })))
const TaskManagementPage = lazy(() => import('./features/tasks/TaskManagementPage').then((module) => ({ default: module.TaskManagementPage })))
const WorkflowBuilderPage = lazy(() => import('./features/workflows/WorkflowBuilderPage').then((module) => ({ default: module.WorkflowBuilderPage })))
const ReviewInboxPage = lazy(() => import('./features/reviews/ReviewInboxPage').then((module) => ({ default: module.ReviewInboxPage })))
const TemplateManagementPage = lazy(() => import('./features/templates/TemplateManagementPage').then((module) => ({ default: module.TemplateManagementPage })))
const CollaborationPage = lazy(() => import('./features/collaboration/CollaborationPage').then((module) => ({ default: module.CollaborationPage })))
const FileLibraryPage = lazy(() => import('./features/files/FileLibraryPage').then((module) => ({ default: module.FileLibraryPage })))
const NotificationCenterPage = lazy(() => import('./features/notifications/NotificationCenterPage').then((module) => ({ default: module.NotificationCenterPage })))
const WorkloadPage = lazy(() => import('./features/workload/WorkloadPage').then((module) => ({ default: module.WorkloadPage })))
const TimeTrackingPage = lazy(() => import('./features/time/TimeTrackingPage').then((module) => ({ default: module.TimeTrackingPage })))
const AttendanceLeavePage = lazy(() => import('./features/attendance/AttendanceLeavePage').then((module) => ({ default: module.AttendanceLeavePage })))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const AIAssistantPage = lazy(() => import('./features/ai/AIAssistantPage').then((module) => ({ default: module.AIAssistantPage })))
const ClientPortalPage = lazy(() => import('./features/portal/ClientPortalPage').then((module) => ({ default: module.ClientPortalPage })))
const AutomationPage = lazy(() => import('./features/automations/AutomationPage').then((module) => ({ default: module.AutomationPage })))
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
            <Route path="/workspace" element={<Navigate to="/tasks" replace />} />
            <Route path="/admin" element={<AdministrationUnavailable />} />
            <Route path="/admin/organization" element={<OrganizationAdminPage />} />
            <Route path="/people" element={<EmployeeDirectoryPage />} />
            <Route path="/clients" element={<ClientManagementPage />} />
            <Route path="/projects" element={<ProjectManagementPage />} />
            <Route path="/workspaces" element={<WorkspaceManagementPage />} />
            <Route path="/tasks" element={<TaskManagementPage />} />
            <Route path="/workflows/:templateId/builder" element={<WorkflowBuilderPage />} />
            <Route path="/approvals" element={<ReviewInboxPage />} />
            <Route path="/templates" element={<TemplateManagementPage />} />
            <Route path="/tasks/:taskId/collaboration" element={<CollaborationPage />} />
            <Route path="/files" element={<FileLibraryPage />} />
            <Route path="/notifications" element={<NotificationCenterPage />} />
            <Route path="/workload" element={<WorkloadPage />} />
            <Route path="/time" element={<TimeTrackingPage />} />
            <Route path="/attendance" element={<AttendanceLeavePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/ai" element={<AIAssistantPage />} />
            <Route path="/portal/:organizationSlug" element={<ClientPortalPage />} />
            <Route path="/portal/:organizationSlug/projects/:projectId" element={<ClientPortalPage />} />
            <Route path="/automations" element={<AutomationPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
