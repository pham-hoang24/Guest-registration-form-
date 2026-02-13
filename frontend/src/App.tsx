import { BrowserRouter, Routes, Route } from "react-router-dom";
import { OwnerAuthProvider } from "./contexts/OwnerAuth";
import { Register } from "./pages/Register";
import { SubmissionsList } from "./pages/SubmissionsList";

function App() {
  return (
    <OwnerAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/register/:token?" element={<Register />} />
          <Route
            path="/owner/properties/:propertyId/submissions"
            element={<SubmissionsList />}
          />
          <Route path="/" element={<Register />} />
        </Routes>
      </BrowserRouter>
    </OwnerAuthProvider>
  );
}

export default App;
