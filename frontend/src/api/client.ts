import { config } from '../config'
import { normalizeError } from './errors'
import type { ApiError as ApiErrorShape } from './errors'

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: object
  token?: string
}

/**
 * Fetch with base URL, JSON handling, and error normalization.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, token, headers: userHeaders, ...rest } = options
  const url = path.startsWith('http') ? path : `${config.apiBaseUrl}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(userHeaders as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(url, {
    ...rest,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const requestId =
    res.headers.get('x-request-id') ?? res.headers.get('x-correlation-id') ?? undefined
  const ct = res.headers.get('content-type') ?? ''

  if (!res.ok) {
    let parsed: unknown
    try {
      if (ct.includes('application/json')) {
        parsed = await res.json()
      } else {
        parsed = await res.text()
      }
    } catch {
      parsed = null
    }
    const err = normalizeError(res.status, parsed, requestId) as ApiErrorShape
    throw new ApiError(err)
  }

  if (res.status === 204 || (res.headers.get('content-length') === '0' && !res.body)) {
    return undefined as T
  }

  if (ct.includes('application/json')) {
    return res.json() as Promise<T>
  }

  return res as unknown as T
}

/**
 * Fetch binary (e.g. PDF). Returns blob.
 */
export async function apiFetchBlob(
  path: string,
  options: Omit<ApiFetchOptions, 'body'> = {}
): Promise<Blob> {
  const { token, headers: userHeaders, ...rest } = options
  const url = path.startsWith('http') ? path : `${config.apiBaseUrl}${path}`
  const headers: Record<string, string> = {
    ...(userHeaders as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const res = await fetch(url, { ...rest, headers })
  const requestId =
    res.headers.get('x-request-id') ?? res.headers.get('x-correlation-id') ?? undefined

  if (!res.ok) {
    let parsed: unknown
    try {
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        parsed = await res.json()
      } else {
        parsed = await res.text()
      }
    } catch {
      parsed = null
    }
    const err = normalizeError(res.status, parsed, requestId) as ApiErrorShape
    throw new ApiError(err)
  }

  return res.blob()
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors?: Record<string, string>
  readonly requestId?: string

  constructor(err: { status: number; code: string; message: string; fieldErrors?: Record<string, string>; requestId?: string }) {
    super(err.message)
    this.name = 'ApiError'
    this.status = err.status
    this.code = err.code
    this.fieldErrors = err.fieldErrors
    this.requestId = err.requestId
  }
}

