import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { OwnerAuthProvider } from './contexts/OwnerAuth'
import { useOwnerAuth } from './contexts/OwnerAuth'
import { Register } from './pages/Register'
import { SubmissionsList } from './pages/SubmissionsList'
import { OwnerLogin } from './pages/OwnerLogin'
import { OwnerDashboardHome } from './pages/OwnerDashboardHome'
import { OwnerDashboardLayout } from './layouts/OwnerDashboardLayout'

/** Redirects unauthenticated users to /owner/login, preserving the target URL. */
function OwnerRequireAuth() {
  const { isAuthenticated } = useOwnerAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    return <Navigate to="/owner/login" state={{ from: location }} replace />
  }
  return <Outlet />
}

function App() {
  return (
    <OwnerAuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Guest form */}
          <Route path="/register/:token?" element={<Register />} />
          <Route path="/" element={<Register />} />

          {/* Owner — unprotected login */}
          <Route path="/owner/login" element={<OwnerLogin />} />

          {/* Owner — protected dashboard */}
          <Route path="/owner" element={<OwnerRequireAuth />}>
            <Route element={<OwnerDashboardLayout />}>
              <Route index element={<OwnerDashboardHome />} />
              <Route
                path="properties/:propertyId/submissions"
                element={<SubmissionsList />}
              />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </OwnerAuthProvider>
  )
}

export default App
