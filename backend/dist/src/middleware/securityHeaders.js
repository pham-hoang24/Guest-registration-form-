export const securityHeaders = () => {
    return (_req, res, next) => {
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Permissions-Policy", "geolocation=()");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        next();
    };
};
