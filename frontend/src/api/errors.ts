/**
 * API error normalization and user-facing message mapping.
 * Do not hardcode backend error shapes; normalize everything.
 */

export interface ApiError {
  status: number
  code: string
  message: string
  fieldErrors?: Record<string, string>
  requestId?: string
}

/**
 * Parse multiple error shapes into ApiError.
 */
export function normalizeError(
  status: number,
  body: unknown,
  requestId?: string
): ApiError {
  const base: ApiError = {
    status,
    code: 'unknown',
    message: 'An unexpected error occurred.',
    requestId,
  }

  if (body === null || body === undefined) {
    return { ...base, code: `http_${status}` }
  }

  if (typeof body === 'string') {
    if (body.trim().startsWith('<')) {
      return { ...base, code: 'server_error', message: 'Server returned an error.' }
    }
    return { ...base, message: body.slice(0, 200) }
  }

  if (typeof body !== 'object') {
    return base
  }

  const obj = body as Record<string, unknown>

  // { code, message, issues }
  const code = String(obj.code ?? obj.error ?? 'unknown')
  const rawMessage = obj.message
  const message =
    typeof rawMessage === 'string'
      ? rawMessage
      : base.message

  // { error: { code, message } }
  const nested = obj.error as Record<string, unknown> | undefined
  const nestedCode =
    nested && typeof nested === 'object'
      ? String(nested.code ?? nested.error ?? code)
      : code
  const nestedMessage =
    nested && typeof nested === 'object' && typeof nested.message === 'string'
      ? nested.message
      : message

  // issues -> fieldErrors
  const issues = obj.issues as Array<{ path?: string | string[]; message?: string }> | undefined
  let fieldErrors: Record<string, string> | undefined
  if (Array.isArray(issues)) {
    fieldErrors = {}
    for (const i of issues) {
      const path = typeof i.path === 'string' ? i.path : Array.isArray(i.path) ? i.path.join('.') : ''
      if (path && typeof i.message === 'string') {
        fieldErrors[path] = i.message
      }
    }
  }

  return {
    status,
    code: nestedCode || code,
    message: nestedMessage || message,
    fieldErrors: fieldErrors && Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    requestId,
  }
}

/**
 * Centralized mapping from error code to user-facing message.
 */
export function toUserMessage(code: string): string {
  const map: Record<string, string> = {
    missing_token: 'Registration link is invalid or expired.',
    invalid_token: 'Registration link is invalid or expired.',
    token_replay: 'This registration has already been submitted.',
    invalid_request: 'Please check the form and fix any errors.',
    unauthorized: 'Please sign in to continue.',
    forbidden: 'You do not have access to this resource.',
    not_found: 'The requested resource was not found.',
    not_ready: 'The document is not ready yet. Please try again later.',
    missing_blob: 'The document could not be found.',
    payload_encryption_failed: 'Unable to save your registration. Please try again.',
    payload_storage_failed: 'Unable to save your registration. Please try again.',
    decrypt_failed: 'Unable to download the document. Please try again.',
    internal_error: 'Something went wrong. Please try again.',
  }
  return map[code] ?? 'Something went wrong. Please try again.'
}
