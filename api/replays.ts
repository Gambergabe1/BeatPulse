import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface ReplayRecord {
  id: string;
  songId: string;
  songName: string;
  artist: string;
  difficulty: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
  score: number;
  accuracy: number;
  date: string;
  createdAt: string;
  events: unknown[];
  judgements?: unknown;
}

interface SongLookupRow {
  id: string;
  name: string;
  artist: string;
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

function parseEventsArray(raw: Json): unknown[] {
  return Array.isArray(raw) ? raw : [];
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

function normalizeReplayRow(row: any): ReplayRecord {
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const difficulty = clampNumber(row.difficulty ?? row.complexity, 0.5);
  return {
    id: toText(row.id, crypto.randomUUID()),
    songId: toText(row.song_id ?? row.songId, ""),
    songName: toText(row.song_name ?? row.songName, "Unknown Song"),
    artist: toText(row.artist, "Unknown Artist"),
    difficulty,
    density: clampNumber(row.density, difficulty),
    laneVariety: clampNumber(row.lane_variety ?? row.laneVariety, difficulty),
    sliderProbability: clampNumber(row.slider_probability ?? row.sliderProbability, 0.3),
    stamina: clampNumber(row.stamina, 0.5),
    score: clampNumber(row.score, 0),
    accuracy: clampNumber(row.accuracy, 0),
    date: toDisplayDate(row.date, createdAt),
    createdAt,
    events: parseEventsArray(row.events as Json),
    judgements: row.judgements ?? undefined,
  };
}

async function tableExists(tableName: "songs" | "replays") {
  const { rows } = await sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS present`;
  return Boolean(rows[0]?.present);
}

async function ensureTextIdentifier(tableName: "songs" | "replays", columnName: "id" | "song_id") {
  const { rows } = await sql<{ data_type: string }>`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName} AND column_name = ${columnName}
    LIMIT 1
  `;
  const dataType = rows[0]?.data_type;
  if (!dataType || ["text", "character varying"].includes(dataType)) return;

  // Preserve legacy numeric records while allowing the UUID IDs created by BeatPulse.
  await sql.query(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`);
  await sql.query(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE TEXT USING ${columnName}::text`);
}

async function migrateLegacyIdentifierTypes() {
  await ensureTextIdentifier("replays", "id");
  await ensureTextIdentifier("replays", "song_id");
  await ensureTextIdentifier("songs", "id");
}

async function prepareReplaysSchema() {
  ensureDatabaseConfig();

  await sql`
    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      difficulty REAL NOT NULL,
      density REAL NOT NULL,
      lane_variety REAL NOT NULL,
      slider_probability REAL NOT NULL,
      stamina REAL NOT NULL,
      score REAL NOT NULL,
      accuracy REAL NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      events JSONB NOT NULL DEFAULT '[]'::jsonb
      , judgements JSONB
    );
  `;

  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_id TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS song_name TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS difficulty REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS density REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS lane_variety REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS slider_probability REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS stamina REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS score REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS accuracy REAL`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS date TEXT`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS events JSONB`;
  await sql`ALTER TABLE replays ADD COLUMN IF NOT EXISTS judgements JSONB`;
  await migrateLegacyIdentifierTypes();
}

async function prepareSongsLookupSchema() {
  const songsPresent = await tableExists("songs");
  if (!songsPresent) {
    return false;
  }

  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist TEXT`;
  return true;
}

async function readSong(id: string): Promise<SongLookupRow | null> {
  if (!id) return null;

  const songsPresent = await prepareSongsLookupSchema();
  if (!songsPresent) {
    return null;
  }

  const { rows } = await sql`
    SELECT id, name, artist
    FROM songs
    WHERE id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return {
    id: toText(rows[0]?.id, ""),
    name: toText(rows[0]?.name, "Unknown Song"),
    artist: toText(rows[0]?.artist, "Unknown Artist"),
  };
}

async function handleGet(res: any) {
  await prepareReplaysSchema();
  const { rows } = await sql`SELECT * FROM replays ORDER BY created_at DESC`;
  return ok(res, rows.map(normalizeReplayRow));
}

async function handlePost(req: any, res: any) {
  await prepareReplaysSchema();

  const body = parseRequestBody(req);
  const songId = typeof body.songId === "string" ? body.songId.trim() : "";
  const songName = typeof body.songName === "string" ? body.songName.trim() : "";
  const score = clampNumber(body.score, Number.NaN);
  const accuracy = clampNumber(body.accuracy, Number.NaN);

  if (!songId || !songName || !Number.isFinite(score) || !Number.isFinite(accuracy)) {
    return fail(res, 400, "songId, songName, score and accuracy are required.");
  }

  const linkedSong = await readSong(songId);
  if (!linkedSong) {
    return fail(res, 404, "Song not found.");
  }

  const replay: ReplayRecord = {
    id: crypto.randomUUID(),
    songId: linkedSong.id,
    songName: linkedSong.name,
    artist: linkedSong.artist,
    difficulty: clampNumber(body.difficulty, 0.5),
    density: clampNumber(body.density, 0.5),
    laneVariety: clampNumber(body.laneVariety, 0.5),
    sliderProbability: clampNumber(body.sliderProbability, 0.3),
    stamina: clampNumber(body.stamina, 0.5),
    score,
    accuracy,
    date: (typeof body.date === "string" && body.date.trim()) || new Date().toLocaleDateString(),
    createdAt: new Date().toISOString(),
    events: parseEventsArray(body.events as Json),
    judgements: body.judgements ?? undefined,
  };

  await sql`
    INSERT INTO replays (
      id, song_id, song_name, artist,
      difficulty, density, lane_variety, slider_probability, stamina,
      score, accuracy, date, created_at, events, judgements
    )
    VALUES (
      ${replay.id}, ${replay.songId}, ${replay.songName}, ${replay.artist},
      ${replay.difficulty}, ${replay.density}, ${replay.laneVariety}, ${replay.sliderProbability}, ${replay.stamina},
      ${replay.score}, ${replay.accuracy}, ${replay.date}, ${replay.createdAt}, ${JSON.stringify(replay.events)}::jsonb, ${JSON.stringify(replay.judgements ?? null)}::jsonb
    )
  `;

  return ok(res, replay);
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method === "GET") {
      return await handleGet(res);
    }

    if (req.method === "POST") {
      return await handlePost(req, res);
    }

    return fail(res, 405, "Method not allowed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process replays.";
    return fail(res, 500, message);
  }
}
