import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";

export default function OwnerLoginPage() {
  const { login } = useOwnerAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{
        user: { id: string; email: string; role: "OWNER" | "MANAGER" | "VIEWER"; tenantId: string };
        csrfToken: string;
      }>("/v1/owner/auth/login", { email, password });
      login(result.user, result.csrfToken);
      navigate("/owner/properties");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <h1 className="mb-4 text-xl font-bold text-slate-900">Owner login</h1>
        {error && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2"
          autoComplete="username"
          required
        />
        <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2"
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
