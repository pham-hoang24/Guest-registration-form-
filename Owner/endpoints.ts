/**
 * endpoints.ts  (additions / patch)
 *
 * Add fetchOwnerProperties to your existing endpoints.ts file.
 *
 * Assumes:
 *   • A helper `apiFetch` or plain `fetch` is available.
 *   • The Vite dev-proxy or MSW intercepts /api/v1/… in development.
 *   • In production the path resolves to the real backend.
 */

import type { OwnerPropertiesResponse } from "./contracts";

// Adjust to match however you construct base URLs in the rest of the file.
const API_BASE = "/api/v1";

/**
 * GET /v1/owner/properties
 *
 * Returns the list of properties belonging to the authenticated owner.
 *
 * @param token  Bearer JWT from OwnerAuth context.
 */
export async function fetchOwnerProperties(
  token: string
): Promise<OwnerPropertiesResponse> {
  const res = await fetch(`${API_BASE}/owner/properties`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch properties (${res.status}): ${text || res.statusText}`
    );
  }

  return res.json() as Promise<OwnerPropertiesResponse>;
}
