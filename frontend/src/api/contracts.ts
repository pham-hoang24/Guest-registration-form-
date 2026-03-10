/**
 * Stable API response contracts. UI stays resilient if backend changes.
 */

export interface RegistrationResponse {
  submissionId: string
  status?: string
}

export interface SubmissionSummary {
  id: string
  createdAt: string
  status: string
}

export interface SubmissionsListResponse {
  submissions: SubmissionSummary[]
}

// ---------------------------------------------------------------------------
// Owner — Properties
// ---------------------------------------------------------------------------

/**
 * A property owned by the authenticated owner.
 * `name` and `address` are optional display fields.
 */
export interface Property {
  id: string
  name?: string
  address?: string
}

export interface OwnerPropertiesResponse {
  properties: Property[]
}
