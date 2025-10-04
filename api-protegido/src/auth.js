// src/auth.js
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { URL } from "node:url";
import { StatusCodes } from "http-status-codes";

const {
  AUTH_ISSUER,
  JWKS_URI,
  EXPECTED_AUDIENCE,
  TOKEN_LEEWAY_SECONDS = "60",
} = process.env;

if (!AUTH_ISSUER) {
  throw new Error("AUTH_ISSUER es obligatorio (.env)");
}

const jwksUrl = new URL(JWKS_URI || `${AUTH_ISSUER.replace(/\/$/, "")}/protocol/openid-connect/certs`);
const JWKS = createRemoteJWKSet(jwksUrl);

const wwwAuth = (message, type = "invalid_token") =>
  `Bearer error="${type}", error_description="${message.replace(/"/g, "'")}"`;

/**
 * Extrae y verifica el Access Token JWT.
 * Valida: firma, issuer, audience, exp/nbf/iat.
 * Coloca el payload en req.auth.
 */
export async function verifyAccessToken(req, res, next) {
  try {
    const authz = req.headers.authorization || "";
    const match = authz.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.set("WWW-Authenticate", wwwAuth("Missing bearer token", "invalid_request"));
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "missing_token" });
    }

    const token = match[1];

    const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
      issuer: AUTH_ISSUER,
      audience: EXPECTED_AUDIENCE, // si no quieres validar aud, comenta esta línea
      clockTolerance: Number(TOKEN_LEEWAY_SECONDS),
    });

    // Defensa básica contra ID token usado como access token:
    // Muchos AS incluyen 'typ' o 'token_use'; si existe y no es "access", rechaza.
    if (payload.token_use && payload.token_use !== "access") {
      res.set("WWW-Authenticate", wwwAuth("Token is not an access token"));
      return res.status(StatusCodes.UNAUTHORIZED).json({ error: "invalid_token_use" });
    }

    req.auth = {
      header: protectedHeader,
      claims: payload,
      scopes: new Set(String(payload.scope || "").split(" ").filter(Boolean)),
    };

    return next();
  } catch (err) {
    // Mapea errores de JOSE a respuestas legibles
    let description = "Token verification failed";
    if (err instanceof joseErrors.JWTExpired) description = "Token expired";
    if (err instanceof joseErrors.JWTInvalid) description = "Token invalid";
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) description = "Signature verification failed";

    res.set("WWW-Authenticate", wwwAuth(description));
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: "invalid_token", detail: description });
  }
}
