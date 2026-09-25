# BeatPulse Admin Setup

Admin endpoints:
- `POST /api/admin/login`
- `POST /api/admin/password`

## Setting the admin password
Set `ADMIN_PASSWORD` (in `.env.local` locally, or in the Vercel project's environment variables).

- **Vercel / production:** there is no default password. Until `ADMIN_PASSWORD` is set, every admin login fails. While it is set, it always wins, so you can also use it to recover access. Change the password by updating the variable.
- **Local development (`npm run dev`):** if `ADMIN_PASSWORD` is unset, the local server accepts `admin1234` so you can try the panel. A production start (`NODE_ENV=production`) never uses that fallback.
- The admin panel can change the password (at least 8 characters) only while `ADMIN_PASSWORD` is unset, because the variable would override it. To manage it from the panel on Vercel: set `ADMIN_PASSWORD`, log in once, then remove the variable and redeploy. The stored password keeps working. Existing admin sessions are signed out whenever the password changes.

## Where state is stored
- Vercel: the `admin_state` table in Postgres. A stored hash of the old public default `admin1234` is discarded automatically.
- Local server: `.server-data/admin-state.json` (ignored by Git). The old root-level `.admin-state.json` is no longer read.
