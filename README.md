

Done By Gabriel Baca (Kirigaya) Please Make sure if you are viewing thing you are truely locked in


## Admin panel

The project now ships with working admin endpoints in `server.ts`. On first server start, the app creates `.admin-state.json` and uses `admin1234` as the default password unless `ADMIN_PASSWORD` is set in your environment. Change it immediately from the in-app admin screen after logging in.


## Local storage backend

This project now uses the built-in local backend in `server.ts` for songs, scores, replays, and admin actions.
No external managed backend service is required for save/load or admin login flows.

Admin sign-in uses `ADMIN_PASSWORD` from `.env.local` or `.env` (falls back to `admin1234` if not set).

### Persistence guarantees

Song audio files are stored under `uploads/<songId>/...` and metadata is stored in `.server-data/songs.json` by default.
Both are only removed when `/api/songs/:id` is called from an authenticated admin session (the admin panel delete button).
Uploads are written with atomic file writes, so a failed upload does not leave partial or orphaned song records.

If you want persistence across restarts on a platform with ephemeral disks, point the server at a mounted volume by setting:
- `BEATPULSE_DATA_DIR` (metadata)
- `BEATPULSE_UPLOAD_DIR` (audio + notes files)
