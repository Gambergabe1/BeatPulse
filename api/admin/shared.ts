import crypto from "crypto";
import { sql } from "@vercel/postgres";

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

export interface PersistedAdminState extends AdminState {
  rowRef: string | null;
}

export function ok(res: any, data: unknown) {
  return res.status(200).json({ success: true, data });
}

export function fail(res: any, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

export function ensureDatabaseConfig() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL/POSTGRES_URL is not configured.");
  }
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()) {
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

export function toDisplayDate(value: unknown, createdAt: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return new Date(createdAt).toLocaleDateString();
}

export function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actualHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createAdminToken(secret: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

export function verifyAdminToken(token: string, secret: string) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
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

export function extractBearerToken(req: any) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function prepareAdminStateSchema() {
  ensureDatabaseConfig();
  await sql`
    CREATE TABLE IF NOT EXISTS admin_state (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      token_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;
}

export async function getAdminState(): Promise<PersistedAdminState> {
  const { rows } = await sql`
    SELECT ctid::text AS row_ref, password_hash, token_secret, updated_at
    FROM admin_state
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `;
  if (rows.length === 0) {
    const initialState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
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

    return getAdminState();
  }

  const state = rows[0] as { row_ref: string; password_hash: string; token_secret: string; updated_at: Date };
  const resolvedState: PersistedAdminState = {
    passwordHash: state.password_hash,
    tokenSecret: state.token_secret,
    updatedAt: new Date(state.updated_at).toISOString(),
    rowRef: state.row_ref,
  };

  if (process.env.ADMIN_PASSWORD && !verifyPassword(process.env.ADMIN_PASSWORD, resolvedState.passwordHash)) {
    resolvedState.passwordHash = createPasswordHash(process.env.ADMIN_PASSWORD);
    resolvedState.updatedAt = new Date().toISOString();
    await sql`
      UPDATE admin_state
      SET password_hash = ${resolvedState.passwordHash}, updated_at = ${resolvedState.updatedAt}
      WHERE ctid::text = ${resolvedState.rowRef}
    `;
  }

  return resolvedState;
}

export async function writeAdminState(state: PersistedAdminState) {
  await sql`
    UPDATE admin_state
    SET password_hash = ${state.passwordHash}, token_secret = ${state.tokenSecret}, updated_at = ${state.updatedAt}
    WHERE ctid::text = ${state.rowRef}
  `;
}
