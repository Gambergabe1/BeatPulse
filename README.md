<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# BeatPulse

This app ships with a Vite frontend and a Vercel-native API for songs, scores, replays, and admin auth.

## Run locally (current local backend)

1. Install dependencies:
   `npm install`
2. Set env vars in `.env.local`:
   - `GEMINI_API_KEY`
3. Start the local server:
   `npm run dev`

## Vercel API backend (what this repo now uses for deployment)

1. Install dependencies:
   `npm install`
2. Set env vars for API mode in `.env` or `.env.local`:
   - `ADMIN_PASSWORD` (optional, defaults to `admin1234`)
   - `POSTGRES_URL` or `DATABASE_URL`
   - `BLOB_READ_WRITE_TOKEN`
3. Deploy with Vercel (`npm run build` for local production preview).

## Deploy to Vercel

1. Create a Vercel project connected to this repo.
2. Ensure these env vars are set in the Vercel dashboard:
   - `POSTGRES_URL` or `DATABASE_URL`
   - `BLOB_READ_WRITE_TOKEN`
   - `ADMIN_PASSWORD` (recommended)
   - `GEMINI_API_KEY` (if the frontend requires it)
3. Deploy; Vercel will:
   - build the React frontend with `vite build`
   - serve `/api/*` via `api/index.ts`

## API endpoints

- `POST /api/admin/login`
- `POST /api/admin/password`
- `GET /api/songs`
- `POST /api/songs`
- `PATCH /api/songs/:id`
- `DELETE /api/songs/:id`
- `POST /api/songs/:id/scores`
- `GET /api/global-scores`
- `POST /api/global-scores`
- `GET /api/replays`
- `POST /api/replays`
- `GET /api/integrity`
- `GET /api/audio-proxy`