import { Router } from "express";
import bcrypt from "bcryptjs";
import { writeAudit } from "@gr/db";
import { createOwnerUserSchema, updateOwnerUserRoleSchema } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { requireRole } from "../middleware/rbac.js";

const BCRYPT_ROUNDS = 12;

/** Returns true when the tenant has at least one other ACTIVE OWNER besides targetUserId. */
async function hasAnotherActiveOwner(
  db: AppDeps["db"],
  tenantId: string,
  excludeUserId: string,
): Promise<boolean> {
  const count = await db.ownerUser.count({
    where: { tenantId, role: "OWNER", status: "ACTIVE", NOT: { id: excludeUserId } },
  });
  return count > 0;
}

export function ownerUserRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  // All routes require OWNER role.
  router.use(requireRole(deps, "OWNER"));

  /** List all users in the requester's tenant. */
  router.get("/", async (req, res, next) => {
    try {
      const { tenantId } = req.auth!;
      const users = await db.ownerUser.findMany({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  /** Create a new owner user in the requester's tenant. */
  router.post("/", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const parsed = createOwnerUserSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }
      const { email, password, role } = parsed.data;

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      let user;
      try {
        user = await db.ownerUser.create({
          data: { tenantId: auth.tenantId, email, passwordHash, role },
          select: { id: true, email: true, role: true, status: true, createdAt: true },
        });
      } catch (err: unknown) {
        // Prisma unique violation: P2002
        if (
          err != null &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          sendError(res, 409, "email_already_exists");
          return;
        }
        throw err;
      }

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_CREATED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
        metadata: { email, role },
      });

      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  });

  /** Change a user's role. Cannot demote the last active OWNER. */
  router.patch("/:userId/role", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const parsed = updateOwnerUserRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }
      const { role } = parsed.data;

      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }

      // Prevent demoting the last active OWNER.
      if (target.role === "OWNER" && role !== "OWNER") {
        if (!(await hasAnotherActiveOwner(db, auth.tenantId, target.id))) {
          sendError(res, 409, "last_active_owner");
          return;
        }
      }

      const updated = await db.ownerUser.update({
        where: { id: target.id },
        data: { role },
        select: { id: true, email: true, role: true, status: true },
      });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_ROLE_CHANGED",
        resourceType: "OwnerUser",
        resourceId: target.id,
        ...auditMetaFromRequest(req),
        metadata: { previousRole: target.role, newRole: role },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  /** Disable a user. Cannot disable the last active OWNER. */
  router.post("/:userId/disable", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }
      if (target.status === "DISABLED") {
        sendError(res, 409, "already_disabled");
        return;
      }
      if (target.role === "OWNER" && !(await hasAnotherActiveOwner(db, auth.tenantId, target.id))) {
        sendError(res, 409, "last_active_owner");
        return;
      }

      await db.ownerUser.update({ where: { id: target.id }, data: { status: "DISABLED" } });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_DISABLED",
        resourceType: "OwnerUser",
        resourceId: target.id,
        ...auditMetaFromRequest(req),
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  /** Re-enable a disabled user. */
  router.post("/:userId/enable", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }
      if (target.status === "ACTIVE") {
        sendError(res, 409, "already_active");
        return;
      }

      await db.ownerUser.update({ where: { id: target.id }, data: { status: "ACTIVE" } });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_ENABLED",
        resourceType: "OwnerUser",
        resourceId: target.id,
        ...auditMetaFromRequest(req),
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
