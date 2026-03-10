import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useOwnerAuth } from '../contexts/OwnerAuth'
import { Button } from '../components'

export function OwnerLogin() {
  const { isAuthenticated, setToken } = useOwnerAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/owner'

  if (isAuthenticated) {
    navigate(from, { replace: true })
    return null
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [jwtValue, setJwtValue] = useState('')
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = jwtValue.trim()
    if (!trimmed) {
      setError('Please paste a JWT token first.')
      return
    }
    setError(null)
    setToken(trimmed)
    navigate(from, { replace: true })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--cream, #f8f7f4)',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--paper, #fff)',
          borderRadius: 12,
          boxShadow: '0 2px 16px rgba(0,0,0,.08)',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        <div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--ink, #1a1a2e)', letterSpacing: '-0.02em' }}>
            PropVault
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted, #6b7280)', marginTop: 2 }}>
            Owner dashboard
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border, #e5e7eb)' }} />

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink, #1a1a2e)' }}>
              Owner JWT
            </label>
            <textarea
              value={jwtValue}
              onChange={(e) => setJwtValue(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              rows={4}
              style={{
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border, #d1d5db)',
                borderRadius: 6,
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                resize: 'vertical',
                background: 'var(--paper, #fff)',
                color: 'var(--ink, #1a1a2e)',
              }}
            />
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--danger, #dc2626)' }}>
              {error}
            </p>
          )}

          <Button type="submit" style={{ alignSelf: 'flex-end' }}>
            Sign in
          </Button>
        </form>

        {import.meta.env.DEV && (
          <p
            style={{
              margin: 0,
              fontSize: '0.75rem',
              color: 'var(--muted, #6b7280)',
              background: 'var(--cream, #f8f7f4)',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
            }}
          >
            <strong>Dev tip:</strong> Set <code>VITE_DEV_OWNER_TOKEN</code> in your{' '}
            <code>.env</code> file to skip this form.
          </p>
        )}
      </div>
    </div>
  )
}

export default OwnerLogin
