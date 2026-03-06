import express from "express";
import cors from "cors";
import helmet from "helmet";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { registrationRouter } from "./routes/registration.js";
import { ownerRouter } from "./routes/owner.js";
export const createApp = () => {
    const app = express();
    app.disable("x-powered-by");
    app.use(helmet());
    app.use(securityHeaders());
    app.use(cors({ origin: false }));
    app.use(express.json({ limit: "200kb" }));
    app.use(rateLimitMiddleware());
    app.get("/healthz", (_req, res) => {
        res.status(200).json({ ok: true });
    });
    app.use("/v1/guest", registrationRouter());
    app.use("/v1/owner", ownerRouter());
    app.use((err, _req, res, _next) => {
        const message = err instanceof Error ? err.message : "Unexpected error";
        res.status(500).json({ error: "internal_error", message });
    });
    return app;
};
