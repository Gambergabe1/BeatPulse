import * as crypto from "node:crypto";
import { sql } from "@vercel/postgres";
import multer from "multer";
import { put } from "@vercel/blob";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface ScoreRecord {
  score: number;
  accuracy: number;
  date: string;
  username: string;
}

interface CommunitySongRecord {
  id: string;
  name: string;
  artist: string;
  audioUrl: string;
  audioPath: string;
  notesUrl: string;
  notesPath: string;
  difficulty: number;
  density: number;
  laneVariety: number;
  sliderProbability: number;
  stamina: number;
  topScore: number;
  scores: ScoreRecord[];
  authorName: string;
  createdAt: string;
  status: "ready";
}

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 150 } });
const BLOB_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

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

function ensureBlobConfig() {
  if (!BLOB_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured.");
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

function extractRelativeAssetPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  let normalized = value.trim();
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = new URL(normalized).pathname;
    } catch {
      return null;
    }
  }

  normalized = normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized || null;
}

function basenameFromPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "file";
}

function canonicalizeSongAssetPath(id: string, candidate: string | null, fallbackFileName: string) {
  const fileName = candidate ? basenameFromPath(candidate) : fallbackFileName;
  if (!candidate) return `songs/${id}/${fallbackFileName}`;
  if (candidate.startsWith("songs/")) return candidate;
  return `songs/${id}/${fileName}`;
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isSafeSongId(value: string) {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function isSafeSongAssetPath(id: string, value: string) {
  return value.startsWith(`songs/${id}/`) && /^songs\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9_.-]{1,180}$/.test(value);
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
  }).sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  return scores.reduce((max, entry) => Math.max(max, entry.score || 0), 0);
}

function normalizeSongRow(row: any): CommunitySongRecord {
  const id = toText(row.id, crypto.randomUUID());
  const createdAt = toIsoTimestamp(row.created_at ?? row.createdAt);
  const difficulty = clampNumber(row.difficulty ?? row.complexity, 0.5);
  const density = clampNumber(row.density, difficulty);
  const laneVariety = clampNumber(row.lane_variety ?? row.laneVariety, difficulty);
  const sliderProbability = clampNumber(row.slider_probability ?? row.sliderProbability, 0.3);
  const stamina = clampNumber(row.stamina, 0.5);
  const scores = parseScoreArray(row.scores as Json, createdAt);
  const audioPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(row.audio_path ?? row.audioPath ?? row.audio_url ?? row.audioUrl),
    "audio.mp3"
  );
  const notesPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(row.notes_path ?? row.notesPath ?? row.notes_url ?? row.notesUrl),
    "notes.json"
  );

  return {
    id,
    name: toText(row.name, "Untitled"),
    artist: toText(row.artist, "Unknown Artist"),
    audioUrl: toText(row.audio_url ?? row.audioUrl, ""),
    audioPath,
    notesUrl: toText(row.notes_url ?? row.notesUrl, ""),
    notesPath,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: Math.max(clampNumber(row.top_score ?? row.topScore, 0), toTopScoreFromScores(scores)),
    scores,
    authorName: toText(row.author_name ?? row.authorName, "Anonymous"),
    createdAt,
    status: "ready",
  };
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

