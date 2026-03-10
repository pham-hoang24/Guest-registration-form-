import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useOwnerAuth } from '../contexts/OwnerAuth'
import { fetchOwnerProperties } from '../api/endpoints'
import type { Property } from '../api/contracts'

function BuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function PropertyCard({ property }: { property: Property }) {
  return (
    <Link
      to={`/owner/properties/${property.id}/submissions`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        background: 'var(--paper, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 10,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        gap: '1rem',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: 'var(--cream, #f8f7f4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent, #2563eb)',
          flexShrink: 0,
        }}
      >
        <BuildingIcon />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--ink, #1a1a2e)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {property.name ?? `Property ${property.id}`}
        </div>
        {property.address && (
          <div
            style={{
              fontSize: '0.78rem',
              color: 'var(--muted, #6b7280)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {property.address}
          </div>
        )}
        <div style={{ fontSize: '0.72rem', color: 'var(--muted, #6b7280)', marginTop: 2 }}>
          ID: {property.id}
        </div>
      </div>

      <div style={{ color: 'var(--muted, #9ca3af)', flexShrink: 0 }}>
        <ChevronRightIcon />
      </div>
    </Link>
  )
}

type LoadState = 'idle' | 'loading' | 'success' | 'error'

export function OwnerDashboardHome() {
  const { token } = useOwnerAuth()
  const [properties, setProperties] = useState<Property[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoadState('loading')

    fetchOwnerProperties(token)
      .then((data) => {
        if (cancelled) return
        setProperties(data.properties)
        setLoadState('success')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load properties.')
        setLoadState('error')
      })

    return () => { cancelled = true }
  }, [token])

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: 'var(--ink, #1a1a2e)', letterSpacing: '-0.02em' }}>
          Dashboard
        </h1>
        <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: 'var(--muted, #6b7280)' }}>
          Select a property to view guest submissions.
        </p>
      </div>

      {loadState === 'loading' && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6b7280)', fontSize: '0.85rem' }}>
          Loading properties…
        </div>
      )}

      {loadState === 'error' && (
        <div style={{ padding: '1rem 1.25rem', background: 'var(--paper, #fff)', border: '1px solid #fca5a5', borderRadius: 10, color: 'var(--danger, #dc2626)', fontSize: '0.85rem' }}>
          {errorMsg ?? 'An error occurred.'}
        </div>
      )}

      {loadState === 'success' && properties.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--paper, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 10, color: 'var(--muted, #6b7280)', fontSize: '0.85rem' }}>
          No properties found for this account.
        </div>
      )}

      {loadState === 'success' && properties.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </div>
      )}
    </div>
  )
}

export default OwnerDashboardHome
