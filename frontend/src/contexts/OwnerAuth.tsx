import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { config } from '../config'

const SESSION_KEY = 'owner_auth_token'

function readInitialToken(): string | null {
  // Priority: sessionStorage > dev env var (dev builds only) > null
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored) return stored
  } catch {
    // sessionStorage unavailable (e.g., SSR or privacy mode)
  }
  // Only accept the dev token in development builds.
  // Guarding with import.meta.env.DEV ensures the fallback is tree-shaken
  // out of production bundles so a stale .env value can't pre-authenticate users.
  if (import.meta.env.DEV) {
    return config.devOwnerToken ?? null
  }
  return null
}

export interface OwnerAuthContextValue {
  token: string | null
  isAuthenticated: boolean
  setToken: (token: string) => void
  logout: () => void
}

const OwnerAuthContext = createContext<OwnerAuthContextValue | null>(null)

export function OwnerAuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(readInitialToken)

  const setToken = useCallback((t: string) => {
    try {
      sessionStorage.setItem(SESSION_KEY, t)
    } catch {
      // ignore if unavailable
    }
    setTokenState(t)
  }, [])

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // ignore
    }
    setTokenState(null)
  }, [])

  const value = useMemo<OwnerAuthContextValue>(
    () => ({ token, isAuthenticated: !!token, setToken, logout }),
    [token, setToken, logout]
  )

  return <OwnerAuthContext.Provider value={value}>{children}</OwnerAuthContext.Provider>
}

export function useOwnerAuth(): OwnerAuthContextValue {
  const ctx = useContext(OwnerAuthContext)
  if (!ctx) throw new Error('useOwnerAuth must be used within OwnerAuthProvider')
  return ctx
}
