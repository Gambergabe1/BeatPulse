# BeatPulse

BeatPulse is a full-stack rhythm game that turns local audio into playable charts, publishes community songs, saves replays, and supports a live social multiplayer network.

## What is included

- Automatic four-lane chart generation with difficulty and advanced chart controls
- Community song library, per-song scores, global rankings, and replay playback
- Stable player profiles with protected device credentials and shareable friend codes
- Friend requests, accept/decline, online and in-game presence, removal, and blocking
- Private direct messages with unread counts and match invites
- Two-to-eight-player rooms with join codes, ready checks, lobby chat, host migration, and rematches
- Shared countdown timing plus live score, combo, accuracy, progress, and final standings
- Local JSON/file persistence for development and Postgres + Vercel Blob support for deployment
- Responsive layouts, keyboard focus states, reduced-motion support, and touch controls

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set a strong `ADMIN_PASSWORD`.
3. Start BeatPulse with `npm run dev`.
4. Open `http://localhost:3000`.

Use `npm run lint` for TypeScript validation and `npm run build` for a production build.

## Chart generation and replay loop

Uploaded songs are charted in the browser (in a Web Worker, so the menu stays responsive). The generator estimates the tempo, refines it to 0.01 BPM and re-fits the beat phase every two bars, so charts stay on the beat for the whole song even when a recording drifts. Each difficulty targets its own note rate, strong accents are favoured, faint bleed is ignored, and drumless breakdowns become slow sustained holds. `npm run test:charts` checks alignment, tempo drift, difficulty ordering and breakdown handling on synthetic tracks.

Every song and difficulty keeps a local record (best score, rank, combo, full combo, attempts). The results screen shows the next goal for that chart, awards bonus XP and Pulse Shards for a new personal best, a first clear or a first full combo, and can re-chart a local upload one difficulty up. Press **R** on the results screen to retry, **Esc** in a run to pause, and **`** (backquote) to restart instantly.

## Friends and multiplayer

Each browser creates a stable player ID and a separate private credential. The server stores only a SHA-256 hash of that credential. Players can exchange the friend code shown in **Social → Friends**. Accepted friends can message each other and receive room invitations.

Multiplayer rooms use community songs so every participant receives the same stored audio and chart. The host chooses a song, shares the six-character room code, waits for all players to ready up, and starts a shared 15-second load/countdown window. Live match state is refreshed throughout play and rooms automatically move to results once everyone finishes.

## Persistence

The local server stores metadata in `.server-data/` and song assets in `uploads/`. Both directories are ignored by Git. Writes are atomic, and old chat/room data is compacted automatically.

For a mounted local production volume, configure:

- `BEATPULSE_DATA_DIR` for JSON metadata
- `BEATPULSE_UPLOAD_DIR` for audio and note assets

The serverless route creates the required Postgres tables automatically and uses the existing `DATABASE_URL`/`POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` variables.

### Vercel function budget

The Vercel Hobby plan allows at most 12 Serverless Functions per deployment, and every file in `api/` counts as one. The whole API therefore ships as a **single function**: `api/index.ts` dispatches to the handlers in `serverless/routes/`, and `vercel.json` rewrites `/api/<path>` to it. To add an endpoint, add a handler under `serverless/routes/` and register it in the `ROUTES` table in `api/index.ts`. Do not add new files to `api/`.

## Admin

Admin access uses `ADMIN_PASSWORD` from `.env.local`/`.env` or the Vercel environment. Deployed builds have no default password: admin stays locked until `ADMIN_PASSWORD` is set. Only `npm run dev` falls back to `admin1234`. See `ADMIN_SETUP.md`.
