import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";

type OwnerUser = {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER" | "VIEWER";
  tenantId: string;
};

type OwnerAuthState = {
  token: string | null;
  user: OwnerUser | null;
  login: (token: string, user: OwnerUser) => void;
  logout: () => void;
};

const STORAGE_KEY = "gr.owner.session";

const OwnerAuthContext = createContext<OwnerAuthState | null>(null);

function loadSession(): { token: string; user: OwnerUser } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { token: string; user: OwnerUser }) : null;
  } catch {
    return null;
  }
}

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(loadSession);

  const login = useCallback((token: string, user: OwnerUser) => {
    const next = { token, user };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo<OwnerAuthState>(
    () => ({ token: session?.token ?? null, user: session?.user ?? null, login, logout }),
    [session, login, logout],
  );

  return <OwnerAuthContext.Provider value={value}>{children}</OwnerAuthContext.Provider>;
}

export function useOwnerAuth(): OwnerAuthState {
  const context = useContext(OwnerAuthContext);
  if (!context) throw new Error("useOwnerAuth must be used inside OwnerAuthProvider");
  return context;
}

export function RequireOwnerAuth({ children }: { children: ReactNode }) {
  const { token } = useOwnerAuth();
  if (!token) return <Navigate to="/owner/login" replace />;
  return <>{children}</>;
}
