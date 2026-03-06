/**
 * backend/src/routes/owner.ts  (additions / patch)
 *
 * Add the route below to your existing owner router.
 * It sits alongside the existing GET /submissions/:id/pdf route.
 *
 * Assumes:
 *   • `router` is an Express Router already set up in this file.
 *   • `getOwnerFromRequest(req)` resolves the owner from the Bearer JWT and
 *     returns an object with at least `{ propertyIds: string[] }`, or throws /
 *     returns null/undefined when the token is invalid.
 *   • You have some way to optionally look up property metadata
 *     (name, address) — if not, we fall back to returning `{ id }` only.
 */

import { Request, Response, Router } from "express";

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface PropertyRecord {
  id: string;
  name?: string;
  address?: string;
}

// ---------------------------------------------------------------------------
// GET /v1/owner/properties
// ---------------------------------------------------------------------------

/**
 * Returns the list of properties belonging to the authenticated owner.
 *
 * Response body:
 *   { properties: Array<{ id, name?, address? }> }
 *
 * Errors:
 *   401 – missing or invalid token
 *   500 – unexpected server error
 */
async function getOwnerProperties(req: Request, res: Response): Promise<void> {
  try {
    // Reuse the existing helper that validates the Bearer token and returns the
    // owner record.  Adjust the import/call to match your actual implementation.
    const owner = await getOwnerFromRequest(req);

    if (!owner) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const propertyIds: string[] = owner.propertyIds ?? [];

    // ------------------------------------------------------------------
    // Optional: enrich with property metadata from DB
    // ------------------------------------------------------------------
    // If you have a Property model / table, you can do something like:
    //
    //   const records = await PropertyModel.findAll({
    //     where: { id: { [Op.in]: propertyIds } },
    //     attributes: ["id", "name", "address"],
    //   });
    //   const properties: PropertyRecord[] = records.map((r) => r.toJSON());
    //
    // For now we return stub objects so the frontend can render something
    // useful without a property-metadata table:
    // ------------------------------------------------------------------

    const properties: PropertyRecord[] = propertyIds.map((id) => ({ id }));

    res.json({ properties });
  } catch (err) {
    console.error("[owner] GET /properties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Register the route
// ---------------------------------------------------------------------------
//
// In your router setup (wherever you currently have the PDF route):
//
//   router.get("/properties", getOwnerProperties);
//
// Full example of what the patched router might look like:
//
//   const router = Router();
//
//   // existing
//   router.get("/submissions/:id/pdf", getOwnerSubmissionPdf);
//
//   // new
//   router.get("/properties", getOwnerProperties);
//
//   export default router;

export { getOwnerProperties };

// ---------------------------------------------------------------------------
// Stub – remove once you import the real helper
// ---------------------------------------------------------------------------
// This stub keeps TypeScript happy in isolation.  Replace with your real import:
//   import { getOwnerFromRequest } from "../middleware/ownerAuth";

async function getOwnerFromRequest(
  req: Request
): Promise<{ propertyIds: string[] } | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  // Real impl: verify JWT, look up owner record, return it.
  throw new Error(
    "Replace this stub with your real getOwnerFromRequest implementation."
  );
}
