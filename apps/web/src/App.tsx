import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { PublicOnlyRoute } from './auth/PublicOnlyRoute'
import { AdministrationUnavailable } from './pages/AdministrationUnavailable'
import { EmployeeWorkspace } from './pages/EmployeeWorkspace'
import { InvitationAcceptance } from './pages/InvitationAcceptance'
import { Login } from './pages/Login'
import { PasswordReset } from './pages/PasswordReset'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/password-reset" element={<PasswordReset />} />
          <Route path="/invitations/accept" element={<InvitationAcceptance />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/workspace" element={<EmployeeWorkspace />} />
          <Route path="/admin" element={<AdministrationUnavailable />} />
        </Route>
        <Route path="/" element={<Navigate to="/workspace" replace />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
