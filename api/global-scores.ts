import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

interface GlobalScoreRecord {
  id: string;
  songId?: string;
  score: number;
  accuracy: number;
  date: string;
  username: string;
  createdAt: string;
  songName: string;
  artist: string;
}

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface SongScoreState {
  id: string;
  name: string;
  artist: string;
  topScore: number;
  scores: ScoreRecord[];
  createdAt: string;
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

function getQueryValue(req: any, key: string) {
  const queryValue = req.query?.[key];
  if (Array.isArray(queryValue)) {
    return queryValue[0];
  }
  if (queryValue !== undefined && queryValue !== null) {
    return String(queryValue);
  }

  const rawUrl = typeof req.url === "string" ? req.url : "/api/global-scores";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  return parsedUrl.searchParams.get(key);
}

function normalizeGlobalScoreRow(row: any): GlobalScoreRecord {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  return {
    id: toText(row.id, crypto.randomUUID()),
    songId: toText(row.song_id ?? row.songId, ""),
    score: clampNumber(row.score, 0),
    accuracy: clampNumber(row.accuracy, 0),
    date: toDisplayDate(row.date, createdAt),
    username: toText(row.username, "Anonymous"),
    createdAt,
    songName: toText(row.song_name ?? row.songName, "Unknown Song"),
    artist: toText(row.artist, "Unknown Artist"),
  };
}

function parseScoreArray(raw: unknown, createdAt: string) {
  if (!Array.isArray(raw)) return [] as ScoreRecord[];

  return raw.map((entry) => {
    const row = entry as Partial<ScoreRecord>;
    return {
      score: clampNumber(row.score, 0),
      accuracy: clampNumber(row.accuracy, 0),
      date: toDisplayDate(row.date, createdAt),
      username: toText(row.username, "Anonymous"),
    };
  }).sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  return scores.reduce((max, entry) => Math.max(max, entry.score || 0), 0);
}

function normalizeSongScoreRow(row: any): SongScoreState {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const scores = parseScoreArray(row.scores, createdAt);
  return {
    id: toText(row.id, ""),
    name: toText(row.name, "Unknown Song"),
    artist: toText(row.artist, "Unknown Artist"),
    topScore: Math.max(clampNumber(row.top_score ?? row.topScore, 0), toTopScoreFromScores(scores)),
    scores,
    createdAt,
  };
}

async function tableExists(tableName: "songs" | "global_scores") {
  const { rows } = await sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present`;
  return Boolean(rows[0]?.present);
}

async function prepareGlobalScoresSchema() {
  ensureDatabaseConfig();

  await sql`
    CREATE TABLE IF NOT EXISTS global_scores (
      id TEXT PRIMARY KEY,
      song_id TEXT,
      score REAL NOT NULL,
      accuracy REAL NOT NULL,
      date TEXT NOT NULL,
      username TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS score REAL`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS accuracy REAL`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS date TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS username TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE global_scores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
}

async function prepareSongsLookupSchema() {
  const songsPresent = await tableExists("songs");
  if (!songsPresent) {
    return false;
  }

  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS top_score REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS scores JSONB`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  return true;
}

async function readSong(id: string): Promise<SongScoreState | null> {
  if (!id) return null;

  const songsPresent = await prepareSongsLookupSchema();
  if (!songsPresent) {
    return null;
  }

  const { rows } = await sql`
    SELECT id, name, artist, top_score, scores, created_at
    FROM songs
    WHERE id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return normalizeSongScoreRow(rows[0]);
}

async function handleGet(req: any, res: any) {
  await prepareGlobalScoresSchema();

  const limit = Math.max(1, Math.min(500, clampNumber(getQueryValue(req, "limit"), 100)));
  const offset = Math.max(0, clampNumber(getQueryValue(req, "offset"), 0));

  const { rows } = await sql`
    SELECT * FROM global_scores
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `;

  const scores = rows.map(normalizeGlobalScoreRow);
  const chunk = scores.slice(0, limit);
  const nextOffset = scores.length > limit ? offset + limit : null;

  return ok(res, { scores: chunk, nextOffset });
}

async function handlePost(req: any, res: any) {
  await prepareGlobalScoresSchema();

  const body = parseRequestBody(req);
  const score = clampNumber(body.score, Number.NaN);
  const accuracy = clampNumber(body.accuracy, Number.NaN);
  const requestedSongId = typeof body.songId === "string" ? body.songId.trim() : "";
  const username = typeof body.username === "string" && body.username.trim() ? body.username.trim() : "Anonymous";
  const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : new Date().toLocaleDateString();

  if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
    return fail(res, 400, "Score and accuracy must be numbers.");
  }

  const linkedSong = requestedSongId ? await readSong(requestedSongId) : null;
  if (requestedSongId && !linkedSong) {
    return fail(res, 404, "Song not found.");
  }

  const newScore: GlobalScoreRecord = {
    id: crypto.randomUUID(),
    songId: linkedSong?.id || requestedSongId || undefined,
    score,
    accuracy,
    date,
    username,
    createdAt: new Date().toISOString(),
    songName:
      linkedSong?.name ||
      (typeof body.songName === "string" && body.songName.trim() ? body.songName.trim() : "Unknown Song"),
    artist:
      linkedSong?.artist ||
      (typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : "Unknown Artist"),
  };

  await sql`
    INSERT INTO global_scores (id, song_id, score, accuracy, date, username, song_name, artist, created_at)
    VALUES (
      ${newScore.id},
      ${newScore.songId || null},
      ${newScore.score},
      ${newScore.accuracy},
      ${newScore.date},
      ${newScore.username},
      ${newScore.songName},
      ${newScore.artist},
      ${newScore.createdAt}
    )
  `;

  let updatedSong: SongScoreState | null = null;
  if (linkedSong) {
    const nextSongScores = [...linkedSong.scores, {
      score: newScore.score,
      accuracy: newScore.accuracy,
      date: newScore.date,
      username: newScore.username,
    }].sort((a, b) => b.score - a.score).slice(0, 5);
    const nextTopScore = toTopScoreFromScores(nextSongScores);

    await sql`
      UPDATE songs
      SET scores = ${JSON.stringify(nextSongScores)}::jsonb, top_score = ${nextTopScore}
      WHERE id = ${linkedSong.id}
    `;

    updatedSong = {
      ...linkedSong,
      scores: nextSongScores,
      topScore: nextTopScore,
    };
  }

  return ok(res, { id: newScore.id, song: updatedSong });
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }

    if (req.method === "POST") {
      return await handlePost(req, res);
    }

    return fail(res, 405, "Method not allowed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process global scores.";
    return fail(res, 500, message);
  }
}
