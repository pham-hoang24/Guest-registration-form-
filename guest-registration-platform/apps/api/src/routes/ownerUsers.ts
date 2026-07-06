import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { writeAudit, type OwnerRole } from "@gr/db";
import { ownerUserCreateRequestSchema, ownerUserRoleUpdateRequestSchema } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";

async function auditUnauthorizedAccess(deps: AppDeps, req: Request, resourceId?: string): Promise<void> {
  try {
    await writeAudit(deps.db, {
      tenantId: req.auth?.tenantId ?? null,
      actorType: "OWNER",
      actorId: req.auth?.userId ?? null,
      action: "UNAUTHORIZED_ACCESS_ATTEMPT",
      resourceType: "OwnerUser",
      resourceId: resourceId ?? null,
      ...auditMetaFromRequest(req),
      metadata: {
        route: req.originalUrl,
        role: req.auth?.role ?? "UNKNOWN",
      },
    });
  } catch {
    // Best effort only for denied requests.
  }
}

async function activeOwnerCount(deps: AppDeps, tenantId: string): Promise<number> {
  return deps.db.ownerUser.count({ where: { tenantId, role: "OWNER", status: "ACTIVE" } });
}

function publicOwnerUser(user: {
  id: string;
  email: string;
  role: OwnerRole;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export function ownerUserRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.use(async (req, res, next) => {
    if (req.auth?.role !== "OWNER") {
      await auditUnauthorizedAccess(deps, req, req.params.userId);
      sendError(res, 403, "forbidden");
      return;
    }
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const users = await db.ownerUser.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });
      res.json({ users: users.map(publicOwnerUser) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const parsed = ownerUserCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }

      const email = parsed.data.email.toLowerCase();
      const existing = await db.ownerUser.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        sendError(res, 409, "email_already_exists");
        return;
      }

      const user = await db.ownerUser.create({
        data: {
          tenantId: auth.tenantId,
          email,
          passwordHash: await bcrypt.hash(parsed.data.password, 12),
          role: parsed.data.role,
        },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_CREATED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
        metadata: { role: user.role },
      });

      res.status(201).json({ user: publicOwnerUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:userId/role", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const parsed = ownerUserRoleUpdateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }

      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
        select: { id: true, role: true, status: true },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }

      if (target.role === "OWNER" && target.status === "ACTIVE" && parsed.data.role !== "OWNER") {
        const owners = await activeOwnerCount(deps, auth.tenantId);
        if (owners <= 1) {
          sendError(res, 409, "cannot_demote_last_active_owner");
          return;
        }
      }

      const user = await db.ownerUser.update({
        where: { id: target.id },
        data: { role: parsed.data.role },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_ROLE_CHANGED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
        metadata: { oldRole: target.role, newRole: user.role },
      });

      res.json({ user: publicOwnerUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:userId/disable", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
        select: { id: true, role: true, status: true },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }

      if (target.role === "OWNER" && target.status === "ACTIVE") {
        const owners = await activeOwnerCount(deps, auth.tenantId);
        if (owners <= 1) {
          sendError(res, 409, "cannot_disable_last_active_owner");
          return;
        }
      }

      const user = await db.ownerUser.update({
        where: { id: target.id },
        data: { status: "DISABLED" },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_DISABLED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
        metadata: { role: user.role },
      });

      res.json({ user: publicOwnerUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:userId/enable", async (req, res, next) => {
    try {
      const auth = req.auth!;
      const target = await db.ownerUser.findFirst({
        where: { id: req.params.userId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!target) {
        sendError(res, 404, "not_found");
        return;
      }

      const user = await db.ownerUser.update({
        where: { id: target.id },
        data: { status: "ACTIVE" },
        select: { id: true, email: true, role: true, status: true, createdAt: true },
      });

      await writeAudit(db, {
        tenantId: auth.tenantId,
        actorType: "OWNER",
        actorId: auth.userId,
        action: "OWNER_USER_ENABLED",
        resourceType: "OwnerUser",
        resourceId: user.id,
        ...auditMetaFromRequest(req),
        metadata: { role: user.role },
      });

      res.json({ user: publicOwnerUser(user) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
