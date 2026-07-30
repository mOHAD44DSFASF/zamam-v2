import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'

const AdministrationUnavailable = lazy(() => import('./pages/AdministrationUnavailable').then((module) => ({ default: module.AdministrationUnavailable })))
const OrganizationAdminPage = lazy(() => import('./features/organization/OrganizationAdminPage').then((module) => ({ default: module.OrganizationAdminPage })))
const EmployeeDirectoryPage = lazy(() => import('./features/employees/EmployeeDirectoryPage').then((module) => ({ default: module.EmployeeDirectoryPage })))
const ClientManagementPage = lazy(() => import('./features/clients/ClientManagementPage').then((module) => ({ default: module.ClientManagementPage })))
const EmployeeWorkspace = lazy(() => import('./pages/EmployeeWorkspace').then((module) => ({ default: module.EmployeeWorkspace })))
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
            <Route path="/workspace" element={<EmployeeWorkspace />} />
            <Route path="/admin" element={<AdministrationUnavailable />} />
            <Route path="/admin/organization" element={<OrganizationAdminPage />} />
            <Route path="/people" element={<EmployeeDirectoryPage />} />
            <Route path="/clients" element={<ClientManagementPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/workspace" replace />} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
