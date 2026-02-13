/**
 * App configuration. Reads from VITE_* env vars.
 * Fails fast with clear errors for required vars.
 */

function optionalEnv(name: string): string | undefined {
  const value = import.meta.env[name]
  return value === undefined || value === '' ? undefined : String(value)
}

export const config = {
  /** API base URL. In dev with proxy, use '' or '/api'. */
  apiBaseUrl: (() => {
    const v = optionalEnv('VITE_API_BASE_URL')
    if (v !== undefined) return v.replace(/\/$/, '')
    if (import.meta.env.DEV) return '/api'
    throw new Error(
      'VITE_API_BASE_URL is required in production. Set it in .env.'
    )
  })(),

  /** App base URL for building guest links (e.g. https://app.example.com). */
  appBaseUrl: (() => {
    const v = optionalEnv('VITE_APP_BASE_URL')
    if (v !== undefined) return v.replace(/\/$/, '')
    if (import.meta.env.DEV) return 'http://localhost:5173'
    throw new Error(
      'VITE_APP_BASE_URL is required in production for guest links.'
    )
  })(),

  /** Dev-only: owner JWT for testing owner APIs without OIDC. */
  devOwnerToken: optionalEnv('VITE_DEV_OWNER_TOKEN'),

  /** OIDC (optional, for Phase 2). */
  oidc: {
    issuer: optionalEnv('VITE_OIDC_ISSUER'),
    clientId: optionalEnv('VITE_OIDC_CLIENT_ID'),
    redirectUri: optionalEnv('VITE_OIDC_REDIRECT_URI'),
  },
} as const
