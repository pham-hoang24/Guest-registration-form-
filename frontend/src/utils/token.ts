/**
 * Extract guest token from URL and sanitize to prevent leakage.
 * Call once on load; token is removed from URL via replaceState.
 */

/**
 * Read token from URL (path param or query), then remove it from the URL.
 * Safe to call multiple times; replaceState is idempotent for the final path.
 */
export function getTokenFromUrl(): string | null {
  const url = new URL(window.location.href)
  const pathname = window.location.pathname

  // Path param: /register/:token
  const pathMatch = pathname.match(/^\/register\/([^/]+)$/)
  if (pathMatch) {
    const token = decodeURIComponent(pathMatch[1])
    sanitizeUrl('/register')
    return token || null
  }

  // Query: /register?token=...
  const queryToken = url.searchParams.get('token')
  if (queryToken) {
    url.searchParams.delete('token')
    const clean = url.pathname + url.search + url.hash
    sanitizeUrl(clean)
    return queryToken || null
  }

  return null
}

/**
 * Replace current URL without token. Reduces leakage via history/referrer/logs.
 */
function sanitizeUrl(path: string): void {
  const url = new URL(path, window.location.origin)
  const clean = url.pathname + url.search + url.hash
  window.history.replaceState({}, '', clean)
}
