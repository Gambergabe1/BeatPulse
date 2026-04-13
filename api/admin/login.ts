import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAdminToken(secret: string) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return encodeBase64Url(`${payload}.${signature}`);
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    await prepareAdminStateSchema();
    const adminState = await getAdminState();
    const body = parseRequestBody(req);

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return fail(res, 400, "Password is required.");
    }
    if (!verifyPassword(password, adminState.passwordHash)) {
      return fail(res, 401, "Invalid password.");
    }

    return ok(res, { token: createAdminToken(adminState.tokenSecret) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process login.";
    return fail(res, 500, message);
  }
}