function sanitizeFileName(input: string) {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function isMultipartRequest(req: any) {
  const contentType = typeof req.headers?.["content-type"] === "string" ? req.headers["content-type"] : "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

function runMiddleware(req: any, res: any, middleware: (req: any, res: any, next: (error?: unknown) => void) => void) {
  return new Promise<void>((resolve, reject) => {
    middleware(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function parseNotesPayload(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function prepareSongsSchema() {
  ensureDatabaseConfig();

  await sql`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      notes_url TEXT NOT NULL,
      notes_path TEXT NOT NULL,
      difficulty REAL NOT NULL,
      density REAL NOT NULL,
      lane_variety REAL NOT NULL,
      slider_probability REAL NOT NULL,
      stamina REAL NOT NULL,
      top_score REAL NOT NULL,
      scores JSONB NOT NULL DEFAULT '[]'::jsonb,
      author_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL
    );
  `;

  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS id TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_url TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS notes_path TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS difficulty REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS density REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS lane_variety REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS slider_probability REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS stamina REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS top_score REAL`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS scores JSONB`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS author_name TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS status TEXT`;
}

async function readSong(id: string) {
  const { rows } = await sql`SELECT * FROM songs WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  return normalizeSongRow(rows[0]);
}

async function handleGet(res: any) {
  await prepareSongsSchema();
  const { rows } = await sql`SELECT * FROM songs ORDER BY created_at DESC`;
  return ok(res, rows.map(normalizeSongRow));
}

async function handlePost(req: any, res: any) {
  await prepareSongsSchema();

  if (isMultipartRequest(req)) {
    await runMiddleware(req, res, uploader.single("audio"));
  }

  const body = req.file ? (req.body as Record<string, unknown>) : parseRequestBody(req);
  const createdAt = new Date().toISOString();
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled";
  const artist = typeof body.artist === "string" && body.artist.trim() ? body.artist.trim() : "Unknown Artist";
  const authorName =
    typeof body.authorName === "string" && body.authorName.trim() ? body.authorName.trim() : "Anonymous";
  const difficulty = clampNumber(body.difficulty, 0.5);
  const density = clampNumber(body.density, 0.5);
  const laneVariety = clampNumber(body.laneVariety, 0.5);
  const sliderProbability = clampNumber(body.sliderProbability, 0.3);
  const stamina = clampNumber(body.stamina, 0.5);

  let id = "";
  let audioUrl = "";
  let audioPath = "";
  let notesUrl = "";
  let notesPath = "";

  if (req.file) {
    ensureBlobConfig();
    id = crypto.randomUUID();

    const fileExt = (req.file.originalname || ".mp3").match(/\.[0-9a-z]{1,8}$/i)?.[0] || ".mp3";
    const safeAudioName = sanitizeFileName(
      req.file.originalname ? req.file.originalname.replace(fileExt, "") : "audio"
    );
    audioPath = `songs/${id}/${safeAudioName}${fileExt}`;
    notesPath = `songs/${id}/notes.json`;

    const [audioUpload, notesUpload] = await Promise.all([
      put(audioPath, req.file.buffer, {
        access: "public",
        token: BLOB_WRITE_TOKEN,
        contentType: req.file.mimetype || undefined,
      }),
      put(notesPath, JSON.stringify(parseNotesPayload(body.notes)), {
        access: "public",
        token: BLOB_WRITE_TOKEN,
        contentType: "application/json",
      }),
    ]);

    audioUrl = audioUpload.url;
    notesUrl = notesUpload.url;
  } else {
    id = typeof body.id === "string" ? body.id.trim() : "";
    audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
    notesUrl = typeof body.notesUrl === "string" ? body.notesUrl.trim() : "";
    const providedAudioPath = extractRelativeAssetPath(body.audioPath);
    const providedNotesPath = extractRelativeAssetPath(body.notesPath);

    if (!id || !isSafeSongId(id)) {
      return fail(res, 400, "A valid song id is required.");
    }

    if (!audioUrl || !notesUrl || !providedAudioPath || !providedNotesPath) {
      return fail(res, 400, "Uploaded song asset details are required.");
    }

    audioPath = canonicalizeSongAssetPath(id, providedAudioPath, "audio.mp3");
    notesPath = canonicalizeSongAssetPath(id, providedNotesPath, "notes.json");
    if (
      !isAbsoluteHttpUrl(audioUrl) ||
      !isAbsoluteHttpUrl(notesUrl) ||
      !isSafeSongAssetPath(id, audioPath) ||
      !isSafeSongAssetPath(id, notesPath)
    ) {
      return fail(res, 400, "Uploaded asset details are invalid.");
    }
  }

  if (await readSong(id)) {
    return fail(res, 409, "Song already exists.");
  }

  const song: CommunitySongRecord = {
    id,
    name,
    artist,
    audioUrl,
    audioPath,
    notesUrl,
    notesPath,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: 0,
    scores: [],
    authorName,
    createdAt,
    status: "ready",
  };

  await sql`
    INSERT INTO songs (
      id, name, artist, audio_url, audio_path, notes_url, notes_path,
      difficulty, density, lane_variety, slider_probability, stamina,
      top_score, scores, author_name, created_at, status
    )
    VALUES (
      ${song.id}, ${song.name}, ${song.artist}, ${song.audioUrl}, ${song.audioPath}, ${song.notesUrl}, ${song.notesPath},
      ${song.difficulty}, ${song.density}, ${song.laneVariety}, ${song.sliderProbability}, ${song.stamina},
      ${song.topScore}, ${JSON.stringify(song.scores)}::jsonb, ${song.authorName}, ${song.createdAt}, ${song.status}
    )
  `;

  return ok(res, song);
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
    const message = error instanceof Error ? error.message : "Failed to process songs.";
    return fail(res, 500, message);
  }
}
