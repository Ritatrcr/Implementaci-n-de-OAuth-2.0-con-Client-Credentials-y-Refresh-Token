// src/routes.js
import { Router } from "express";
import { verifyAccessToken } from "./auth.js";
import { requireScopes, enforceDomainSeparation } from "./authorize.js";

export function buildRoutes() {
  const r = Router();

  // Abierto
  r.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Protegido (todas las rutas debajo requieren JWT válido)
  r.use(verifyAccessToken);

  // === Dominio "service" (comunicación entre servicios) ===
  r.get(
    "/svc/data",
    enforceDomainSeparation("service"),
    requireScopes("service.read"),
    (req, res) => {
      res.json({
        message: "Lectura de datos de servicio",
        subject: req.auth?.claims?.sub,
        scopes: Array.from(req.auth?.scopes || [])
      });
    }
  );

  r.post(
    "/svc/data",
    enforceDomainSeparation("service"),
    requireScopes("service.write"),
    (req, res) => {
      res.json({
        message: "Escritura de datos de servicio",
        body: req.body || {},
      });
    }
  );

  // === Dominio "user" (usuarios finales) ===
  r.get(
    "/user/profile",
    enforceDomainSeparation("user"),
    requireScopes("user.read"),
    (req, res) => {
      res.json({
        message: "Perfil de usuario (read)",
        user: {
          sub: req.auth?.claims?.sub,
          preferred_username: req.auth?.claims?.preferred_username,
          email: req.auth?.claims?.email,
        }
      });
    }
  );

  r.post(
    "/user/profile",
    enforceDomainSeparation("user"),
    requireScopes("user.write"),
    (req, res) => {
      res.json({
        message: "Perfil de usuario (write)",
        update: req.body || {},
      });
    }
  );

  return r;
}
