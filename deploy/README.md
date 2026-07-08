# Doc-Hub deploy samples

Self-contained `docker compose` samples for self-hosting Doc-Hub. Each file in
[`compose/`](./compose) is standalone (no overlay/`extends` chaining), carries a
documented header explaining when to use it, and reads secrets from a shared
[`.env`](./.env.example).

```bash
cp deploy/.env.example deploy/.env       # edit as needed
cd deploy/compose
docker compose --env-file ../.env -f coediting.yml up -d --build
```

The `build.context` in every sample is `../..` (the repo root, where the
`Dockerfile` lives), so run compose from inside `deploy/compose/`.

## Sample matrix

| Sample | Includes | Co-editing | Storage | Database | When to use | Env you MUST set |
|---|---|---|---|---|---|---|
| `coediting.yml` | dochub + collab + minio + minio-init | Yes | bundled MinIO | SQLite (file) | The complete self-host: multiple people editing one document live. Start here. | none — all dev defaults work (override secrets for real use) |
| `single-user.yml` | dochub + minio + minio-init | No | bundled MinIO | SQLite (file) | Simplest deploy; personal / single-editor. Fully functional, just no live cursors. | none |
| `postgres.yml` | dochub + collab + postgres + minio + minio-init | Yes | bundled MinIO | Postgres | Co-editing with Postgres for concurrent load / managed backups. | none — in-compose postgres has a default; override `DOCHUB_DB_URL` for external |
| `external-storage.yml` | dochub + collab | Yes | external S3 (AWS/R2/B2/…) | SQLite (file) | Co-editing against a real managed S3-compatible bucket instead of MinIO. | `DOCHUB_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ `DOCHUB_S3_ENDPOINT` for non-AWS) |
| `production.yml` | dochub only (collab/db/storage external) | Yes (external collab) | external S3 | external Postgres | Hardened template for an internet-facing deploy behind a TLS proxy. Not turnkey. | everything — no fallbacks; see the file header |

All samples require `DOCHUB_MASTER_KEY` (base64 32-byte KEK): the binary refuses
to boot without at-rest encryption. The dev-defaulted samples embed a throwaway
key so `up` is one command; `production.yml` has no default.

## Co-editing vs single-user

Co-editing adds the `collab` gateway (`casualoffice/docs:0.0.5`, run in
`GATEWAY_HOST=inline` mode). It is format-agnostic — one service brokers both
`.docx` and `.xlsx` rooms — and gives live cursors, presence, and simultaneous
editing.

Single-user (`single-user.yml`) drops the gateway entirely. Every editor still
opens, edits, and saves versioned documents; there is just no live collaboration
on the same file. It is the smallest footprint. The switch is two things:
`DOCHUB_COLLAB_URL` is left unset (so the backend emits no room ws_url and the
editors fall back to single-user), and the SPA is built without the
`VITE_DRIVE_COLLAB_BACKEND_URL` build-arg.

## The dual collab-URL footgun

When co-editing is on there are **two** collab URLs and both point at the **same**
gateway — because both are consumed in the **browser**, never server-side:

- **`DOCHUB_COLLAB_URL`** (dochub runtime env) is *not* a URL dochub dials. The
  backend only reflects it into the room `ws_url` it returns to the browser
  (`collab_ws_url` in `crates/dochub-http/src/collab.rs`, `http`→`ws`, path
  `/yjs`). It must therefore be reachable **from the browser** — the
  host-published gateway (`:8082` locally, your public collab host in prod) —
  **never** the compose-internal `http://collab:8080`.
- **`VITE_DRIVE_COLLAB_BACKEND_URL`** is a **build arg** baked into the SPA
  bundle at `docker build`. Also browser-facing ⇒ also the host-published/public
  ws URL. Rebuild the image whenever it changes.

Getting this wrong is the usual failure mode: compose DNS names (`collab:8080`)
resolve inside the network but not in the user's browser, so co-editing silently
fails to connect.

Note the contrast in `postgres.yml`: `DOCHUB_DB_URL` points at the
compose-internal `postgres:5432` — that IS correct, because the database
connection is server-side. Only the browser-facing collab URLs must avoid
compose DNS.

## The shared-secret requirement

The collab gateway validates the per-file HS256 editor tokens dochub mints, so
the gateway's `CASUAL_JWT_SECRET` **must equal** dochub's
`DOCHUB_WOPI_HMAC_SECRET`. In the in-compose samples both reference the single
`${DOCHUB_WOPI_HMAC_SECRET}` interpolation, so they cannot drift. In
`production.yml` the gateway is external — wire its `CASUAL_JWT_SECRET` to the
same value by hand. A mismatch rejects every editor token and co-editing fails
authorization.

## Storage and database notes

- **Storage backends** are OpenDAL-backed behind Doc-Hub's storage facade. The
  bundled samples use MinIO (`DOCHUB_BACKEND=minio`); `external-storage.yml` and
  `production.yml` use `DOCHUB_BACKEND=s3` against any S3-compatible endpoint
  (AWS S3, Cloudflare R2, Backblaze B2, Wasabi). For real AWS you may leave
  `DOCHUB_S3_ENDPOINT` empty; set it for the others. Bucket creation is
  automated only for the bundled MinIO (`minio-init`); create external buckets
  yourself.
- **Database**: the sqlx pool is backend-erased (`sqlx::Any`) and migrations are
  portable across SQLite and Postgres (TEXT ULIDs, ISO-8601 UTC, INTEGER bools —
  no JSONB/enum/native-UUID). SQLite is the default; `postgres.yml` and
  `production.yml` use Postgres.

## Production checklist

`production.yml` is a **template**, not a one-command stack. Before it is safe:

1. Put a TLS reverse proxy (Caddy/Traefik/nginx) on `:443` in front — dochub
   binds to loopback and speaks plain HTTP. Forward the app origin, the
   user-content origin (distinct hostname, same binary), and the collab host.
   Set `X-Forwarded-Proto=https` so session cookies get `Secure`.
2. Set every required var in `.env` — there are no dev fallbacks and
   `DOCHUB_PROD=true` makes the binary reject dev-default secrets and equal
   origins.
3. Point `DOCHUB_COLLAB_URL` / `VITE_DRIVE_COLLAB_BACKEND_URL` at the **public**
   collab hostname (https/wss), and set that gateway's `CASUAL_JWT_SECRET` to
   your `DOCHUB_WOPI_HMAC_SECRET`.
4. Use restart policies (`restart: always`, already set) and back up Postgres +
   the object store.
