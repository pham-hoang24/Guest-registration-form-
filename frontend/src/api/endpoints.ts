import { apiFetch, apiFetchBlob } from './client'
import type { OwnerPropertiesResponse, SubmissionsListResponse } from './contracts'

export interface GuestTokenResponse {
  token: string
}

export async function createGuestToken(
  propertyId: string,
  token: string
): Promise<GuestTokenResponse> {
  return apiFetch<GuestTokenResponse>(
    `/v1/owner/properties/${propertyId}/guest-tokens`,
    { method: 'POST', token }
  )
}

export async function fetchSubmissions(
  propertyId: string,
  token: string
): Promise<SubmissionsListResponse> {
  return apiFetch<SubmissionsListResponse>(
    `/v1/owner/properties/${propertyId}/submissions`,
    { token }
  )
}

export async function downloadPdf(
  submissionId: string,
  token: string
): Promise<Blob> {
  return apiFetchBlob(`/v1/owner/submissions/${submissionId}/pdf`, { token })
}

export async function fetchOwnerProperties(
  token: string
): Promise<OwnerPropertiesResponse> {
  return apiFetch<OwnerPropertiesResponse>('/v1/owner/properties', { token })
}
