<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/55cf825e-b8ca-40aa-a7d3-12c87156e76f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Admin panel

The project now ships with working admin endpoints in `server.ts`. On first server start, the app creates `.admin-state.json` and uses `admin1234` as the default password unless `ADMIN_PASSWORD` is set in your environment. Change it immediately from the in-app admin screen after logging in.


## Local storage backend

This project now uses the built-in local backend in `server.ts` for songs, scores, replays, and admin actions.
No external managed backend service is required for save/load or admin login flows.

### Persistence guarantees

Song audio files are stored under `uploads/<songId>/...` and metadata is stored in `.server-data/songs.json` by default.
Both are only removed when `/api/songs/:id` is called from an authenticated admin session (the admin panel delete button).
Uploads are written with atomic file writes, so a failed upload does not leave partial or orphaned song records.

If you want persistence across restarts on a platform with ephemeral disks, point the server at a mounted volume by setting:
- `BEATPULSE_DATA_DIR` (metadata)
- `BEATPULSE_UPLOAD_DIR` (audio + notes files)
