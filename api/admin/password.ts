import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

interface PersistedAdminState extends AdminState {
  rowRef: string | null;
}

function ok(res: any, data: unknown) {
  return res.status(200).json({ success: true, data });
}

function fail(res: any, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function ensureDatabaseConfig() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL/POSTGRES_URL is not configured.");
  }
}

function parseRequestBody(req: any) {
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return {};
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
}

function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

function isPasswordHash(value: unknown) {
  if (typeof value !== "string") return false;
  const [salt, hash] = value.split(":");
  return Boolean(salt && hash);
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actualHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyAdminToken(token: string, secret: string) {
  try {
    const decoded = decodeBase64Url(token);
    const [expiresAtRaw, signature] = decoded.split(".");
    if (!expiresAtRaw || !signature) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const expectedSignature = crypto.createHmac("sha256", secret).update(expiresAtRaw).digest("hex");
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expectedSignature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractBearerToken(req: any) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

async function prepareAdminStateSchema() {
  ensureDatabaseConfig();

  await sql`
    CREATE TABLE IF NOT EXISTS admin_state (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS token_secret TEXT`;
  await sql`ALTER TABLE admin_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
}

async function seedAdminState(initialState: AdminState) {
  try {
    await sql`
      INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
      VALUES ('default', ${initialState.passwordHash}, ${initialState.tokenSecret}, ${initialState.updatedAt})
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("invalid input syntax for type integer")) {
      throw error;
    }

    await sql`
      INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
      VALUES (1, ${initialState.passwordHash}, ${initialState.tokenSecret}, ${initialState.updatedAt})
    `;
  }
}

async function getAdminState(): Promise<PersistedAdminState> {
  const { rows } = await sql`
    SELECT ctid::text AS row_ref, password_hash, token_secret, updated_at
    FROM admin_state
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `;

  if (rows.length === 0) {
    await seedAdminState({
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    });
    return getAdminState();
  }

  const row = rows[0] as {
    row_ref: string;
    password_hash?: string | null;
    token_secret?: string | null;
    updated_at?: string | Date | null;
  };

  const resolvedState: PersistedAdminState = {
    passwordHash: isPasswordHash(row.password_hash)
      ? row.password_hash!
      : createPasswordHash(ADMIN_DEFAULT_PASSWORD),
    tokenSecret:
      typeof row.token_secret === "string" && row.token_secret.trim()
        ? row.token_secret.trim()
        : crypto.randomBytes(32).toString("hex"),
    updatedAt: toIsoTimestamp(row.updated_at),
    rowRef: row.row_ref || null,
  };

  let shouldPersistRepair = !isPasswordHash(row.password_hash);
  if (!(typeof row.token_secret === "string" && row.token_secret.trim())) {
    shouldPersistRepair = true;
  }

  if (process.env.ADMIN_PASSWORD && !verifyPassword(process.env.ADMIN_PASSWORD, resolvedState.passwordHash)) {
    resolvedState.passwordHash = createPasswordHash(process.env.ADMIN_PASSWORD);
    resolvedState.updatedAt = new Date().toISOString();
    shouldPersistRepair = true;
  }

  if (shouldPersistRepair && resolvedState.rowRef) {
    await sql`
      UPDATE admin_state
      SET password_hash = ${resolvedState.passwordHash}, token_secret = ${resolvedState.tokenSecret}, updated_at = ${resolvedState.updatedAt}
      WHERE ctid::text = ${resolvedState.rowRef}
    `;
  }

  return resolvedState;
}

async function writeAdminState(state: PersistedAdminState) {
  await sql`
    UPDATE admin_state
    SET password_hash = ${state.passwordHash}, token_secret = ${state.tokenSecret}, updated_at = ${state.updatedAt}
    WHERE ctid::text = ${state.rowRef}
  `;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    await prepareAdminStateSchema();
    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }

    const body = parseRequestBody(req);
    const newPassword = typeof body.newPassword === "string" ? body.newPassword.trim() : "";
    if (newPassword.length < 4) {
      return fail(res, 400, "Password must be at least 4 characters.");
    }

    adminState.passwordHash = createPasswordHash(newPassword);
    adminState.tokenSecret = crypto.randomBytes(32).toString("hex");
    adminState.updatedAt = new Date().toISOString();
    await writeAdminState(adminState);

    return ok(res, { message: "Password updated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update password.";
    return fail(res, 500, message);
  }
}
