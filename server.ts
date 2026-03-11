import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { config as loadEnv } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.join(__dirname, ".env.local") });
loadEnv();
const APP_ROOT = __dirname;
const ADMIN_STATE_FILE = path.join(APP_ROOT, ".admin-state.json");
const DATA_DIR = path.resolve(process.env.BEATPULSE_DATA_DIR || path.join(APP_ROOT, ".server-data"));
const UPLOAD_DIR = path.resolve(process.env.BEATPULSE_UPLOAD_DIR || path.join(APP_ROOT, "uploads"));
const SONGS_FILE = path.join(DATA_DIR, "songs.json");
const GLOBAL_SCORES_FILE = path.join(DATA_DIR, "global-scores.json");
const REPLAYS_FILE = path.join(DATA_DIR, "replays.json");
const STORAGE_META_FILE = path.join(DATA_DIR, "storage-meta.json");
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const STORAGE_SCHEMA_VERSION = 2;

interface AdminState {
  passwordHash: string;
  tokenSecret: string;
  updatedAt: string;
}

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
}

interface GlobalScoreRecord {
  id: string;
  score: number;
  accuracy: number;
  date: string;
  username: string;
  createdAt: string;
  songName: string;
  artist: string;
}

interface SongStorageIssue {
  id: string;
  name: string;
  artist: string;
  missingAudio: boolean;
  missingNotes: boolean;
}

interface LeaderboardModerationResult {
  username: string;
  reason: string;
  removedGlobalScores: number;
  removedSongScores: number;
  affectedSongs: number;
}

interface StorageMetaRecord {
  schemaVersion: number;
  updatedAt: string;
  migratedCollections: string[];
  backups: string[];
}

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function readCollection<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const invalidBackupPath = `${filePath}.invalid-${Date.now()}.bak`;
    try {
      fs.copyFileSync(filePath, invalidBackupPath);
    } catch {
      // Ignore backup failures and fall back to a clean file.
    }
    writeCollection(filePath, fallback);
    return fallback;
  }
}

