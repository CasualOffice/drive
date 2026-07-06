# Spike #2 — Embedded-editor byte stream (WOPI host = optional interop)

Location: [`../../spikes/02-editor-stream/`](../../spikes/02-editor-stream/). Standalone Cargo project.

> Recast for Doc-Hub. The **primary** editing path is embedded native editors (Sheet/Docs/PDF/Markdown) served an authenticated decrypted byte stream over the app origin — this spike proves that. WOPI is **demoted to optional interop** for external Office clients; the WOPI-host lane is covered second, kept only because the lock-family edge cases are worth having proven once.

## Goal

Two things, in priority order:

1. **(Primary) Embedded-editor byte stream.** Prove the open→edit→save loop from [`../ARCHITECTURE.md §"Embedded editing"`](../ARCHITECTURE.md): the app origin mints a per-launch **editor access token** `(user_id, file_id, perms, exp, jti)`; the server decrypts the current version's bytes in memory and streams them to the embedded editor over the authenticated app origin; a save encrypts the new bytes, appends a **hash-chained version**, writes an audit event. No bytes touch disk in plaintext; no bytes leave the app origin.
2. **(Optional-interop) WOPI host.** Confirm the seven WOPI host endpoints still implement cleanly in Axum 0.8 for the external-Office lane — especially the spec's two trickiest contracts (the asymmetric 409 + `X-WOPI-Lock` header; `UnlockAndRelock` sharing `X-WOPI-Override: LOCK` with Lock). Kept as a *stub-grade* proof, not a first-class path.

## Outcome

Green. 15/15 integration tests pass — 9 for the embedded stream, 6 for the WOPI interop lane.

```
test result: ok. 15 passed; 0 failed
```

### Embedded-editor byte stream (primary)

| Test | What it proves |
|---|---|
| `mint_token_binds_user_file_perms_exp_jti` | Editor token carries the exact claim from ARCHITECTURE.md; HMAC-signed |
| `stream_decrypts_current_version_over_app_origin` | GET editor stream returns *plaintext* bytes (decrypted in memory) on the app origin |
| `token_for_other_file_rejected` | `token.file_id` must match URL `file_id` — the single most important auth check |
| `read_token_cannot_save` | Perm enforcement: `perms=read` → save rejected 403 |
| `expired_token_rejected` | `exp` honoured; short TTL |
| `save_appends_chained_version` | Save encrypts, appends version N+1 with `prev_hash` = version N's `content_hash` |
| `save_writes_audit_event` | Every save appends an audit row (who/when/file/version) |
| `save_never_writes_plaintext` | Spy storage backend asserts the saved blob is ciphertext |
| `stream_not_served_on_usercontent_origin` | Editor stream is app-origin only; user-content host → 421 |

### WOPI interop (optional lane)

| Test | What it proves |
|---|---|
| `wopi_happy_path_full_edit_cycle` | CheckFileInfo → GetFile → Lock → PutFile → Unlock all 200 |
| `wopi_putfile_without_lock_returns_409_with_lock_header` | The mandatory + asymmetric 409 contract |
| `wopi_happy_putfile_omits_lock_header_on_200` | The asymmetric other half — no `X-WOPI-Lock` on 200 |
| `wopi_unlock_and_relock_atomic_swap` | LOCK + `X-WOPI-OldLock` dispatches to UnlockAndRelock |
| `wopi_lock_with_same_id_acts_as_refresh` | Per spec: "Lock with current lock ID = RefreshLock" |
| `wopi_putfile_commits_chained_version` | Even via WOPI, a save lands as an encrypted hash-chained version — interop doesn't bypass the registry |

## What worked

### Embedded stream (the path that matters)

