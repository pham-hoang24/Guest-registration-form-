import { z } from "zod";

export const ownerLoginRequestSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export type OwnerLoginRequest = z.infer<typeof ownerLoginRequestSchema>;

export const OWNER_ROLES = ["OWNER", "MANAGER", "VIEWER"] as const;
export type OwnerRoleName = (typeof OWNER_ROLES)[number];

/** Roles allowed to download decrypted PDFs. VIEWER sees metadata only. */
export const PDF_DOWNLOAD_ROLES: readonly OwnerRoleName[] = ["OWNER", "MANAGER"];