function writeCollection<T>(filePath: string, payload: T) {
  const tmpFilePath = `${filePath}.tmp-${Date.now()}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmpFilePath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFilePath, filePath);
}

function writeFileAtomic(filePath: string, payload: string | Buffer | Uint8Array) {
  const tmpFilePath = `${filePath}.tmp-${Date.now()}-${crypto.randomUUID()}`;
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(tmpFilePath, payload);
  fs.renameSync(tmpFilePath, filePath);
}

function hasSongAssets(song: CommunitySongRecord) {
  return {
    missingAudio: !hasSongAsset(song.audioPath),
    missingNotes: !hasSongAsset(song.notesPath),
  };
}

function isExistingFile(filePath: string) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasSongAsset(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const primary = path.join(UPLOAD_DIR, normalized);
  if (isExistingFile(primary)) return true;

  if (normalized.startsWith("songs/")) {
    const legacyRelative = normalized.substring("songs/".length);
    const legacy = path.join(UPLOAD_DIR, legacyRelative);
    if (isExistingFile(legacy)) return true;
  }

  return false;
}

function backupStorageFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.${label}.${Date.now()}.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
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
  const uploadMarker = "api/uploads/";
  const uploadIndex = normalized.indexOf(uploadMarker);
  if (uploadIndex >= 0) {
    normalized = normalized.slice(uploadIndex + uploadMarker.length);
  }

  if (normalized.startsWith("uploads/")) {
    normalized = normalized.slice("uploads/".length);
  }

  normalized = normalized.replace(/^\.?\//, "");
  return normalized || null;
}

function canonicalizeSongAssetPath(id: string, candidate: string | null, fallbackFileName: string) {
  const fileName = candidate ? path.posix.basename(candidate) : fallbackFileName;
  if (!candidate) return `songs/${id}/${fallbackFileName}`;
  if (candidate.startsWith("songs/")) return candidate;
  return `songs/${id}/${fileName}`;
}

function toLocalUploadUrl(relativePath: string) {
  return `/api/uploads/${relativePath.replace(/\\/g, "/")}`;
}

function normalizeScoreRecord(raw: any, createdAt: string): ScoreRecord {
  return {
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    username: toText(raw?.username, "Anonymous"),
  };
}

function normalizeSongRecord(raw: any): CommunitySongRecord {
  const id = toText(raw?.id, crypto.randomUUID());
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  const difficulty = clampNumber(raw?.difficulty ?? raw?.complexity, 0.5);
  const density = clampNumber(raw?.density, difficulty);
  const laneVariety = clampNumber(raw?.laneVariety ?? raw?.lane_variety, difficulty);
  const sliderProbability = clampNumber(raw?.sliderProbability ?? raw?.slider_probability, 0.3);
  const stamina = clampNumber(raw?.stamina, 0.5);
  const rawScores = Array.isArray(raw?.scores) ? raw.scores : [];
  const scores = sortScoresDesc(rawScores.map((entry) => normalizeScoreRecord(entry, createdAt)));
  const audioPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(raw?.audioPath ?? raw?.audio_path ?? raw?.audioUrl ?? raw?.audio_url),
    "audio.mp3"
  );
  const notesPath = canonicalizeSongAssetPath(
    id,
    extractRelativeAssetPath(raw?.notesPath ?? raw?.notes_path ?? raw?.notesUrl ?? raw?.notes_url),
    "notes.json"
  );

  return {
    id,
    name: toText(raw?.name, "Untitled"),
    artist: toText(raw?.artist, "Unknown Artist"),
    audioUrl: toLocalUploadUrl(audioPath),
    audioPath,
    notesUrl: toLocalUploadUrl(notesPath),
    notesPath,
    difficulty,
    density,
    laneVariety,
    sliderProbability,
    stamina,
    topScore: Math.max(clampNumber(raw?.topScore ?? raw?.top_score, 0), toTopScoreFromScores(scores)),
    scores,
    authorName: toText(raw?.authorName ?? raw?.author_name, "Anonymous"),
    createdAt,
    status: "ready",
  };
}

function normalizeGlobalScoreRecord(raw: any): GlobalScoreRecord {
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  return {
    id: toText(raw?.id, crypto.randomUUID()),
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    username: toText(raw?.username, "Anonymous"),
    createdAt,
    songName: toText(raw?.songName ?? raw?.song_name, "Unknown Song"),
    artist: toText(raw?.artist, "Unknown Artist"),
  };
}

function normalizeReplayRecord(raw: any): ReplayRecord {
  const createdAt = toIsoTimestamp(raw?.createdAt ?? raw?.created_at);
  const difficulty = clampNumber(raw?.difficulty ?? raw?.complexity, 0.5);
  return {
    id: toText(raw?.id, crypto.randomUUID()),
    songId: toText(raw?.songId ?? raw?.song_id, ""),
    songName: toText(raw?.songName ?? raw?.song_name, "Unknown Song"),
    artist: toText(raw?.artist, "Unknown Artist"),
    difficulty,
    density: clampNumber(raw?.density, difficulty),
    laneVariety: clampNumber(raw?.laneVariety ?? raw?.lane_variety, difficulty),
    sliderProbability: clampNumber(raw?.sliderProbability ?? raw?.slider_probability, 0.3),
    stamina: clampNumber(raw?.stamina, 0.5),
    score: clampNumber(raw?.score, 0),
    accuracy: clampNumber(raw?.accuracy, 0),
    date: toDisplayDate(raw?.date, createdAt),
    createdAt,
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

function readSongs(): CommunitySongRecord[] {
  const raw = readCollection<unknown>(SONGS_FILE, []);
  return sortSongsDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeSongRecord(entry)));
}

function writeSongs(songs: CommunitySongRecord[]) {
  writeCollection(SONGS_FILE, songs);
}

function readGlobalScores(): GlobalScoreRecord[] {
  const raw = readCollection<unknown>(GLOBAL_SCORES_FILE, []);
  return sortGlobalScoresDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeGlobalScoreRecord(entry)));
}

function writeGlobalScores(scores: GlobalScoreRecord[]) {
  writeCollection(GLOBAL_SCORES_FILE, scores);
}

function readReplays(): ReplayRecord[] {
  const raw = readCollection<unknown>(REPLAYS_FILE, []);
  return sortReplaysDesc((Array.isArray(raw) ? raw : []).map((entry) => normalizeReplayRecord(entry)));
}

function writeReplays(replays: ReplayRecord[]) {
  writeCollection(REPLAYS_FILE, replays);
}

function migrateLocalStorage(): StorageMetaRecord {
  const migratedCollections: string[] = [];
  const backups: string[] = [];

  const normalizedSongs = readSongs();
  const normalizedGlobalScores = readGlobalScores();
  const normalizedReplays = readReplays();

  const rawSongs = readCollection<unknown>(SONGS_FILE, []);
  if (JSON.stringify(rawSongs) !== JSON.stringify(normalizedSongs)) {
    const backup = backupStorageFile(SONGS_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeSongs(normalizedSongs);
    migratedCollections.push("songs");
  }

  const rawGlobalScores = readCollection<unknown>(GLOBAL_SCORES_FILE, []);
  if (JSON.stringify(rawGlobalScores) !== JSON.stringify(normalizedGlobalScores)) {
    const backup = backupStorageFile(GLOBAL_SCORES_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeGlobalScores(normalizedGlobalScores);
    migratedCollections.push("global-scores");
  }

  const rawReplays = readCollection<unknown>(REPLAYS_FILE, []);
  if (JSON.stringify(rawReplays) !== JSON.stringify(normalizedReplays)) {
    const backup = backupStorageFile(REPLAYS_FILE, `schema-v${STORAGE_SCHEMA_VERSION}`);
    if (backup) backups.push(backup);
    writeReplays(normalizedReplays);
    migratedCollections.push("replays");
  }

  const meta: StorageMetaRecord = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    migratedCollections,
    backups,
  };

  writeCollection(STORAGE_META_FILE, meta);
  return meta;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").slice(0, 120) || "upload";
}

function clampNumber(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function sortSongsDesc(songs: CommunitySongRecord[]) {
  return songs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortScoresDesc(scores: ScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score);
}

function toTopScoreFromScores(scores: ScoreRecord[]) {
  if (scores.length === 0) return 0;
  return sortScoresDesc([...scores])[0]?.score ?? 0;
}

function sortGlobalScoresDesc(scores: GlobalScoreRecord[]) {
  return scores.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}

function sortReplaysDesc(replays: ReplayRecord[]) {
  return replays.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function createPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actualHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAdminToken(secret: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

function verifyAdminToken(token: string, secret: string): boolean {
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

function loadAdminState(): AdminState {
  if (!fs.existsSync(ADMIN_STATE_FILE)) {
    const initialState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(initialState, null, 2), "utf8");
    return initialState;
  }

  try {
    const raw = fs.readFileSync(ADMIN_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AdminState>;
    if (!parsed.passwordHash || !parsed.tokenSecret) {
      throw new Error("Admin state file is missing required fields.");
    }

    const resolvedState: AdminState = {
      passwordHash: parsed.passwordHash,
      tokenSecret: parsed.tokenSecret,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };

    if (process.env.ADMIN_PASSWORD && !verifyPassword(process.env.ADMIN_PASSWORD, resolvedState.passwordHash)) {
      resolvedState.passwordHash = createPasswordHash(process.env.ADMIN_PASSWORD);
      resolvedState.updatedAt = new Date().toISOString();
      saveAdminState(resolvedState);
    }

    return resolvedState;
  } catch {
    const fallbackState: AdminState = {
      passwordHash: createPasswordHash(ADMIN_DEFAULT_PASSWORD),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(fallbackState, null, 2), "utf8");
    return fallbackState;
  }
}

function saveAdminState(state: AdminState) {
  fs.writeFileSync(ADMIN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function ok<T>(res: Response, data: T) {
  res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error });
}

const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 150 } });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  let adminState = loadAdminState();

  ensureDirectories();
  const storageMeta = migrateLocalStorage();
  if (storageMeta.migratedCollections.length > 0) {
    console.log(
      `Migrated local storage to schema v${storageMeta.schemaVersion}: ${storageMeta.migratedCollections.join(", ")}`
    );
  }
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/uploads", (req, res, next) => {
    if (!req.path.startsWith("/songs/")) return next();

    const legacyPath = req.path.replace(/^\/songs\//, "");
    const legacyFullPath = path.join(UPLOAD_DIR, legacyPath);
    if (isExistingFile(legacyFullPath)) {
      return res.sendFile(legacyFullPath);
    }

    return next();
  });
  app.use("/api/uploads", express.static(UPLOAD_DIR));

  app.get("/api/health", (_req, res) => {
    ok(res, { status: "ok", message: "BeatPulse server is healthy" });
  });

  app.post("/api/admin/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return fail(res, 400, "Password is required.");
    }
    if (!verifyPassword(password, adminState.passwordHash)) {
      return fail(res, 401, "Invalid password.");
    }
    const token = createAdminToken(adminState.tokenSecret);
    return ok(res, { token });
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }
    next();
  };

  app.post("/api/admin/password", requireAdmin, (req, res) => {
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
    if (newPassword.length < 4) {
      return fail(res, 400, "Password must be at least 4 characters.");
    }
    adminState = {
      ...adminState,
      passwordHash: createPasswordHash(newPassword),
      tokenSecret: crypto.randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    saveAdminState(adminState);
    return ok(res, { message: "Password updated." });
  });

  app.post("/api/admin/leaderboard/remove-player", requireAdmin, (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (!username) {
      return fail(res, 400, "Username is required.");
    }

    if (!reason) {
      return fail(res, 400, "Removal reason is required.");
    }

    const normalizedUsername = normalizeUsername(username);
    const currentGlobalScores = readGlobalScores();
    const removedGlobalScores = currentGlobalScores.filter(
      (entry) => normalizeUsername(entry.username) === normalizedUsername
    ).length;
    const nextGlobalScores = currentGlobalScores.filter(
      (entry) => normalizeUsername(entry.username) !== normalizedUsername
    );

    const currentSongs = readSongs();
    let affectedSongs = 0;
    let removedSongScores = 0;
    const nextSongs = currentSongs.map((song) => {
      const currentScores = song.scores || [];
      const filteredScores = currentScores.filter(
        (entry) => normalizeUsername(entry.username) !== normalizedUsername
      );

      if (filteredScores.length === currentScores.length) {
        return song;
      }

      affectedSongs += 1;
      removedSongScores += currentScores.length - filteredScores.length;
      return {
        ...song,
        scores: filteredScores,
        topScore: toTopScoreFromScores(filteredScores),
      };
    });

    if (removedGlobalScores === 0 && removedSongScores === 0) {
      return fail(res, 404, "Player not found on any leaderboard.");
    }

    writeGlobalScores(sortGlobalScoresDesc(nextGlobalScores));
    if (affectedSongs > 0) {
      writeSongs(nextSongs);
    }

    const result: LeaderboardModerationResult = {
      username,
      reason,
      removedGlobalScores,
      removedSongScores,
      affectedSongs,
    };

    return ok(res, result);
  });

  app.get("/api/songs", (_req, res) => {
    const songs = sortSongsDesc(readSongs());
    return ok(res, songs);
  });

  app.get("/api/songs/:id", (req, res) => {
    const songs = readSongs();
    const song = songs.find((entry) => entry.id === req.params.id);
    if (!song) return fail(res, 404, "Song not found");
    return ok(res, song);
  });

  app.post("/api/songs", uploader.single("audio"), (req, res) => {
    if (!req.file) {
      return fail(res, 400, "Audio file is required.");
    }

    const id = crypto.randomUUID();
    const name = (typeof req.body?.name === "string" && req.body.name.trim()) || "Untitled";
    const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
    const difficulty = clampNumber(req.body?.difficulty, 0.5);
    const density = clampNumber(req.body?.density, 0.5);
    const laneVariety = clampNumber(req.body?.laneVariety, 0.5);
    const sliderProbability = clampNumber(req.body?.sliderProbability, 0.3);
    const stamina = clampNumber(req.body?.stamina, 0.5);
    const authorName = (typeof req.body?.authorName === "string" && req.body.authorName.trim()) || "Anonymous";

    let notes: unknown[] = [];
    try {
      const parsed = typeof req.body?.notes === "string" ? JSON.parse(req.body.notes) : [];
      if (Array.isArray(parsed)) notes = parsed;
    } catch {
      notes = [];
    }

    const fileExt = path.extname(req.file.originalname || ".mp3");
    const safeAudioName = sanitizeFileName(req.file.originalname ? path.parse(req.file.originalname).name : "audio");
    const safeFileName = `${safeAudioName}${fileExt || ".mp3"}`;
    const songDir = path.join(UPLOAD_DIR, "songs", id);
    const notesFile = "notes.json";
    const audioAbsolute = path.join(songDir, safeFileName);
    const notesAbsolute = path.join(songDir, notesFile);

    try {
      if (!fs.existsSync(songDir)) fs.mkdirSync(songDir, { recursive: true });
      writeFileAtomic(audioAbsolute, req.file.buffer);
      writeFileAtomic(notesAbsolute, JSON.stringify(notes));

      const newSong: CommunitySongRecord = {
        id,
        name,
        artist,
        difficulty,
        density,
        laneVariety,
        sliderProbability,
        stamina,
        topScore: 0,
        scores: [],
        authorName,
        createdAt: new Date().toISOString(),
      audioPath: `songs/${id}/${safeFileName}`,
      notesPath: `songs/${id}/${notesFile}`,
        audioUrl: `/api/uploads/songs/${id}/${safeFileName}`,
        notesUrl: `/api/uploads/songs/${id}/${notesFile}`,
        status: "ready",
      };

      const songs = readSongs();
      songs.push(newSong);
      writeSongs(songs);

      return ok(res, newSong);
    } catch (error) {
      if (fs.existsSync(songDir)) {
        fs.rmSync(songDir, { recursive: true, force: true });
      }
      console.error("Song upload failed:", error);
      return fail(res, 500, "Failed to save song.");
    }
  });

  app.patch("/api/songs/:id", requireAdmin, (req, res) => {
    const songs = readSongs();
    const index = songs.findIndex((entry) => entry.id === req.params.id);
    if (index === -1) return fail(res, 404, "Song not found");
    const current = songs[index];
    const updates = req.body || {};
    const next = {
      ...current,
      ...updates,
    };
    songs[index] = next as CommunitySongRecord;
    writeSongs(songs);
    return ok(res, next as CommunitySongRecord);
  });

  app.post("/api/songs/:id/scores", (req, res) => {
    const songs = readSongs();
    const index = songs.findIndex((entry) => entry.id === req.params.id);
    if (index === -1) return fail(res, 404, "Song not found");
    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const entry: ScoreRecord = {
      score,
      accuracy,
      date: new Date().toLocaleDateString(),
      username,
    };

    const song = songs[index];
    const scores = sortScoresDesc([...(song.scores || []), entry]).slice(0, 5);
    song.scores = scores;
    song.topScore = Math.max(song.topScore || 0, score);
    writeSongs(songs);
    return ok(res, song);
  });

  app.delete("/api/songs/:id", requireAdmin, (req, res) => {
    const songs = readSongs();
    const song = songs.find((entry) => entry.id === req.params.id);
    if (!song) return fail(res, 404, "Song not found");

    const nextSongs = songs.filter((entry) => entry.id !== req.params.id);
    writeSongs(nextSongs);

    const songDir = path.join(UPLOAD_DIR, "songs", req.params.id);
    const legacySongDir = path.join(UPLOAD_DIR, req.params.id);
    if (fs.existsSync(songDir)) {
      fs.rmSync(songDir, { recursive: true, force: true });
    }
    if (fs.existsSync(legacySongDir)) {
      fs.rmSync(legacySongDir, { recursive: true, force: true });
    }

    return ok(res, { message: "Song deleted." });
  });

  app.get("/api/global-scores", (req, res) => {
    const limit = clampNumber(req.query.limit, 100);
    const offset = clampNumber(req.query.offset, 0);
    const scores = sortGlobalScoresDesc(readGlobalScores());
    const start = Math.max(0, offset);
    const end = Math.min(scores.length, start + Math.max(1, limit));
    const chunk = scores.slice(start, end);
    const nextOffset = end < scores.length ? end : null;
    return ok(res, { scores: chunk, nextOffset });
  });

  app.post("/api/global-scores", (req, res) => {
    const score = clampNumber(req.body?.score, Number.NaN);
    const accuracy = clampNumber(req.body?.accuracy, Number.NaN);
    const songName = (typeof req.body?.songName === "string" && req.body.songName.trim()) || "Unknown Song";
    const artist = (typeof req.body?.artist === "string" && req.body.artist.trim()) || "Unknown Artist";
    const username = (typeof req.body?.username === "string" && req.body.username.trim()) || "Anonymous";
    const date = (typeof req.body?.date === "string" && req.body.date.trim()) || new Date().toLocaleDateString();

    if (!Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "Score and accuracy must be numbers.");
    }

    const scores = readGlobalScores();
    const newScore: GlobalScoreRecord = {
      id: crypto.randomUUID(),
      score,
      accuracy,
      date,
      createdAt: new Date().toISOString(),
      username,
      songName,
      artist,
    };
    scores.push(newScore);
    writeGlobalScores(sortGlobalScoresDesc(scores));
    return ok(res, { id: newScore.id });
  });

  app.get("/api/replays", (_req, res) => {
    const replays = sortReplaysDesc(readReplays());
    return ok(res, replays);
  });

  app.post("/api/replays", (req, res) => {
    const body = req.body || {};
    const songId = (typeof body.songId === "string" && body.songId.trim()) || "";
    const songName = (typeof body.songName === "string" && body.songName.trim()) || "";
    const score = clampNumber(body.score, Number.NaN);
    const accuracy = clampNumber(body.accuracy, Number.NaN);

    if (!songId || !songName || !Number.isFinite(score) || !Number.isFinite(accuracy)) {
      return fail(res, 400, "songId, songName, score and accuracy are required.");
    }

    const replays = readReplays();
    const newReplay: ReplayRecord = {
      id: crypto.randomUUID(),
      songId,
      songName,
      artist: (typeof body.artist === "string" && body.artist.trim()) || "Unknown Artist",
      difficulty: clampNumber(body.difficulty, 0.5),
      density: clampNumber(body.density, 0.5),
      laneVariety: clampNumber(body.laneVariety, 0.5),
      sliderProbability: clampNumber(body.sliderProbability, 0.3),
      stamina: clampNumber(body.stamina, 0.5),
      score,
      accuracy,
      date: (typeof body.date === "string" && body.date.trim()) || new Date().toLocaleDateString(),
      createdAt: new Date().toISOString(),
      events: Array.isArray(body.events) ? body.events : [],
    };
    replays.push(newReplay);
    writeReplays(sortReplaysDesc(replays));
    return ok(res, newReplay);
  });

  app.get("/api/integrity", (_req, res) => {
    const songs = readSongs();
    const scores = readGlobalScores();
    const replays = readReplays();
    const storageIssues = songs
      .map((song) => {
        const { missingAudio, missingNotes } = hasSongAssets(song);
        return {
          id: song.id,
          name: song.name,
          artist: song.artist,
          missingAudio,
          missingNotes,
        } as SongStorageIssue;
      })
      .filter((issue) => issue.missingAudio || issue.missingNotes);

    return ok(res, {
      songsCount: songs.length,
      scoresCount: scores.length,
      replaysCount: replays.length,
      missingAssetSongsCount: storageIssues.length,
      missingAssetSongs: storageIssues,
    });
  });

  app.get("/api/audio-proxy", async (req, res) => {
    const audioUrl = req.query.url as string;
    if (!audioUrl) {
      return res.status(400).send("Missing URL");
    }
    try {
      const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0]
        : req.protocol;
      const baseUrl = `${forwardedProto}://${req.get("host")}`;
      const resolvedUrl = new URL(audioUrl, baseUrl).toString();
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        return res.status(response.status).send("Failed to fetch audio");
      }
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
