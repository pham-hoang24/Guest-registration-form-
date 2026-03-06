/**
 * handlers.ts  (additions / patch)
 *
 * Add the handler below to your existing MSW handlers array in
 *   frontend/src/mocks/handlers.ts
 *
 * Import http and HttpResponse from 'msw' (v2) or rest from 'msw' (v1).
 * The snippet below uses MSW v2 syntax.  Adjust if you are on v1.
 */

import { http, HttpResponse } from "msw";
import type { OwnerPropertiesResponse } from "../api/contracts";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockProperties: OwnerPropertiesResponse = {
  properties: [
    {
      id: "prop-1",
      name: "Riverside Apartments – Unit 4A",
      address: "12 Riverside Drive, Helsinki, 00100",
    },
    {
      id: "prop-2",
      name: "Old Town Studio",
      address: "3 Aleksanterinkatu, Helsinki, 00170",
    },
  ],
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/owner/properties
 *
 * Validates the Authorization header exists (any non-empty value accepted in
 * dev/test) and returns the mock property list.
 */
export const ownerPropertiesHandler = http.get(
  "/api/v1/owner/properties",
  ({ request }) => {
    const auth = request.headers.get("Authorization");

    if (!auth) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return HttpResponse.json(mockProperties);
  }
);

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
// In your handlers array:
//
//   import { ownerPropertiesHandler } from "./ownerPropertiesHandler";
//
//   export const handlers = [
//     ...existingHandlers,
//     ownerPropertiesHandler,
//   ];
