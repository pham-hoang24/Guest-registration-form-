import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate } from "react-router-dom";
import { apiGet, apiAction } from "../api/client.js";

type OwnerUser = {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER" | "VIEWER";
  tenantId: string;
};

type OwnerAuthState = {
  user: OwnerUser | null;
  /** Undefined until the initial session check (GET /me) resolves. */
  ready: boolean;
  login: (user: OwnerUser) => void;
  logout: () => void;
};

const OwnerAuthContext = createContext<OwnerAuthState | null>(null);

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OwnerUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiGet<OwnerUser>("/v1/owner/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback((nextUser: OwnerUser) => {
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    apiAction("/v1/owner/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<OwnerAuthState>(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout],
  );

  return <OwnerAuthContext.Provider value={value}>{children}</OwnerAuthContext.Provider>;
}

export function useOwnerAuth(): OwnerAuthState {
  const context = useContext(OwnerAuthContext);
  if (!context) throw new Error("useOwnerAuth must be used inside OwnerAuthProvider");
  return context;
}

export function RequireOwnerAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useOwnerAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/owner/login" replace />;
  return <>{children}</>;
}
