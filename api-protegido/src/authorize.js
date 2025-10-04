// src/authorize.js
import { StatusCodes } from "http-status-codes";

/**
 * Requiere uno o varios scopes (AND lógico).
 * Ej.: requireScopes("service.read") o requireScopes("user.read","user.write")
 */
export function requireScopes(...required) {
  return (req, res, next) => {
    const tokenScopes = req.auth?.scopes;
    if (!tokenScopes) {
      return res.status(StatusCodes.FORBIDDEN).json({ error: "no_scopes_present" });
    }

    const ok = required.every((s) => tokenScopes.has(s));
    if (!ok) {
      return res.status(StatusCodes.FORBIDDEN).json({
        error: "insufficient_scope",
        required,
        present: Array.from(tokenScopes),
      });
    }
    return next();
  };
}

/**
 * Política extra (opcional): evita mezclar ámbitos de servicio y usuario.
 * - Si ruta requiere service.*, bloquea si token trae user.* (o viceversa).
 */
export function enforceDomainSeparation(domain /* 'service' | 'user' */) {
  return (req, res, next) => {
    const scopes = req.auth?.scopes || new Set();
    const hasService = [...scopes].some((s) => s.startsWith("service."));
    const hasUser = [...scopes].some((s) => s.startsWith("user."));
    if (domain === "service" && hasUser) {
      return res.status(403).json({ error: "scope_domain_mismatch", expected: "service.*" });
    }
    if (domain === "user" && hasService) {
      return res.status(403).json({ error: "scope_domain_mismatch", expected: "user.*" });
    }
    next();
  };
}
