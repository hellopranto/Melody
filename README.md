# Melody Backend

Starter REST API for the Melody music app: Express + TypeScript, PostgreSQL, JWT admin authentication, and Cloudflare R2 presigned audio uploads.

## Important

This is a starter backend, not a claim that your current Render service has been changed. You must deploy it to your own repository/service and configure secrets before using it. Do not use real user data until you have reviewed and tested it.

## 1. Requirements

- Node.js 20+
- PostgreSQL database (Neon is one option)
- Cloudflare R2 bucket and S3 API credentials for uploads/streaming
- Render web service

## 2. Local setup

```bash
npm install
cp .env.example .env
```

Fill `.env` with real values. Generate secrets locally, for example:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use different random values for `JWT_SECRET` and `ADMIN_BOOTSTRAP_TOKEN`.

Set `DATABASE_URL`. For production PostgreSQL, use the provider's TLS-enabled connection string.

## 3. Configure R2

Set:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`

For direct browser uploads, configure bucket CORS to allow only your real frontend origin and `PUT` requests with `Content-Type`. Do not use `*` in production. Signed URL expiry is controlled by `SIGNED_URL_SECONDS`.

## 4. Database and run

```bash
npm run db:migrate
npm run dev
```

Check:
- `GET http://localhost:3000/health`
- `GET http://localhost:3000/api`
- `GET http://localhost:3000/api/songs`

## 5. Create the first admin once

Use the one-time bootstrap route with `x-bootstrap-token` header matching `ADMIN_BOOTSTRAP_TOKEN`.

```bash
curl -X POST http://localhost:3000/api/auth/admin/bootstrap \
  -H "Content-Type: application/json" \
  -H "x-bootstrap-token: YOUR_BOOTSTRAP_TOKEN" \
  -d '{"email":"admin@example.com","password":"Use-A-Long-Unique-Password!","displayName":"Melody Admin"}'
```

The route refuses to create an admin if one already exists. After successful bootstrap, remove or rotate `ADMIN_BOOTSTRAP_TOKEN` in the Render environment and redeploy. Keep the bootstrap token private.

Admin login:
`POST /api/auth/admin/login`
```json
{"email":"admin@example.com","password":"your-password"}
```
Use returned token as `Authorization: Bearer TOKEN`.

## 6. Render deployment

1. Push this folder to a new GitHub repository, or merge it carefully into your existing backend repo.
2. In Render, create a Web Service from the repo.
3. Build command: `npm install && npm run build && npm run db:migrate`
4. Start command: `npm start`
5. Add environment variables from `.env.example` in Render dashboard.
6. Deploy and verify `/health` returns `ok: true` and `database: connected`.

For production, it is often safer to run `npm run db:migrate` as a separate one-off deploy step rather than automatically on every start. Keep migrations reviewed and backed up.

## 7. Upload flow

1. Admin signs in and receives a short-lived JWT.
2. `POST /api/songs/admin/uploads/presign` with:
```json
{"filename":"licensed-track.mp3","contentType":"audio/mpeg","sizeBytes":1234567}
```
3. Browser uploads bytes to returned `uploadUrl` with `PUT` and matching `Content-Type`.
4. `POST /api/songs/admin/uploads/UPLOAD_ID/complete` with:
```json
{"title":"Track Title","artistName":"Artist Name","albumName":"Album Name","genre":"Pop","durationSeconds":180}
```
5. The backend verifies object size and saves the song as a draft.
6. Admin reviews and publishes using `PATCH /api/songs/admin/SONG_ID/publish`.

For cover upload, implement a separate presigned image upload route before using `coverKey`. This starter accepts a cover key but does not issue cover-upload URLs.

## 8. API list

- `GET /health`
- `GET /api`
- `POST /api/auth/admin/bootstrap` (one-time)
- `POST /api/auth/admin/login`
- `GET /api/auth/me`
- `GET /api/songs`
- `GET /api/songs/search?q=term`
- `GET /api/songs/:id`
- `GET /api/songs/:id/stream`
- `GET /api/songs/admin` (admin)
- `POST /api/songs/admin/uploads/presign` (admin)
- `POST /api/songs/admin/uploads/:uploadId/complete` (admin)
- `PATCH /api/songs/admin/:id/publish` (admin)
- `PATCH /api/songs/admin/:id/unpublish` (admin)

## Limitations to resolve before production

- No public user registration or user self-service auth yet.
- Cover image upload URL route not yet implemented.
- Admin token is a bearer JWT; production deployment should use HTTPS, short token lifetime, secure storage and preferably refresh-token/session rotation if required.
- Add deletion endpoints with object cleanup, upload-job expiry cleanup, backups, monitoring and integration tests.
- MIME type validation is not full media-file content inspection. Add server-side media probing/scanning for production.
- Direct upload CORS must be configured on R2.
- Test Range requests and playback in the target clients. The stream endpoint redirects to a short-lived signed object URL.
- Public song list currently returns `cover_key`, not a public image URL. Add a controlled cover delivery strategy.
- Add pagination and stricter operational logging before a large catalog.
