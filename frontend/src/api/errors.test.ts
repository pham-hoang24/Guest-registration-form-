import { describe, it, expect } from 'vitest'
import { normalizeError, toUserMessage } from './errors'

describe('normalizeError', () => {
  it('handles { code, message } shape', () => {
    const err = normalizeError(401, { code: 'invalid_token', message: 'Bad token' })
    expect(err.status).toBe(401)
    expect(err.code).toBe('invalid_token')
    expect(err.message).toBe('Bad token')
  })

  it('handles { error: { code, message } } nested shape', () => {
    const err = normalizeError(403, { error: { code: 'forbidden', message: 'Access denied' } })
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe('Access denied')
  })

  it('handles { code, message, issues } with field errors', () => {
    const err = normalizeError(400, {
      code: 'invalid_request',
      message: 'Validation failed',
      issues: [{ path: 'fullName', message: 'Required' }, { path: ['payload', 'email'], message: 'Invalid email' }],
    })
    expect(err.fieldErrors).toBeDefined()
    expect(err.fieldErrors?.fullName).toBe('Required')
    expect(err.fieldErrors?.['payload.email']).toBe('Invalid email')
  })

  it('handles plain text body', () => {
    const err = normalizeError(500, 'Internal Server Error')
    expect(err.message).toContain('Internal Server Error')
  })

  it('handles null body', () => {
    const err = normalizeError(502, null)
    expect(err.code).toBe('http_502')
    expect(err.message).toBe('An unexpected error occurred.')
  })
})

describe('toUserMessage', () => {
  it('returns known messages for known codes', () => {
    expect(toUserMessage('invalid_token')).toContain('invalid')
    expect(toUserMessage('token_replay')).toContain('already')
    expect(toUserMessage('unauthorized')).toContain('sign in')
    expect(toUserMessage('forbidden')).toContain('access')
  })

  it('returns generic message for unknown codes', () => {
    expect(toUserMessage('unknown_code')).toBe('Something went wrong. Please try again.')
  })
})
