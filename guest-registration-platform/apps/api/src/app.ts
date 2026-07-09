import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { AppDeps } from "./deps.js";
import { sendError } from "./lib/httpErrors.js";
import { errorHandler } from "./middleware/error.js";
import { requestId } from "./middleware/requestId.js";
import { requestLog } from "./middleware/requestLog.js";
import { requireOwnerAuth } from "./middleware/auth.js";
import { requireCsrf } from "./middleware/csrf.js";
import { healthRoutes } from "./routes/health.js";
import { ownerAuthRoutes } from "./routes/ownerAuth.js";
import { ownerPropertyRoutes } from "./routes/ownerProperties.js";
import { ownerSubmissionRoutes } from "./routes/ownerSubmissions.js";
import { ownerPassengerCardRoutes } from "./routes/ownerPassengerCards.js";
import { ownerUserRoutes } from "./routes/ownerUsers.js";
import { publicRegistrationRoutes } from "./routes/publicRegistration.js";

export function buildApp(deps: AppDeps): Express {
  const app = express();

  // Config-driven proxy trust — never set blindly to avoid IP spoofing.
  if (deps.config.trustProxy !== false) {
    app.set("trust proxy", deps.config.trustProxy);
  }

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(requestLog);
  app.use(helmet());
  app.use(cors({ origin: deps.config.publicAppUrl, credentials: true }));
  // express.json only processes requests with application/json content-type;
  // multipart/form-data requests are handled by multer in the individual routes.
  app.use(express.json({ limit: "200kb" }));

  app.use(healthRoutes(deps));
  app.use("/v1/public", publicRegistrationRoutes(deps));
  app.use("/v1/owner/auth", ownerAuthRoutes(deps));

  const ownerAuth = requireOwnerAuth(deps);
  // CSRF runs after auth on every owner router: it no-ops for safe methods and
  // for bearer/unauthenticated requests, and gates cookie-session mutations.
  const csrf = requireCsrf(deps);
  app.use("/v1/owner/properties", ownerAuth, csrf, ownerPropertyRoutes(deps));
  app.use("/v1/owner/submissions", ownerAuth, csrf, ownerSubmissionRoutes(deps));
  app.use("/v1/owner/passenger-cards", ownerAuth, csrf, ownerPassengerCardRoutes(deps));
  app.use("/v1/owner/users", ownerAuth, csrf, ownerUserRoutes(deps));

  app.use((_req, res) => {
    sendError(res, 404, "not_found");
  });
  app.use(errorHandler);

  return app;
}
