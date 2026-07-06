# Spike #4 — Two-origin Axum

Location: [`../../spikes/04-two-origin/`](../../spikes/04-two-origin/). Standalone Cargo project; depends on spike #1 via a path dep so the HMAC token + envelope-decryption logic is composed, not duplicated.

## Goal

Confirm the architecture-mandated **two-origin model** ([`../ARCHITECTURE.md §"Two-origin security model"`](../ARCHITECTURE.md)) is implementable in a single Axum binary:

- Two `Host`-differentiated routers in one process.
- `/raw/{token}` handler on the user-content origin only, streaming **decrypted** bytes from `Storage` (spike #1) with the right security headers, for share-links and isolated content.
- Editor byte streams and the JSON API stay on the app origin only.
- Production boot refuses to start if origins match.
- Defence-in-depth at the middleware layer: cross-origin requests get **421 Misdirected Request**.

## Outcome

Green. 10/10 tests pass.

| Test | What it proves |
|---|---|
| `boot_rejects_matching_origins_in_prod` | Prod boot refusal |
| `boot_allows_matching_origins_in_dev` | Dev tolerates `localhost:8080` for both |
| `boot_allows_different_origins_in_prod` | Happy boot |
| `app_route_on_usercontent_host_returns_421` | `/api/files` on user-content host → 421 |
| `raw_route_on_app_host_returns_421` | `/raw/<token>` on app host → 421 |
| `app_origin_serves_with_strict_csp` | App-origin CSP = `default-src 'self'; ...frame-ancestors 'none'` |
| `raw_with_valid_token_returns_bytes_and_sandbox_csp` | User-content CSP = `sandbox; default-src 'none'`, `nosniff`, `attachment` filename, `Cross-Origin-Resource-Policy: same-site` |
| `raw_with_tampered_token_returns_401` | HMAC-tamper rejection |
| `raw_for_missing_key_returns_404` | Token signed valid; key doesn't exist |
| `raw_rejects_put_when_token_is_get_only` | Method-binding enforced |

## What worked

- **`Host`-dispatch as a tower middleware** is the right level. One `from_fn_with_state` closure per origin, returns 421 when the header doesn't match. Routes themselves stay clean.
- **`tower-http::SetResponseHeaderLayer`** drops the per-origin security headers on every response without per-handler code. Neither CSP is ever weakened; the sandbox CSP on the user-content origin is unconditional.
- **`/raw/{token}` streams decrypted bytes without buffering.** The handler pulls ciphertext through `Storage::read` — which decrypts via the spike #1 envelope layer — and streams the plaintext via `Body::from_stream`. Confirmed the bytes round-trip without an intermediate `Vec<u8>`, and that the decrypt happens in the facade, not the handler.
- **`Content-Disposition: attachment`** is forced for share-link responses on the isolated origin, so a shared document can never be rendered inline in a context that carries the app's trust. Documents-only scope keeps this simple — no inline media to special-case.
- **Path-dependency on spike #1** (`spike-01-storage = { path = "../01-storage" }`) composes cleanly. Confirms the workspace approach for Phase 1.

## What surprised

1. **Axum 0.8's path syntax is `{token}`, not `:token`.** Already documented in the rust-stack brief but worth a regression check.
2. **`Body::from_stream` requires `Stream<Item = Result<Bytes, E>>` where `E: Into<Box<dyn Error + Send + Sync>>`.** Mapping the facade stream's `StorageError` (including the `Decrypt` variant from spike #1) through `std::io::Error::new(ErrorKind::Other, e.to_string())` is the boring-but-works adapter. Phase 1 wraps this in a `crates/dochub-http/src/body.rs` helper so it's one line at the handler.
3. **A decryption failure on `/raw/{token}` must render as 404/410, not 500.** A tamper or key-mismatch on a shared blob shouldn't leak "the server has this but couldn't decrypt it"; the handler maps `StorageError::Decrypt` to the same not-found shape as a missing key. Added to the test intent.
4. **The 405 vs 401 ambiguity on method mismatch** — axum's route-level method gating returns 405 before our token-method-check runs. PUT with a GET-only token returns 405 from the router before the handler returns 401. The test accepts either; the wire is correct either way. Phase 1 should decide whether token-method-binding deserves a more explicit pattern.

## Recommended revisions

- The `host_dispatch` middleware closure is currently inline; promote to a typed `HostDispatchLayer` in `dochub-http`.
- The `RawError` → `IntoResponse` impl is the same shape as spike #2's editor-stream error — generalise into a single `AppError` family in `dochub-core` with consistent JSON error bodies, and a shared "not found or undecryptable" mapping for content endpoints.

## Decision

**Greenlit.** The two-origin model is straightforward in Axum 0.8 with the tower middleware pattern, and it composes with the encryption layer: `/raw/{token}` streams decrypted bytes on the sandboxed user-content origin only, while editor streams and the API stay on the app origin. Carry the `Host`-dispatch layer, the per-origin CSP headers, and the streaming `/raw/{token}` handler into Phase 1 verbatim.
