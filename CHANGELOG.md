# Changelog

All notable changes to Casual Drive land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Phase 1 — DB + admin auth
- `drive-db` new crate: sqlx `Any` pool with portable SQLite + Postgres
  migrations. Initial schema covers users, sessions, folders, files,
  `wopi_locks`, share_links. `UserRepo` + `SessionRepo` shipped with 4
  integration tests against `sqlite::memory:`. Pool sized 1 for SQLite
  (single-writer + per-connection in-memory caveat).
- `drive-auth` filled in: Argon2id at OWASP minimum (`m=19 MiB, t=2, p=1`),
  constant-time-ish sign-in that never leaks "no such user" vs "wrong
  password", server-side session inserts with 256-bit IDs + CSRF tokens,
  `AuthSession` axum extractor, sign-in/sign-out handlers on
  `/api/auth/{sign-in,sign-out}`. Cookie: `__Host-cd_sid` in prod /
  `cd_sid` in unencrypted dev, `HttpOnly`, `SameSite=Lax`, `Path=/`,
  Max-Age from session TTL.
- `drive-http` extended: `HttpState` now carries `db: Db` and
  `auth: AuthState`; `FromRef<HttpState> for AuthState` wires the
  extractor; auth router merged into the app-origin router. 3 new
  integration tests for the sign-in success and failure paths.
- `drive-bin` wires it all: connects the DB, runs migrations on boot,
  seeds the admin user from env if missing, builds `AuthState` with
  `cookie_secure` derived from `app_origin` scheme. Verified end-to-end:
  /healthz 200, wrong-host 421, /api/me returns JSON, unknown-user and
  wrong-password both 401 (no enumeration leak).
- Workspace test count: **37 passing** across the six crates (was 28).
- Clippy `--all-targets -- -Dwarnings` clean. Workspace lints tuned: kept
  the substantive `clippy::pedantic` group, allowed the pure-style
  subcategories (`struct_excessive_bools`, `match_same_arms`,
  `needless_pass_by_value`, `manual_let_else`, `doc_markdown`, etc.).

### Added
- Planning artefacts: `PLAN.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
  `docs/research/00–06`, `docs/ux/01-flows.md`, `docs/ux/02-surface.md`.
- Phase 0 spikes (all green):
  - `spikes/01-storage` — `Storage` facade over OpenDAL with HMAC token
    presign for filesystem/memory. 14/14 conformance tests.
  - `spikes/02-wopi-host` — Axum WOPI host implementing 7 endpoints with
    in-memory state. 8/8 integration tests covering the 409 + `X-WOPI-Lock`
    contract, UnlockAndRelock dispatch, and access-token scoping.
  - `spikes/04-two-origin` — Two-origin Axum binary with host-dispatch
    middleware and `/raw/{token}` HMAC handler. 10/10 tests.
  - `spikes/05-spa-shell` — React 19 + Vite 7 + Tailwind v4 + Lucide on Inter,
    polish-principle tokens ported into CSS @theme, empty-state surface
    rendering in light + dark with `prefers-color-scheme` + manual override.
    Build + typecheck clean.
  - Spike #3 (sheet/ WOPI client retrofit) deferred — it's a cross-repo
    change that lands as a deliberate Sheet PR after Phase 1.
- Repo chassis: Cargo workspace with `drive-core`, `drive-storage`,
  `drive-wopi`, `drive-auth`, `drive-http`, `drive-bin` (stubs).
- Apache-2.0 LICENSE + NOTICE.
- CI: `cargo fmt`, `cargo clippy`, `cargo test --workspace`, spike tests,
  `cargo audit`, `cargo deny`, Docker build.
- Multi-stage `Dockerfile` (cargo-chef) producing a single static binary in
  `debian:trixie-slim`.
- `docker-compose.dev.yml` with MinIO sidecar.

### Phase 1 — walking skeleton (in flight)
- `drive-core` populated: `FileId`/`FolderId` (ULID, opaque), `DriveError`,
  `Config` with strict env validation (refuse-prod-on-default-secrets,
  origin-mismatch check, backend-specific required-field checks).
- `drive-storage` lifted from spike #1: `Storage::from_config(&Config)`,
  capability-gated `copy`/`rename` synthesis, `SignedUrl::Token`/`Native`
  variants. 12 conformance tests across fs + memory.
- `drive-wopi` lifted from spike #2: 7-endpoint router (CheckFileInfo,
  GetFile, PutFile, Lock, Unlock, RefreshLock, UnlockAndRelock), file-id
  scoped JWT access tokens, the asymmetric 409 + `X-WOPI-Lock` contract,
  in-memory lock state (`WopiState`). 4 integration tests on the full
  edit cycle.
- `drive-http` lifted from spike #4: two-origin host-dispatch middleware
  (421 on wrong origin), strict CSP on app origin, sandbox CSP +
  `Cross-Origin-Resource-Policy` on user-content origin, streaming
  `/raw/{token}` handler. 6 integration tests.
- `drive-bin` runnable: loads `Config::from_env`, builds Storage +
  `HttpState`, serves on configured bind. Tracing init. Verified end-to-end
  against a memory backend (healthz 200, /api/me 200, wrong-host 421).

### Logo + brand assets
- `logo.svg` — wordmark + mark, monochrome crescent in a rounded square.
- `assets/logo-mark.svg` — currentColor mark for chrome embedding.
- `assets/favicon.svg` — favicon variant.
- Wired into the SPA spike (`spikes/05-spa-shell/src/components/Logo.tsx`)
  replacing the placeholder Lucide cloud glyph.
- Wired into `README.md` header.

### Notes
- Phase 0 spike code stays under `spikes/` as documented PoCs; the Phase 1
  crates are the runtime path going forward.
