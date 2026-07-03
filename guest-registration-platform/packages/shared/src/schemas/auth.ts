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

export const createOwnerUserSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200),
  role: z.enum(OWNER_ROLES),
});
export type CreateOwnerUserRequest = z.infer<typeof createOwnerUserSchema>;

export const updateOwnerUserRoleSchema = z.object({
  role: z.enum(OWNER_ROLES),
});
export type UpdateOwnerUserRoleRequest = z.infer<typeof updateOwnerUserRoleSchema>;
