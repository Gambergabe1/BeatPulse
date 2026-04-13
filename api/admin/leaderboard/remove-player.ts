import { sql } from "@vercel/postgres";
import {
  clampNumber,
  extractBearerToken,
  fail,
  getAdminState,
  normalizeUsername,
  ok,
  prepareAdminStateSchema,
  toDisplayDate,
  toIsoTimestamp,
  toText,
  verifyAdminToken,
} from "../shared.ts";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

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
    await prepareAdminStateSchema();
    await Promise.all([prepareSongsSchema(), prepareGlobalScoresSchema()]);

    const token = extractBearerToken(req);
    const adminState = await getAdminState();
    if (!token || !verifyAdminToken(token, adminState.tokenSecret)) {
      return fail(res, 401, "Unauthorized.");
    }

    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

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
