import { createContext, useContext, useMemo, type ReactNode } from "react";
import { config } from "../config";

interface OwnerAuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
}

const OwnerAuthContext = createContext<OwnerAuthContextValue | null>(null);

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => {
    const token = config.devOwnerToken ?? null;
    return {
      token,
      isAuthenticated: !!token,
    };
  }, []);
  return (
    <OwnerAuthContext.Provider value={value}>
      {children}
    </OwnerAuthContext.Provider>
  );
}

export function useOwnerAuth(): OwnerAuthContextValue {
  const ctx = useContext(OwnerAuthContext);
  if (!ctx) {
    throw new Error("useOwnerAuth must be used within OwnerAuthProvider");
  }
  return ctx;
}
