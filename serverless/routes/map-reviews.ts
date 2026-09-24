import * as crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function body(req: any): Record<string, unknown> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function songId(req: any) {
  const value = req.query?.songId;
  return text(Array.isArray(value) ? value[0] : value, 100);
}

async function prepareSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS map_reviews (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      username TEXT NOT NULL,
      rating INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS map_reviews_song_id_created_at_idx ON map_reviews (song_id, created_at DESC)`;
}

export default async function handler(req: any, res: any) {
  try {
    await prepareSchema();
    if (req.method === 'GET') {
      const id = songId(req);
      if (!id) return res.status(400).json({ success: false, error: 'A song id is required.' });
      const { rows } = await sql`SELECT id, song_id AS "songId", username, rating, body, created_at AS "createdAt" FROM map_reviews WHERE song_id = ${id} ORDER BY created_at DESC LIMIT 30`;
      return res.status(200).json({ success: true, data: rows });
    }
    if (req.method === 'POST') {
      const payload = body(req);
      const id = text(payload.songId, 100);
      const username = text(payload.username, 24) || 'Player';
      const review = text(payload.body, 400);
      const requestedRating = Math.round(Number(payload.rating));
      if (!id || !Number.isFinite(requestedRating) || requestedRating < 1 || requestedRating > 5) return res.status(400).json({ success: false, error: 'A song and a 1–5 star rating are required.' });
      const rating = requestedRating;
      const record = { id: crypto.randomUUID(), songId: id, username, rating, body: review, createdAt: new Date().toISOString() };
      await sql`INSERT INTO map_reviews (id, song_id, username, rating, body, created_at) VALUES (${record.id}, ${record.songId}, ${record.username}, ${record.rating}, ${record.body}, ${record.createdAt})`;
      return res.status(200).json({ success: true, data: record });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error('map review error', error);
    return res.status(500).json({ success: false, error: 'Could not save map feedback.' });
  }
}
