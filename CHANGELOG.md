# Changelog

All notable changes to Casual Drive land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Notes
- Phase 0 is throwaway-spike territory; nothing here is production code yet.
  Phase 1 (walking skeleton) is the next milestone — see `PLAN.md`.
