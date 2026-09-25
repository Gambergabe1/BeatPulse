import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

/**
 * Shared admin authentication for every serverless route.
 *
 * There is deliberately no default password. Until ADMIN_PASSWORD is set, the
 * stored hash is for a random password nobody knows, so every login fails. A
 * stored hash of the old public fallback password ("admin1234") is discarded.
 */

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LEGACY_DEFAULT_PASSWORD = "admin1234";

export interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

export interface PersistedAdminState extends AdminState {
  rowRef: string | null;
}

export const configuredPassword = () => {
  const value = process.env.ADMIN_PASSWORD?.trim();
  return value && value !== LEGACY_DEFAULT_PASSWORD ? value : null;
};

export function ensureDatabaseConfig() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL/POSTGRES_URL is not configured.");
  }
}

export function isPasswordHash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [salt, hash] = value.split(":");
  return Boolean(salt && hash);
}

export function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actual = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const encodeBase64Url = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
};

export function createAdminToken(secret: string) {
  const payload = `${Date.now() + TOKEN_TTL_MS}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return encodeBase64Url(`${payload}.${signature}`);
}

export function verifyAdminToken(token: string, secret: string) {
  try {
    const [expiresAtRaw, signature] = decodeBase64Url(token).split(".");
    if (!expiresAtRaw || !signature) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const expected = crypto.createHmac("sha256", secret).update(expiresAtRaw).digest("hex");
    const a = Buffer.from(signature, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function extractBearerToken(req: any) {
  const header = req.headers?.authorization;
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

let schemaReady: Promise<void> | null = null;

export function prepareAdminStateSchema() {
  ensureDatabaseConfig();
  schemaReady ??= (async () => {
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
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

const toIsoTimestamp = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(typeof value === "string" || typeof value === "number" ? value : NaN);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

/** An unguessable placeholder hash used while no admin password is configured. */
const lockedPasswordHash = () => createPasswordHash(crypto.randomBytes(32).toString("hex"));

async function seedAdminState(state: AdminState) {
  try {
    await sql`
      INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
      VALUES ('default', ${state.passwordHash}, ${state.tokenSecret}, ${state.updatedAt})
    `;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("invalid input syntax for type integer")) throw error;
    await sql`
      INSERT INTO admin_state (id, password_hash, token_secret, updated_at)
      VALUES (1, ${state.passwordHash}, ${state.tokenSecret}, ${state.updatedAt})
    `;
  }
}

export async function getAdminState(): Promise<PersistedAdminState> {
  await prepareAdminStateSchema();
  const { rows } = await sql`
    SELECT ctid::text AS row_ref, password_hash, token_secret, updated_at
    FROM admin_state
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `;

  const envPassword = configuredPassword();
  if (rows.length === 0) {
    await seedAdminState({
      passwordHash: envPassword ? createPasswordHash(envPassword) : lockedPasswordHash(),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    });
    return getAdminState();
  }

  const { state, repaired } = resolveAdminState(rows[0] as StoredAdminRow, envPassword);
  if (repaired) await writeAdminState(state);
  return state;
}

export interface StoredAdminRow {
  row_ref?: string;
  password_hash?: string | null;
  token_secret?: string | null;
  updated_at?: unknown;
}

/** Pure repair logic for a stored admin row; exported for tests. */
export function resolveAdminState(row: StoredAdminRow, envPassword: string | null) {
  const hasSecret = typeof row.token_secret === "string" && row.token_secret.trim().length > 0;
  // Older deployments were seeded with the public fallback password; never honour it.
  const storedHashUsable = isPasswordHash(row.password_hash) && !verifyPassword(LEGACY_DEFAULT_PASSWORD, row.password_hash);
  const state: PersistedAdminState = {
    passwordHash: storedHashUsable ? row.password_hash! : lockedPasswordHash(),
    // Rotating the secret when the hash is discarded invalidates tokens issued under the legacy password.
    tokenSecret: hasSecret && storedHashUsable ? row.token_secret!.trim() : crypto.randomBytes(32).toString("hex"),
    updatedAt: toIsoTimestamp(row.updated_at),
    rowRef: row.row_ref || null,
  };
  let repaired = !storedHashUsable || !hasSecret;

  // ADMIN_PASSWORD always wins so an operator can recover access by setting it.
  if (envPassword && !verifyPassword(envPassword, state.passwordHash)) {
    state.passwordHash = createPasswordHash(envPassword);
    repaired = true;
  }
  if (repaired) state.updatedAt = new Date().toISOString();
  return { state, repaired };
}

export async function writeAdminState(state: PersistedAdminState) {
  if (!state.rowRef) return;
  await sql`
    UPDATE admin_state
    SET password_hash = ${state.passwordHash}, token_secret = ${state.tokenSecret}, updated_at = ${state.updatedAt}
    WHERE ctid::text = ${state.rowRef}
  `;
}

/** Returns a session token for a correct password, otherwise null. */
export async function loginAdmin(password: string) {
  const state = await getAdminState();
  return verifyPassword(password, state.passwordHash) ? createAdminToken(state.tokenSecret) : null;
}

/** True when ADMIN_PASSWORD is set; otherwise only a password changed from the panel can work. */
export const hasConfiguredAdminPassword = () => configuredPassword() !== null;

export async function isAuthorizedAdmin(req: any) {
  const token = extractBearerToken(req);
  if (!token) return false;
  const state = await getAdminState();
  return verifyAdminToken(token, state.tokenSecret);
}
