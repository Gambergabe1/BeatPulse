import { sql } from "@vercel/postgres";
import { isAuthorizedAdmin } from "../../lib/admin.js";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
  fullCombo: boolean;
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

function parseScoreArray(raw: Json, createdAt = new Date().toISOString()): ScoreRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = entry as Partial<ScoreRecord>;
    return {
      score: clampNumber(row.score, 0),
      accuracy: clampNumber(row.accuracy, 0),
      date: toDisplayDate(row.date, createdAt),
      username: toText(row.username, "Anonymous"),
      fullCombo: row.fullCombo === true,
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return fail(res, 405, "Method not allowed.");
  }

  try {
    if (!(await isAuthorizedAdmin(req))) {
      return fail(res, 401, "Unauthorized.");
    }
    await Promise.all([prepareSongsSchema(), prepareGlobalScoresSchema()]);

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
