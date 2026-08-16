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

## Friends and multiplayer

Each browser creates a stable player ID and a separate private credential. The server stores only a SHA-256 hash of that credential. Players can exchange the friend code shown in **Social → Friends**. Accepted friends can message each other and receive room invitations.

Multiplayer rooms use community songs so every participant receives the same stored audio and chart. The host chooses a song, shares the six-character room code, waits for all players to ready up, and starts a shared 15-second load/countdown window. Live match state is refreshed throughout play and rooms automatically move to results once everyone finishes.

## Persistence

The local server stores metadata in `.server-data/` and song assets in `uploads/`. Both directories are ignored by Git. Writes are atomic, and old chat/room data is compacted automatically.

For a mounted local production volume, configure:

- `BEATPULSE_DATA_DIR` for JSON metadata
- `BEATPULSE_UPLOAD_DIR` for audio and note assets

The serverless route creates the required Postgres tables automatically and uses the existing `DATABASE_URL`/`POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` variables.

## Admin

The first local start creates `.admin-state.json`. Admin access uses `ADMIN_PASSWORD` from `.env.local` or `.env`; the fallback is `admin1234`, which should only be used for the first local login and changed immediately from the admin panel.
