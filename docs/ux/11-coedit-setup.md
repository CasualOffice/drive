# 11 — Co-edit setup (operator guide)

Companion to `10-sdk-integration-plan.md` §"Phase 2 — Co-editing". This doc tells operators how to flip Doc-Hub from single-container standalone into multi-peer real-time co-edit by adding the `collab` gateway alongside the hub.

> **Scope.** Doc (`.docx`) co-edit first; Sheet (`.xlsx`) co-edit follows once `@schnsrw/casual-sheets` exposes a `backendUrl` prop. Both editors run standalone (solo) until co-edit is enabled — solo editing is fully functional without the gateway.

## What co-edit does and does not touch

Co-edit changes **how live keystrokes are relayed between peers**, not where the canonical bytes live. The hub always owns the encrypted, hash-chained document:

- On editor mount, the hub serves the **decrypted head version** from `GET /api/documents/{id}/content` (decrypt-in-memory over the app origin).
- Peers relay their collaborative deltas through the `collab` gateway (Yjs / Hocuspocus). The gateway handles **opaque** update bytes — it never decrypts at-rest blobs and never owns the canonical document.
- On save, each client's commit goes through `PUT /api/documents/{id}/content`, which re-encrypts and appends a new hash-chained version. Co-edit does not bypass the version engine; both peers' saves land as ordered versions.

## TL;DR

```bash
# 1. Build the collab gateway image (one time)
cd ../collab && docker compose build gateway

# 2. From the hub repo, bring up hub + collab gateway together
cd ../hub
docker compose -f docker-compose.dev.yml \
               -f docker-compose.coedit.yml \
               up -d --build
```

Open http://localhost:8080 in two browser tabs (same signed-in user), pick a `.docx`, open it in the editor. Edits in one tab appear in the other within ~250 ms; each save appends a version visible in the document's history.

## Standalone vs. co-edit

Standalone (default `docker-compose.dev.yml`):

```
┌──────────────────────────────────────────────┐
│  Doc-Hub container (port 8080)                 │
│  ┌──────────────────────────────────────┐    │
│  │ Rust binary: SPA + API + decrypt-and- │   │
│  │ stream content endpoints              │    │
│  │  └─ <CasualEditor backendUrl={undef}> │    │
│  │     → solo editing, no collab         │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

With the co-edit overlay:

```
┌──────────────────────────────────────────────┐
│  Doc-Hub container (port 8080)                 │
│  ┌──────────────────────────────────────┐    │
│  │ Rust binary: SPA + API + decrypt-and- │   │
│  │ stream content endpoints              │    │
│  │  └─ <CasualEditor backendUrl=         │    │
│  │     "ws://localhost:8082">            │    │
│  │     → Yjs over WebSocket              │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
                    │  ws://localhost:8082 (opaque Yjs deltas)
                    ▼
┌──────────────────────────────────────────────┐
│  collab gateway container (8082→8080)        │
│  ┌──────────────────────────────────────┐    │
│  │ collab server (Yjs / Hocuspocus)     │    │
│  │ GATEWAY_HOST=inline                  │    │
│  │ Y.Doc per room, live until last peer │    │
│  │ leaves. No at-rest bytes, no keys —  │    │
│  │ the hub owns the encrypted snapshot│    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

The gateway is stateless: the Y.Doc lives in process and drops when the last peer disconnects. The hub's `GET /api/documents/{id}/content` seeds the room with the decrypted head at mount; the gateway broadcasts deltas but never owns canonical bytes and never holds a key. When the last peer leaves, the next opener seeds a fresh decrypted snapshot and the next round of edits (and versions) starts from there.

## File contract

- **`docker-compose.coedit.yml`** — overlay. Adds the `collab-gateway` service, rebuilds `hub` with `VITE_DOCHUB_COLLAB_BACKEND_URL=ws://localhost:8082` baked into the SPA bundle, and wires `hub.depends_on.collab-gateway`.
- **`Dockerfile`** (web-build stage) — accepts the `VITE_DOCHUB_COLLAB_BACKEND_URL` `ARG` and threads it into the Vite build. Without the build-arg the SPA bundles the value empty and the SDK runs solo.
- The runtime equivalent is `DOCHUB_COLLAB_BACKEND_URL`, surfaced to the SPA via `/api/about`.

## Production posture (when it lands)

The dev overlay is intentionally minimal: no TLS, no auth on the gateway, localhost port-forwarding. Production:

- Both services behind one reverse proxy (Caddy / nginx). `hub.example.com` → hub; `collab.hub.example.com` → gateway.
- `VITE_DOCHUB_COLLAB_BACKEND_URL=wss://collab.hub.example.com` (WSS, not WS).
- The gateway gates room joins on a **dochub-minted JWT** (`GATEWAY_AUTH=jwt`) carrying `(user_id, document_id, perms, exp)` — the same short-TTL, per-document editor-access-token model the app uses (`ARCHITECTURE.md` §"Token model"). A peer cannot join a room for a document it has no permission to open.

## Verifying co-edit locally

Manual smoke (no automated e2e in the dev overlay — multi-service runtime makes the fixture cost high; the canonical UC-5 e2e runs in CI against the built binary + a gateway fixture per `TESTING.md`):

1. Both compose files up: `docker compose -f docker-compose.dev.yml -f docker-compose.coedit.yml up -d --build`.
2. http://localhost:8080 → sign in.
3. Upload a real `.docx`.
4. Open it in the editor (lands at `/document/<id>`).
5. Open a second browser (or incognito window); open the same document.
6. Type in one tab; text + cursor should appear in the other. Save; confirm a new version in the document's history (`18-version-history-surface.md`).

If step 6 fails: check the gateway logs (`docker compose logs collab-gateway`) for the WS handshake. The most common dev gotcha is a stale SPA bundle — Vite inlines the env var, so `--build` must rebuild the `web-build` stage when the URL changes.

## Known gaps

- **Sheet co-edit.** Waits on the sheet SDK's `backendUrl` prop. `VaultSheetWorkspace` inherits it with a one-line forward once it ships.
- **Persistence.** `GATEWAY_HOST=inline` means a room's Y.Doc is gone when the last peer leaves — fine, because the hub owns the canonical encrypted bytes and a rejoin pulls a fresh decrypted snapshot. Long-running idle rooms are out of scope for now.
- **Offline conflict.** Live co-edit merges via Yjs; two saves that happen without a shared room (e.g. solo edits from two sessions) simply append two ordered versions — nothing is lost, and the history shows both. The append-only chain is the conflict backstop.