- **The editor token is the same HMAC claim the WOPI lane uses, minus the WOPI wire framing.** `EditorClaims { user_id, file_id, perms, exp, jti }` mints/verifies in ~30 LoC via `jsonwebtoken` 10.4 (HS256, `aws_lc_rs` provider). One token type, one verify function, reused across both lanes.
- **Decrypt-in-memory → stream is clean.** The handler loads the head version's ciphertext through `Storage::read` (which decrypts via the Spike #1 envelope layer), and hands the plaintext to `Body::from_stream`. Nothing is written to disk decrypted; the plaintext exists only for the response lifetime.
- **The save path is the registry contract in miniature.** `save` = `seal(dek, new_bytes)` → `write_once(ciphertext) -> content_hash` → append `file_versions` row with `prev_hash` → append `audit_log` row. `save_appends_chained_version` + `save_never_writes_plaintext` lock both invariants in.
- **App-origin binding is a middleware check, not per-handler.** The editor stream route lives only on the app-origin router; hitting it on the user-content host returns 421 (composed from the Spike #4 host-dispatch layer). Confirms the two spikes stack.

### WOPI interop lane (kept, demoted)

- **Axum 0.8 path syntax `{file_id}`** maps cleanly; `.get(check_file_info).post(lock_dispatch)` on one route.
- **`lock_dispatch` on `X-WOPI-Override`** is six lines; the "LOCK with `X-WOPI-OldLock` is actually UnlockAndRelock" rule is one `match` arm.
- **The 409 + header contract** lives in `WopiError::LockConflict(String)` with an `IntoResponse` impl that renders the current-lock string as `X-WOPI-Lock`; success branches construct empty heads so the 200-omits-header half just works.
- **WOPI PutFile still commits through the registry.** The interop handler calls the same `save` primitive — a WOPI client cannot write a version that skips encryption, hashing, or audit. This is the whole reason WOPI is *safe* to keep as an option.

## What surprised

1. **`jsonwebtoken` 10.x requires a crypto-provider feature.** Default build compiles, then panics at first sign/verify with "Could not automatically determine the process-level CryptoProvider". Fix: `features = ["aws_lc_rs"]`. Already called out in the rust-stack brief — confirmed.
2. **Streaming *decrypted* bytes means the plaintext must never be cached to disk by any layer.** Axum's `Body::from_stream` is fine, but a naive `tempfile` for range requests would leak plaintext at rest. Decision: range requests on the editor stream buffer in memory only (documents are small); never spill to disk. Phase 2 keeps this rule.
3. **`HeaderName::from_static` requires a `const` context** (WOPI lane). Define lock headers at module scope.
4. **`tower::ServiceExt::oneshot` works with `Arc<Mutex<...>>`-backed state** — every test builds its own state, mutates it, asserts in isolation. Reused across both lanes.

## What's out of this spike (and where it goes)

| Out | Where |
|---|---|
| Real editor SDK embed (Sheet/Docs/PDF) | Phase 2 — this spike streams to a headless test client, not the real `<Editor>` |
| Real-time co-editing via the `collab` server (Yjs/Hocuspocus) | Phase 2 — the collab server relays opaque bytes; not in scope here |
| Version persistence | Spike uses `Arc<Mutex<HashMap<...>>>` for versions + audit; Phase 1 uses `file_versions` + `audit_log` tables |
| Streaming `PutFile`/save body | Spike buffers `Bytes`; Phase 1 streams via `Storage::put_stream` |
| WOPI Discovery XML | Sheet/document repos, not Doc-Hub |
| WOPI proof-key RSA validation | Only if/when external MS365 interop is enabled; hook is `Ok(())` today |
| WOPI `PutRelativeFile` / `GetLock` | Deferred; interop lane doesn't advertise them |

## Recommended revisions to ARCHITECTURE.md / CLAUDE.md before Phase 1

- **Make the editor stream the canonical example in ARCHITECTURE.md §"Embedded editing"** (it already is) and note the in-memory-only decrypt rule (never spill plaintext to disk, incl. range buffering).
- **Define `EditorClaims` + `mint_editor_token`/`verify_editor_token` in `dochub-auth`** as the primary token path; the WOPI lock/claim helpers live in an optional `dochub-wopi` module behind a feature flag.
- **State explicitly that all save paths — embedded and WOPI — funnel through one `commit_version` primitive** so no interop path can bypass encryption/hash-chain/audit. This is a testable invariant.

## Files

- [`spikes/02-editor-stream/Cargo.toml`](../../spikes/02-editor-stream/Cargo.toml) — axum 0.8, jsonwebtoken 10 (`aws_lc_rs`), path-dep on spike #1 for seal/open + write_once
- [`spikes/02-editor-stream/src/lib.rs`](../../spikes/02-editor-stream/src/lib.rs) — `EditorClaims`, editor stream + save handlers, `commit_version`, optional WOPI module
- [`spikes/02-editor-stream/tests/embed_cycle.rs`](../../spikes/02-editor-stream/tests/embed_cycle.rs) — 9 embedded-stream tests
- [`spikes/02-editor-stream/tests/wopi_interop.rs`](../../spikes/02-editor-stream/tests/wopi_interop.rs) — 6 WOPI interop tests

## Decision

**Greenlit.** The embedded-editor byte stream — mint token → decrypt-in-memory → stream over app origin → save as encrypted hash-chained version + audit — is the primary editing path and holds under test, including the no-plaintext and chained-version invariants. WOPI survives as a safe optional-interop lane because its PutFile commits through the same `commit_version` primitive. Carry `EditorClaims` + `commit_version` into `dochub-auth`/`dochub-http`; keep WOPI behind a feature flag in `dochub-wopi`. Move to Spike #4 (two-origin Axum) next.
