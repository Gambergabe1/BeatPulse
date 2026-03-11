# BeatPulse Admin Setup

This project now includes working admin endpoints:
- `POST /api/admin/login`
- `POST /api/admin/password`

## Default admin password
On first server start, BeatPulse creates `.admin-state.json` automatically.

Default password:
- `admin1234`

You can override the first-run password by setting:
- `ADMIN_PASSWORD=your-password`

## Important
- Change the default password after first login.
- `.admin-state.json` stores the hashed password and signing secret.
- When you change the password, existing admin tokens are invalidated automatically.
