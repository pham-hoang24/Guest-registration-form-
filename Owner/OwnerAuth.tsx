/**
 * OwnerAuth.tsx
 *
 * Provides authentication state for the owner dashboard.
 *
 * Priority order for initial token:
 *   1. sessionStorage (persisted from a previous manual login in this browser session)
 *   2. VITE_DEV_OWNER_TOKEN env var (dev convenience)
 *
 * Exposes:
 *   token          – current JWT string or null
 *   isAuthenticated – true when token is non-null
 *   setToken(t)    – persist a new token (updates state + sessionStorage)
 *   logout()       – clear token from state + sessionStorage
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import config from "../config"; // adjust path if your config lives elsewhere

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OwnerAuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  setToken: (token: string | null) => void;
  logout: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "owner_auth_token";

function readInitialToken(): string | null {
  // 1. Session storage (survives page refresh within the same tab session)
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
  } catch {
    // sessionStorage may be blocked in some environments
  }

  // 2. Dev env token
  const devToken = (config as Record<string, unknown>).devOwnerToken as
    | string
    | undefined;
  if (devToken) return devToken;

  return null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const OwnerAuthContext = createContext<OwnerAuthContextValue | null>(null);

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(readInitialToken);

  const setToken = useCallback((newToken: string | null) => {
    setTokenState(newToken);
    try {
      if (newToken) {
        sessionStorage.setItem(SESSION_KEY, newToken);
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
  }, [setToken]);

  const value = useMemo<OwnerAuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      setToken,
      logout,
    }),
    [token, setToken, logout]
  );

  return (
    <OwnerAuthContext.Provider value={value}>
      {children}
    </OwnerAuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOwnerAuth(): OwnerAuthContextValue {
  const ctx = useContext(OwnerAuthContext);
  if (!ctx) {
    throw new Error("useOwnerAuth must be used inside <OwnerAuthProvider>");
  }
  return ctx;
}
