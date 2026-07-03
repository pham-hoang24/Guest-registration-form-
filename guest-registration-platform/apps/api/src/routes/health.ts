import { Router } from "express";
import type { AppDeps } from "../deps.js";

export function healthRoutes(deps: AppDeps): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    try {
      await deps.db.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not_ready" });
    }
  });

  return router;
}
