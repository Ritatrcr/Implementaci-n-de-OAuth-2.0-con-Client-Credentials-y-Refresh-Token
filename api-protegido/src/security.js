// src/security.js
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const { HTTPS_ONLY = "true", ALLOWED_ORIGINS = "" } = process.env;

/**
 * Configura CORS, security headers y logging.
 * También fuerza HTTPS (detrás de proxy si aplica).
 */
export function applySecurity(app) {
  app.enable("trust proxy"); // necesario si estás detrás de un proxy/ingress

  // HTTPS-only
  if (HTTPS_ONLY === "true") {
    app.use((req, res, next) => {
      if (req.secure) return next();
      // Permite HTTP solo para healthchecks locales si necesitas; por defecto bloquea.
      return res.status(400).json({ error: "https_required" });
    });
  }

  // CORS
  const allowed = ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // permitir herramientas locales sin 'Origin'
        if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
        return cb(new Error("CORS not allowed for this origin"), false);
      },
      credentials: false,
      allowedHeaders: ["Authorization", "Content-Type"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 86400
    })
  );

  // Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" } // útil para demos
  }));

  // Logging
  app.use(morgan("combined"));
}
