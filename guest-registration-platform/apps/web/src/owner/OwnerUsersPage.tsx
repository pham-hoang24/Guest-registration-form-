import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createOwnerUserSchema, type CreateOwnerUserRequest, OWNER_ROLES } from "@gr/shared";
import { ApiError, apiAction, apiGet, apiPatch, apiPost } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import OwnerLayout from "./OwnerLayout.js";

type UserEntry = {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER" | "VIEWER";
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

export default function OwnerUsersPage() {
  const { token, user: me } = useOwnerAuth();
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateOwnerUserRequest>({
    resolver: zodResolver(createOwnerUserSchema),
    defaultValues: { email: "", password: "", role: "MANAGER" },
  });

  const load = () => {
    apiGet<{ users: UserEntry[] }>("/v1/owner/users", token!)
      .then((data) => setUsers(data.users))
      .catch(() => setGlobalError("Failed to load users."));
  };

  useEffect(load, [token]);

  const onCreateUser = handleSubmit(async (data) => {
    setActionError(null);
    try {
      await apiPost("/v1/owner/users", data, token!);
      reset();
      setShowForm(false);
      load();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === "email_already_exists"
          ? "A user with that email already exists."
          : "Failed to create user. Please try again.",
      );
    }
  });

  const changeRole = async (userId: string, role: string) => {
    setActionError(null);
    try {
      await apiPatch(`/v1/owner/users/${userId}/role`, { role }, token!);
      load();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === "last_active_owner"
          ? "Cannot demote the last active owner."
          : "Failed to change role.",
      );
    }
  };

  const toggleStatus = async (user: UserEntry) => {
    setActionError(null);
    const path = `/v1/owner/users/${user.id}/${user.status === "ACTIVE" ? "disable" : "enable"}`;
    try {
      await apiAction(path, token!);
      load();
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.code === "last_active_owner"
          ? "Cannot disable the last active owner."
          : "Failed to update user status.",
      );
    }
  };

  const roleBadge = (role: UserEntry["role"]) => {
    const colours: Record<UserEntry["role"], string> = {
      OWNER: "bg-purple-100 text-purple-800",
      MANAGER: "bg-blue-100 text-blue-800",
      VIEWER: "bg-slate-100 text-slate-700",
    };
    return (
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${colours[role]}`}>{role}</span>
    );
  };

  return (
    <OwnerLayout title="Team members">
      {globalError && <p className="mb-4 text-red-600">{globalError}</p>}

      {me?.role === "OWNER" && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showForm ? "Cancel" : "Add team member"}
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={onCreateUser}
          className="mb-6 space-y-3 rounded-xl bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">New team member</h2>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" className={inputClass} {...register("email")} />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password (min 10 characters)
            </label>
            <input type="password" className={inputClass} {...register("password")} />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select className={inputClass} {...register("role")}>
              {OWNER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Creating…" : "Create user"}
          </button>
        </form>
      )}

      {actionError && !showForm && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      {!users && !globalError && <p className="text-slate-500">Loading…</p>}

      {users && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className={u.status === "DISABLED" ? "opacity-50" : ""}>
                  <td className="px-4 py-3">
                    {u.email}
                    {u.id === me?.id && (
                      <span className="ml-1 text-xs text-slate-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{roleBadge(u.role)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.status === "ACTIVE" ? "text-green-700" : "text-slate-400"
                      }
                    >
                      {u.status === "ACTIVE" ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {me?.role === "OWNER" && u.id !== me?.id && (
                      <div className="flex items-center gap-2">
                        <select
                          value={u.role}
                          onChange={(e) => void changeRole(u.id, e.target.value)}
                          className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                        >
                          {OWNER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void toggleStatus(u)}
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            u.status === "ACTIVE"
                              ? "bg-red-50 text-red-700 hover:bg-red-100"
                              : "bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {u.status === "ACTIVE" ? "Disable" : "Enable"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OwnerLayout>
  );
}
