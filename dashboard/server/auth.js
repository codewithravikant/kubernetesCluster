import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

/** Lab dashboard login — same password used on VMs (sudo / Grafana / Jenkins). */
export const DASHBOARD_USER = "admin";

/**
 * scrypt hash of password "devops" (salt + key, base64).
 * Plaintext password is never stored in the repo.
 */
const PASSWORD_HASH =
  "scrypt$m93R0Tlq6erB5+oCDQ7xSQ==$SOcMuCwdC/zmpE4xBmzhoEz/TSlG01C/Ev3Mh/yxo96zb58/MHUkQHrGeqfDS0VICm3fltFAX0WMGMEqZ53qtg==";

const COOKIE_NAME = "sl_dash_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SESSION_SECRET =
  process.env.DASHBOARD_SESSION_SECRET ||
  "cluster-chronicles-dashboard-lab-session-v1";

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

async function verifyPassword(password, stored) {
  if (!stored?.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, saltB64, hashB64] = parts;
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  const actual = await scryptAsync(String(password), salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function signPayload(payloadB64) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");
}

export function createSessionToken(username) {
  const body = {
    u: username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString(
    "base64url"
  );
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function readSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return null;
  const expected = signPayload(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (!body?.u || !body?.exp || Date.now() > Number(body.exp)) return null;
    return { username: String(body.u) };
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  if (clear) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function authenticateUser(username, password) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (user !== DASHBOARD_USER) {
    // Dummy compare to reduce timing oracle on username
    await verifyPassword(pass, PASSWORD_HASH);
    return null;
  }
  const ok = await verifyPassword(pass, PASSWORD_HASH);
  return ok ? { username: DASHBOARD_USER } : null;
}

/** Express middleware — protects API and /open. */
export function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.user = session;
  next();
}

/** True when WebSocket upgrade request carries a valid session cookie. */
export function isAuthenticatedRequest(req) {
  return Boolean(readSession(req));
}

/** Hash a password with scrypt (for maintenance / regenerating PASSWORD_HASH). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
