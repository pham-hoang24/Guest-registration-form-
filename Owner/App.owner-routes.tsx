/**
 * App.tsx  (owner-routes patch)
 *
 * Replace / extend the owner section of your <Routes> tree with the snippet
 * below.  Everything outside the owner routes remains unchanged.
 *
 * New route tree:
 *
 *   /owner/login                 → OwnerLogin        (no shell, no auth guard)
 *   /owner                       → OwnerRequireAuth  (guard)
 *     /owner                     → OwnerDashboardLayout (shell)
 *       index                    → OwnerDashboardHome
 *       /owner/properties/:propertyId/submissions → SubmissionsList
 */

// ---------------------------------------------------------------------------
// 1.  Add these imports (merge with your existing import block)
// ---------------------------------------------------------------------------

import React from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

// New files added in this ticket
import OwnerLogin from "./pages/OwnerLogin";
import OwnerDashboardLayout from "./layouts/OwnerDashboardLayout";
import OwnerDashboardHome from "./pages/OwnerDashboardHome";

// Existing page — keep your current import
import SubmissionsList from "./pages/SubmissionsList"; // adjust path as needed

// Auth context
import { useOwnerAuth } from "./contexts/OwnerAuth";

// ---------------------------------------------------------------------------
// 2.  Route-guard component (add near the top of App.tsx or in its own file)
// ---------------------------------------------------------------------------

/**
 * Wraps owner routes that require authentication.
 * Unauthenticated requests are redirected to /owner/login, with the original
 * location stored so we can redirect back after login.
 */
function OwnerRequireAuth() {
  const { isAuthenticated } = useOwnerAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate to="/owner/login" state={{ from: location }} replace />
    );
  }

  return <Outlet />;
}

// ---------------------------------------------------------------------------
// 3.  Routes snippet — replace your existing owner <Route> block with this
// ---------------------------------------------------------------------------

/*
  Inside your top-level <Routes> (or wherever your router is configured):

  <Routes>
    {/* ...other app routes... *\/}

    {/* Owner: unprotected login *\/}
    <Route path="/owner/login" element={<OwnerLogin />} />

    {/* Owner: auth guard *\/}
    <Route path="/owner" element={<OwnerRequireAuth />}>
      {/* Owner: dashboard shell *\/}
      <Route element={<OwnerDashboardLayout />}>
        {/* /owner  → dashboard home *\/}
        <Route index element={<OwnerDashboardHome />} />

        {/* /owner/properties/:propertyId/submissions *\/}
        <Route
          path="properties/:propertyId/submissions"
          element={<SubmissionsList />}
        />
      </Route>
    </Route>
  </Routes>
*/

// ---------------------------------------------------------------------------
// 4.  Minimal standalone example (for reference / testing)
// ---------------------------------------------------------------------------

export default function AppOwnerRoutes() {
  return (
    <Routes>
      {/* Unprotected */}
      <Route path="/owner/login" element={<OwnerLogin />} />

      {/* Protected */}
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
  );
}
