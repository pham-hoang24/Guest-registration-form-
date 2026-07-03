import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOwnerAuth } from "./OwnerAuthContext.js";

export default function OwnerLayout({ title, children }: { title: string; children: ReactNode }) {
  const { user, logout } = useOwnerAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center gap-4">
          <Link to="/owner/properties" className="font-bold text-slate-900">
            Guest Registration
          </Link>
          <Link to="/owner/users" className="text-sm text-slate-500 hover:text-slate-900">
            Team
          </Link>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          {user && (
            <span>
              {user.email} · <span className="font-medium">{user.role}</span>
            </span>
          )}
          <button
            onClick={() => {
              logout();
              navigate("/owner/login");
            }}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-bold text-slate-900">{title}</h1>
        {children}
      </main>
    </div>
  );
}
