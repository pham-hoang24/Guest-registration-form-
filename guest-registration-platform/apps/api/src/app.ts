import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { AppDeps } from "./deps.js";
import { sendError } from "./lib/httpErrors.js";
import { errorHandler } from "./middleware/error.js";
import { requestId } from "./middleware/requestId.js";
import { requestLog } from "./middleware/requestLog.js";
import { requireOwnerAuth } from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";
import { ownerAuthRoutes } from "./routes/ownerAuth.js";
import { ownerPropertyRoutes } from "./routes/ownerProperties.js";
import { ownerSubmissionRoutes } from "./routes/ownerSubmissions.js";
import { publicRegistrationRoutes } from "./routes/publicRegistration.js";

export function buildApp(deps: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(requestLog);
  app.use(helmet());
  app.use(cors({ origin: deps.config.publicAppUrl }));
  app.use(express.json({ limit: "200kb" }));

  app.use(healthRoutes(deps));
  app.use("/v1/public", publicRegistrationRoutes(deps));
  app.use("/v1/owner/auth", ownerAuthRoutes(deps));

  const ownerAuth = requireOwnerAuth(deps);
  app.use("/v1/owner/properties", ownerAuth, ownerPropertyRoutes(deps));
  app.use("/v1/owner/submissions", ownerAuth, ownerSubmissionRoutes(deps));

  app.use((_req, res) => {
    sendError(res, 404, "not_found");
  });
  app.use(errorHandler);

  return app;
}
