import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getTokenFromUrl } from './token'

describe('getTokenFromUrl', () => {
  const originalLocation = window.location

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/register',
        pathname: '/register',
        origin: 'http://localhost',
        search: '',
        hash: '',
      },
      writable: true,
    })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('returns token from path param', () => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/register/abc123token',
        pathname: '/register/abc123token',
        origin: 'http://localhost',
        search: '',
        hash: '',
      },
      writable: true,
    })
    const token = getTokenFromUrl()
    expect(token).toBe('abc123token')
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/register')
  })

  it('returns token from query param', () => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/register?token=xyz789',
        pathname: '/register',
        origin: 'http://localhost',
        search: '?token=xyz789',
        hash: '',
      },
      writable: true,
    })
    const token = getTokenFromUrl()
    expect(token).toBe('xyz789')
    expect(window.history.replaceState).toHaveBeenCalled()
  })

  it('returns null when no token', () => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://localhost/register',
        pathname: '/register',
        origin: 'http://localhost',
        search: '',
        hash: '',
      },
      writable: true,
    })
    const token = getTokenFromUrl()
    expect(token).toBe(null)
  })
})
