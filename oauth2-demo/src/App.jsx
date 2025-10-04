// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * DEMO OAuth 2.0 — Authorization Code + PKCE + Refresh (Keycloak)
 * — UI refinada: nueva paleta, tipografía, layout y jerarquía visual
 * ⚠️ Solo demo: en producción usa BFF para no exponer refresh tokens en el navegador.
 */

// ====== Configura aquí tu entorno ======
const AUTH_URL_BASE =
  "http://localhost:8080/realms/OAuthRealm/protocol/openid-connect/auth";
const TOKEN_URL =
  "http://localhost:8080/realms/OAuthRealm/protocol/openid-connect/token";
const LOGOUT_URL =
  "http://localhost:8080/realms/OAuthRealm/protocol/openid-connect/logout";

const CLIENT_ID = "frontend-client";
const REDIRECT_URI = "http://localhost:3000/callback"; // Debe coincidir EXACTO con Keycloak
const SCOPE =
  "openid profile email user.read user.write offline_access"; // ajusta si quieres
const API_BASE = "https://localhost:8443"; // tu API protegida (cert confiable en el navegador)

// ====== Utils ======
const b64url = (buf) =>
  btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const sha256b64url = async (str) => {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64url(digest);
};
const randStr = (bytes = 64) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
};
function decodeJwt(token) {
  try {
    const [, p] = token.split(".");
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
const ss = {
  set: (k, v) => sessionStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)),
  get: (k) => {
    const v = sessionStorage.getItem(k);
    try { return JSON.parse(v); } catch { return v; }
  },
  del: (k) => sessionStorage.removeItem(k),
  clear: () => sessionStorage.clear(),
};
const ls = {
  set: (k, v) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)),
  get: (k) => {
    const v = localStorage.getItem(k);
    try { return JSON.parse(v); } catch { return v; }
  },
  del: (k) => localStorage.removeItem(k),
  has: (k) => localStorage.getItem(k) != null,
};

