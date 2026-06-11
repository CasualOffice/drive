# 11 — Co-edit setup (operator guide)

Companion to `10-sdk-integration-plan.md` §"Phase 1 — SDK +
DriveFileSource". This doc tells operators how to flip Drive from
single-container standalone into multi-peer real-time co-edit by
adding the document editor's collab gateway alongside.

> **Scope.** Doc (.docx) co-edit only. Sheet (.xlsx) co-edit
> requires the `@schnsrw/casual-sheets` SDK to expose a `backendUrl`
> prop on `<CasualSheets>` — not in 0.4.0. Sheet ships standalone
> until that lands.

## TL;DR

```bash
# 1. Build the document gateway image (one time)
cd ../document && docker compose build gateway

# 2. From drive/, bring up drive + doc gateway together
cd ../drive
docker compose -f docker-compose.dev.yml \
               -f docker-compose.coedit.yml \
               up -d --build
```

Open http://localhost:8080 in two browser tabs (signed in as the same
demo admin), pick a `.docx`, click **Open in editor** on the preview
modal. Edits in one tab appear in the other within ~250 ms.

## What changes vs. standalone

Standalone (default `docker-compose.dev.yml`):

```
┌──────────────────────────────────────────────┐
│  Drive container (port 8080)                 │
│  ┌──────────────────────────────────────┐    │
│  │ Rust binary serves SPA + API + WOPI  │    │
│  │  └─ <CasualEditor backendUrl={undef} │    │
│  │     → standalone editor, no collab   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

With the co-edit overlay:

```
┌──────────────────────────────────────────────┐
│  Drive container (port 8080)                 │
│  ┌──────────────────────────────────────┐    │
│  │ Rust binary serves SPA + API + WOPI  │    │
│  │  └─ <CasualEditor backendUrl=        │    │
│  │     "ws://localhost:8082"            │    │
│  │     → Yjs over WebSocket             │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
                    │
                    │ ws://localhost:8082
                    ▼
┌──────────────────────────────────────────────┐
│  Doc gateway container (port 8082→8080)      │
│  ┌──────────────────────────────────────┐    │
│  │ casual-editor:local (Go)             │    │
│  │ GATEWAY_HOST=inline                  │    │
│  │ Y.Doc per room, live until last peer │    │
│  │ leaves (no persistence here — Drive  │    │
│  │ owns the snapshot via /content)      │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

The gateway is stateless — the Y.Doc lives in process and drops when
the last peer disconnects. Drive's `GET /api/files/{id}/content`
fetches the seed snapshot at editor mount; the gateway broadcasts
mutations between peers but never owns the canonical bytes. When the
last peer leaves, the next opener fetches a fresh snapshot from
Drive and the next round of edits starts from there.

## File contract

- **`docker-compose.coedit.yml`** — overlay file. Adds the
  `doc-gateway` service, rebuilds `drive` with
  `VITE_DRIVE_COLLAB_BACKEND_URL=ws://localhost:8082` baked into the
  SPA bundle, and wires `drive.depends_on.doc-gateway`.
- **`Dockerfile`** (web-build stage) — accepts the
  `VITE_DRIVE_COLLAB_BACKEND_URL` `ARG` and threads it into the
  Vite build. Without the build-arg the SPA bundles with the value
  empty and the SDK runs standalone.

## Production posture (when it lands)

The dev overlay is intentionally minimal: no TLS, no auth on the
gateway, port-forwarding via localhost. The production posture
(deferred until an operator asks):

- Both services behind a single reverse proxy (Caddy / nginx).
  `drive.example.com` → Drive; `coedit.drive.example.com` → gateway.
- `VITE_DRIVE_COLLAB_BACKEND_URL=wss://coedit.drive.example.com`
  (HTTPS-WS, not HTTP-WS).
- Gateway gates joins on a Drive-minted JWT (`GATEWAY_AUTH=jwt`),
  same identity model as the WOPI handoff already uses.

## Verifying co-edit locally

Manual smoke (no automated e2e yet — multi-service runtime makes the
fixture cost too high for Drive's CI today):

1. Both compose files up: `docker compose -f docker-compose.dev.yml
   -f docker-compose.coedit.yml up -d --build`
2. http://localhost:8080 → sign in (demo creds)
3. Upload a real `.docx` (demo seeds carry empty Blobs)
4. Right-pane "Open in editor" — lands at `/file/<id>`
5. Open a second browser (or incognito window), repeat
6. Type in one tab; the cursor + text should appear in the other.

If step 6 fails: check the doc-gateway logs (`docker compose logs
doc-gateway`) for the WS handshake. The most common dev-time gotcha
is the SPA bundle being stale — Vite caches the env var inline, so
`--build` must rebuild the `web-build` stage when the URL changes.

## Known gaps

- **No e2e.** A real Playwright co-edit test would need the gateway
  running + valid .docx fixture bytes. Tracked in the Phase 1.5
  follow-up; manual smoke covers it for now.
- **Sheet co-edit.** Waits on the sheet SDK's collab API
  (`backendUrl` prop on `<CasualSheets>`). Drive's
  `CasualSheetWorkspace` will inherit it automatically once that
  prop ships — no Drive-side code change beyond a one-line
  forward.
- **Persistence.** The gateway's `GATEWAY_HOST=inline` means a
  room's Y.Doc is gone once the last peer leaves. That's fine for
  v1 because Drive owns the canonical bytes; if a peer rejoins
  later they pull a fresh snapshot from Drive. Long-running rooms
  with no idle window need `GATEWAY_HOST=wopi` (uses Drive as a
  WOPI host) — that lane is gated on the gateway adding Drive's
  HMAC token scheme and isn't a Phase 1 deliverable.
