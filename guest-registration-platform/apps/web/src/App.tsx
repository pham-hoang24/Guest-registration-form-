import { Navigate, Route, Routes } from "react-router-dom";
import { OwnerAuthProvider, RequireOwnerAuth } from "./owner/OwnerAuthContext.js";
import GuestRegistrationPage from "./guest/GuestRegistrationPage.js";
import OwnerLoginPage from "./owner/OwnerLoginPage.js";
import OwnerPropertiesPage from "./owner/OwnerPropertiesPage.js";
import PropertySubmissionsPage from "./owner/PropertySubmissionsPage.js";
import SubmissionDetailPage from "./owner/SubmissionDetailPage.js";

export default function App() {
  return (
    <OwnerAuthProvider>
      <Routes>
        <Route path="/registration/:token" element={<GuestRegistrationPage />} />
        <Route path="/owner/login" element={<OwnerLoginPage />} />
        <Route
          path="/owner/properties"
          element={
            <RequireOwnerAuth>
              <OwnerPropertiesPage />
            </RequireOwnerAuth>
          }
        />
        <Route
          path="/owner/properties/:propertyId/submissions"
          element={
            <RequireOwnerAuth>
              <PropertySubmissionsPage />
            </RequireOwnerAuth>
          }
        />
        <Route
          path="/owner/submissions/:submissionId"
          element={
            <RequireOwnerAuth>
              <SubmissionDetailPage />
            </RequireOwnerAuth>
          }
        />
        <Route path="*" element={<Navigate to="/owner/login" replace />} />
      </Routes>
    </OwnerAuthProvider>
  );
}
