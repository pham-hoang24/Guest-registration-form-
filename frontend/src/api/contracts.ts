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
