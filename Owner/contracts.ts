/**
 * contracts.ts  (additions / patch)
 *
 * Add the following types to your existing contracts.ts file.
 * If you have a barrel export, re-export from there too.
 */

// ---------------------------------------------------------------------------
// Owner – Properties
// ---------------------------------------------------------------------------

/**
 * A property owned by the authenticated owner.
 * `name` and `address` are optional; the backend may return only `id` when no
 * property-metadata table exists yet.
 */
export interface Property {
  id: string;
  name?: string;
  address?: string;
}

export interface OwnerPropertiesResponse {
  properties: Property[];
}