// ====== App ======
export default function App() {
  const [debug, setDebug] = useState(true);

  const [accessToken, setAccessToken] = useState(() => ss.get("access_token") || "");
  const [refreshToken, setRefreshToken] = useState(() => ss.get("refresh_token") || "");
  const [idToken, setIdToken] = useState(() => ss.get("id_token") || "");

  const [oldRefreshToken, setOldRefreshToken] = useState("");
  const [events, setEvents] = useState([]);
  const [lastCode, setLastCode] = useState("");
  const [lastState, setLastState] = useState("");
  const [tokenStatus, setTokenStatus] = useState(null);
  const [tokenBody, setTokenBody] = useState(null);

  const claims = useMemo(() => decodeJwt(accessToken), [accessToken]);
  const log = (m) => setEvents((ev) => [{ t: new Date(), m }, ...ev].slice(0, 400));

  // ====== Iniciar login usando TU URL, pero con PKCE correcto ======
  async function startLogin({ forceLogin = false } = {}) {
    const state = randStr(24);
    const verifier = randStr(64);
    const challenge = await sha256b64url(verifier);

    // Guarda todo lo necesario para el exchange
    ls.set("pkce_state", state);
    ls.set("pkce_verifier", verifier);
    ls.set("pkce_redirect_uri", REDIRECT_URI);
    ls.set("pkce_client_id", CLIENT_ID);

    const url = new URL(AUTH_URL_BASE);
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (forceLogin) url.searchParams.set("prompt", "login");

    log("→ Redirigiendo a /auth con PKCE…");
    window.location.assign(url.toString());
  }

  // ====== Canjear ?code por tokens ======
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return;

    setLastCode(code);
    setLastState(state || "");

    const verifier = ls.get("pkce_verifier");
    const startRedirect =  REDIRECT_URI;
    const startClientId = ls.get("pkce_client_id") || CLIENT_ID;
    const storedState = ls.get("pkce_state");

    if (!verifier) {
      log("❗ PKCE verifier no encontrado. Inicia el login desde la app (no a mano) y no cambies de pestaña/origen.");
      return;
    }
    if (storedState && state && storedState !== state) {
      log("❌ State mismatch — abortando (posible CSRF).");
      return;
    }

    (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: startRedirect,
          client_id: startClientId,
          client_secret: "beR7cbwcU1HO7JacEVN6TAuL4Cmwz5Jh",
        });
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const data = await res.json();
        setTokenStatus(res.status);
        setTokenBody(data);

        if (!res.ok) throw new Error(`Intercambio falló: ${res.status} ${JSON.stringify(data)}`);

        setAccessToken(data.access_token || "");
        setRefreshToken(data.refresh_token || "");
        setIdToken(data.id_token || "");
        ss.set("access_token", data.access_token || "");
        ss.set("refresh_token", data.refresh_token || "");
        ss.set("id_token", data.id_token || "");
        log("✅ Code canjeado por tokens");

        // Limpia PKCE
        ls.del("pkce_state");
        ls.del("pkce_verifier");
        ls.del("pkce_redirect_uri");
        ls.del("pkce_client_id");

        // Limpia la query si no estás en debug
        if (!debug) {
          url.search = "";
          window.history.replaceState({}, document.title, url.toString());
        }
      } catch (e) {
        log(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debug]);

  // ====== Refresh tokens ======
  async function doRefresh(rt) {
    if (!rt) return log("No hay refresh token");
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: rt,
        client_id: CLIENT_ID, // cliente público
      });
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Refresh falló: ${res.status} ${JSON.stringify(data)}`);

      setAccessToken(data.access_token || "");
      ss.set("access_token", data.access_token || "");
      if (data.refresh_token) {
        setOldRefreshToken(refreshToken);
        setRefreshToken(data.refresh_token);
        ss.set("refresh_token", data.refresh_token);
      }
      if (data.id_token) {
        setIdToken(data.id_token);
        ss.set("id_token", data.id_token);
      }
      log("🔄 Refresh OK (rotación activa si está configurada)");
    } catch (e) {
      log(String(e));
    }
  }
  const refreshCurrent = () => doRefresh(refreshToken);
  const refreshWithOld = () => doRefresh(oldRefreshToken);

  // ====== Llamadas al API protegido ======
  async function callApi(path, method = "GET", bodyObj) {
    if (!accessToken) return log("No hay access token");
    try {
      const res = await fetch(API_BASE.replace(/\/$/, "") + path, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(bodyObj ? { "Content-Type": "application/json" } : {}),
        },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      });
      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      log(`${method} ${path} → ${res.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    } catch (e) {
      log(String(e));
    }
  }

  // ====== Logout SSO del IdP ======
  function idpLogout() {
    const u = new URL(LOGOUT_URL);
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("post_logout_redirect_uri", REDIRECT_URI);
    if (idToken) u.searchParams.set("id_token_hint", idToken);
    log("→ Logout del IdP…");
    window.location.assign(u.toString());
  }
  function clearLocal() {
    setAccessToken("");
    setRefreshToken("");
    setOldRefreshToken("");
    setIdToken("");
    ss.clear();
    log("🧹 Tokens locales limpiados");
  }
  async function copy(txt) {
    try { await navigator.clipboard.writeText(txt || ""); log("📋 Copiado"); } catch {}
  }

  // ====== Estado del access token (expiración) ======
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const expIn = claims?.exp ? Math.max(0, claims.exp - Math.floor(now / 1000)) : null;
  const statusTone = !accessToken
    ? { bg: "bg-zinc-200 text-zinc-700", label: "Sin token" }
    : expIn === 0
    ? { bg: "bg-rose-100 text-rose-700", label: "Expirado" }
    : expIn && expIn < 20
    ? { bg: "bg-amber-100 text-amber-700", label: `Por expirar ~ ${expIn}s` }
    : { bg: "bg-emerald-100 text-emerald-700", label: `Válido ~ ${expIn}s` };

  // ====== UI ======
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-slate-50 to-slate-100 text-zinc-900 selection:bg-indigo-200/60">
      {/* HEADER */}
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-indigo-600 text-white grid place-items-center font-bold shadow-sm">OA</div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">OAuth 2.0 — PKCE + Refresh (Keycloak)</h1>
              <p className="text-xs text-zinc-500">Demo visual con tu URL de <span className="font-mono">/auth</span> + PKCE</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" className="accent-indigo-600" checked={debug} onChange={e=>setDebug(e.target.checked)} />
              Modo depuración
            </label>
            <span className={`text-xs px-3 py-1 rounded-full ${statusTone.bg}`}>{statusTone.label}</span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="max-w-7xl mx-auto p-5 grid gap-5 lg:grid-cols-12">
        {/* SIDEBAR / ACCIONES */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Paso 1 */}
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold tracking-tight">1) Iniciar login</h2>
              <span className="text-[11px] text-zinc-500">Redirect URI: <span className="font-mono">/callback</span></span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>startLogin()} className="col-span-2 px-4 py-2 rounded-xl bg-indigo-600 text-white hover:brightness-95 active:scale-[.99] transition">Iniciar login (PKCE)</button>
              <button onClick={()=>startLogin({ forceLogin: true })} className="px-4 py-2 rounded-xl border border-zinc-200 hover:bg-zinc-50">Forzar login</button>
              <button onClick={clearLocal} className="px-4 py-2 rounded-xl border border-zinc-200 hover:bg-zinc-50">Borrar tokens</button>
              <button onClick={idpLogout} className="px-4 py-2 rounded-xl border border-zinc-200 hover:bg-zinc-50">Logout IdP</button>
            </div>
          </section>

          {/* Paso 3 */}
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold tracking-tight">3) Probar API protegida</h2>
              <span className="text-[11px] text-zinc-500">user.* → <span className="font-mono">/user/**</span></span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={()=>callApi("/user/profile","GET")} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">GET /user/profile</button>
              <button onClick={()=>callApi("/user/profile","POST",{displayName:"Ada"})} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">POST /user/profile</button>
              <button onClick={()=>callApi("/svc/data","GET")} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">GET /svc/data</button>
              <button onClick={()=>callApi("/svc/data","POST",{foo:"bar"})} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">POST /svc/data</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={refreshCurrent} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">Refresh (RT actual)</button>
              <button onClick={refreshWithOld} className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50">Probar RT viejo</button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">403 si falta scope; 401 si caducó; todo por HTTPS.</p>
          </section>
        </aside>

        {/* CONTENIDO PRINCIPAL */}
        <section className="lg:col-span-8 space-y-5">
          {/* Paso 2 */}
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold tracking-tight">2) Tokens, claims y retorno</h2>
              <div className="flex gap-2">
                <button onClick={()=>copy(accessToken)} className="text-xs px-3 py-1 rounded-full border border-zinc-200 hover:bg-zinc-50">Copiar access</button>
                <button onClick={()=>copy(refreshToken)} className="text-xs px-3 py-1 rounded-full border border-zinc-200 hover:bg-zinc-50">Copiar refresh</button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Columna izquierda */}
              <div>
                <label className="text-[11px] text-zinc-500">Access Token</label>
                <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded-xl p-2 h-40 overflow-auto break-all select-all">{accessToken || "—"}</div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-[11px] text-zinc-500">Refresh Token</label>
                    <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded-xl p-2 h-20 overflow-auto break-all select-all">{refreshToken || "—"}</div>
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-500">ID Token</label>
                    <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded-xl p-2 h-20 overflow-auto break-all select-all">{idToken || "—"}</div>
                  </div>
                </div>

                {debug && (
                  <div className="mt-3 text-[11px]">
                    <div className="mb-1 text-zinc-500">Retorno crudo (debug)</div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <div className="text-[11px] text-zinc-500">code</div>
                        <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded p-1 break-all select-all">{lastCode || "—"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500">state</div>
                        <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded p-1 break-all select-all">{lastState || "—"}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <div className="text-[11px] text-zinc-500">/token status</div>
                        <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded p-1">{tokenStatus ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500">/token body</div>
                        <div className="text-[11px] bg-zinc-50 border border-zinc-200 rounded p-1 h-24 overflow-auto break-all select-all">
                          {tokenBody ? JSON.stringify(tokenBody) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Columna derecha */}
              <div>
                <label className="text-[11px] text-zinc-500">Claims del Access Token</label>
                <pre className="text-[11px] bg-zinc-50 border border-zinc-200 rounded-xl p-2 h-64 overflow-auto">{JSON.stringify(claims, null, 2) || "—"}</pre>
                <div className="text-[11px] text-zinc-600 mt-2">
                  Expira en: <span className="font-mono">{claims?.exp ? Math.max(0, claims.exp - Math.floor(Date.now()/1000)) : "—"}</span> s
                </div>
              </div>
            </div>
          </section>

          {/* Eventos */}
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-zinc-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold tracking-tight">Eventos</h2>
              <span className="text-[11px] text-zinc-500">Máx. 400</span>
            </div>
            <div className="max-h-72 overflow-auto text-[12px] space-y-1 font-mono leading-relaxed">
              {events.map((e, i) => (
                <div key={i}><span className="opacity-50">[{e.t.toLocaleTimeString()}]</span> {e.m}</div>
              ))}
            </div>
          </section>

          <p className="text-[11px] text-center text-zinc-500 pb-8">Si tu API usa certificado autofirmado (<span className="font-mono">https://localhost:8443</span>), confíalo en el navegador o usa mkcert.</p>
        </section>
      </main>
    </div>
  );
}
