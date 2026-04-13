import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

interface PersistedAdminState extends AdminState {
  rowRef: string | null;
}

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface CommunitySongRecord {
  id: string;
  scores: ScoreRecord[];
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

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function clampNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

function toDisplayDate(value: unknown, createdAt: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return new Date(createdAt).toLocaleDateString();
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

function parseScoreArray(raw: Json, createdAt = new Date().toISOString()): ScoreRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = entry as Partial<ScoreRecord>;
    return {
      score: clampNumber(row.score, 0),
      accuracy: clampNumber(row.accuracy, 0),
      date: toDisplayDate(row.date, createdAt),
      username: toText(row.username, "Anonymous"),
    };
  });
}

function sortScoresDesc(scores: ScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  if (scores.length === 0) return 0;
  return sortScoresDesc([...scores])[0]?.score ?? 0;
}

function normalizeSongRow(row: any): CommunitySongRecord {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  return {
    id: toText(row.id, ""),
    scores: sortScoresDesc(parseScoreArray(row.scores as Json, createdAt)),
  };
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

async function prepareSongsSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      scores JSONB NOT NULL DEFAULT '[]'::jsonb,
      top_score REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS scores JSONB`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS top_score REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
}

async function prepareGlobalScoresSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS global_scores (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL
    );
  `;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS username TEXT`;
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
    await Promise.all([prepareSongsSchema(), prepareGlobalScoresSchema()]);

    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }

    const body = parseRequestBody(req);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!username) {
      return fail(res, 400, "Username is required.");
    }
    if (!reason) {
      return fail(res, 400, "Removal reason is required.");
    }

    const normalized = normalizeUsername(username);
    const { rows: matchingGlobalRows } = await sql`
      SELECT id FROM global_scores WHERE LOWER(username) = ${normalized}
    `;
    const removedGlobalScores = matchingGlobalRows.length;
    if (removedGlobalScores > 0) {
      await sql`DELETE FROM global_scores WHERE LOWER(username) = ${normalized}`;
    }

    const { rows: songRows } = await sql`SELECT * FROM songs`;
    let affectedSongs = 0;
    let removedSongScores = 0;

    for (const row of songRows) {
      const song = normalizeSongRow(row);
      const filteredScores = song.scores.filter(
        (entry) => normalizeUsername(entry.username) !== normalized
      );

      if (filteredScores.length === song.scores.length) {
        continue;
      }

      affectedSongs += 1;
      removedSongScores += song.scores.length - filteredScores.length;
      const topScore = toTopScoreFromScores(filteredScores);

      await sql`
        UPDATE songs
        SET scores = ${JSON.stringify(filteredScores)}::jsonb, top_score = ${topScore}
        WHERE id = ${song.id}
      `;
    }

    if (removedGlobalScores === 0 && removedSongScores === 0) {
      return fail(res, 404, "Player not found on any leaderboard.");
    }

    return ok(res, {
      username,
      reason,
      removedGlobalScores,
      removedSongScores,
      affectedSongs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove player from leaderboard.";
    return fail(res, 500, message);
  }
}
