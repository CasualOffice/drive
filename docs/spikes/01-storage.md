# Spike #1 — Storage facade + encryption layer

Location: [`../../spikes/01-storage/`](../../spikes/01-storage/). Standalone Cargo project, not (yet) wired into the workspace.

## Goal

Prove the `Storage` facade shape from [`../ARCHITECTURE.md`](../ARCHITECTURE.md) compiles, that OpenDAL covers our needs cleanly, and that the **mandatory at-rest encryption layer** and **write-once content-addressed version blobs** — the two invariants the hub is built on — hold under a conformance suite before Phase 1 hardens it into `crates/dochub-storage` + `crates/dochub-crypto`.

Three things had to be true, not one:

- The facade shape survives contact with OpenDAL (fs / memory / S3).
- **No plaintext document bytes ever reach a backend** — every `write` passes through the envelope-encryption layer, every `read` back out; a spy backend proves it.
- **Version blobs are content-addressed and write-once** — `content_hash = SHA-256(ciphertext)` is the storage key; re-writing the same key is a no-op, not an overwrite; tampering is detectable.

## Outcome

Green. 22/22 conformance tests pass against **fs** and **memory** backends. ~40 s clean build.

```
test result: ok. 22 passed; 0 failed
```

| Backend | put/get | stat/delete | list | copy/rename | signed_get | seal/open | no-plaintext | write-once | tamper-reject |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| fs | ✓ | ✓ | ✓ | ✓ (native) | ✓ (Token) | ✓ | ✓ | ✓ | ✓ |
| memory | ✓ | ✓ | ✓ | ✓ (synthesized) | ✓ (Token) | ✓ | ✓ | ✓ | ✓ |

S3 / MinIO via testcontainers: deferred to Phase 1 (the API surface is exercised by fs + memory; Docker on CI is its own decision). External KMS: stubbed to a local KEK; the wrap/unwrap seam is exercised, the AWS/Doc-Hub adapter is Phase 1.

## What worked

- **OpenDAL 0.54 is exactly what the brief said it was.** `Operator::new(services::Fs::default().root(...))?.finish()` is one line; the same shape works for `Memory`, `S3`. ~35 s from clean to a working `Operator` with all four services compiled in.
- **The encryption layer composes as a wrapper, not a fork.** `Storage::write(key, plaintext)` calls `crypto.seal(dek, plaintext) → operator.write(key, ciphertext)`; `read` reverses it. Handlers never see the operator, so there is no code path that can write plaintext — the invariant is enforced by construction, then confirmed by the spy backend. ~50 LoC of glue.
- **AES-256-GCM envelope via `aws-lc-rs` is boring in the good way.** `seal` = random 96-bit nonce, `nonce ‖ ciphertext ‖ tag`; `open` verifies the tag and rejects on mismatch. A wrapped per-workspace DEK (KEK-wrapped with the same primitive) round-trips through `wrap`/`unwrap`. No homebrew, no surprises.
- **Content-addressing makes write-once free.** With `key = hex(SHA-256(ciphertext))`, a re-`write` of identical bytes lands on the same key — idempotent, not destructive. `write_once` refuses to replace an existing key with *different* bytes (returns `AlreadyExists`), which is the tamper/collision guard the version engine needs.
- **The `Capability` gate is the right primitive.** Branching on `op.info().full_capability().presign_read` makes the facade's `SignedUrl::Native` vs `SignedUrl::Token` split trivial — three lines of conditional, no `match` on backend type. Confirmed for `presign_read`, `copy`, `rename`.
- **HMAC token path is small and fast.** ~30 LoC of `mint_token` + `verify_token`, constant-time MAC compare (`subtle::ConstantTimeEq`), `time::OffsetDateTime` expiry. No surprises.
- **Streaming reads via `into_bytes_stream` map cleanly into `BoxStream<Item = Result<Bytes, StorageError>>`.** Decryption happens in the facade before the stream is handed up; the editor byte-stream and `/raw/{token}` path both drop straight into Axum bodies in Phase 1.

## What surprised

1. **GCM decryption of tampered ciphertext must be a hard, typed error — not a panic and not a silent empty read.** First cut let a tag-mismatch bubble as a generic `StorageError::Backend`; the `tamper_reject` test wanted a distinct `StorageError::Decrypt`. Split it out so the version-chain verifier can tell "bytes corrupted" from "backend down". This is the same signal `verify_chain` will raise to admins in Phase 1 — worth getting the error taxonomy right in the spike.

2. **Nonce handling is the whole ballgame.** Storing `nonce ‖ ciphertext ‖ tag` in one blob (rather than a side table) keeps the facade stateless and content-addressing honest — the hash covers the nonce too, so an attacker can't swap nonces without changing the key. Confirmed the round-trip and the tamper-reject both hold with this layout.

3. **OpenDAL's memory service doesn't support native `copy` or `rename`.** `op.copy("a","b")` returns `Unsupported (permanent)`.
   - **Fix landed in the facade:** `Storage::copy` / `Storage::rename` consult `Capability::copy` / `Capability::rename` and fall back to read-then-write (decrypt-then-reseal is *not* needed — ciphertext blobs copy verbatim, preserving the content hash). Synthesized paths re-test clean.
   - **Implication for Phase 1:** version blobs are immutable, so copy/move at the storage layer is rare (the registry moves *pointers*, not bytes). Still, don't surface "unsupported" to callers — synthesize or fail typed.

4. **`opendal::Buffer`'s `to_bytes()` is what you want for the fall-back read** — not `to_vec()` or `into_bytes()`.

5. **`presign_read` on filesystem is exposed as `false`** as expected. The facade's `Token` branch covers it; no per-backend special-case in callers.

## What we didn't do (and why)

- **MinIO via testcontainers** — adds Docker as a hard dependency for the spike's CI. The fs + memory pair already exercises the whole `Storage` API, the encryption layer, and the write-once path. Phase 1's `crates/dochub-storage/tests/` is where MinIO becomes mandatory.
- **External KMS wrap/unwrap** — the spike wraps the DEK with a local KEK from env. The AWS-KMS / Doc-Hub adapter behind the same `KeyProvider` trait is Phase 1; the wrap/unwrap seam is proven, the network adapter isn't.
- **Key rotation** — the spike wraps/unwraps once. Rotation (re-wrap DEKs under a new KEK *without* rewriting blobs) is a Phase 1 property test; the spike confirms blobs are keyed by content hash, so rotation touching only wrapped-DEK rows is sound.
- **S3 native presign verification** — same reason as MinIO; the facade routes to `SignedUrl::Native` when `presign_read` is true, the signature-format check is an OpenDAL test.
- **Multipart / streaming `put`** — `put` takes `Bytes`. Phase 1 hardens to `put_stream(key, BoxStream<Bytes>)` with the encryption layer streaming through a GCM chunk scheme; fs/memory don't expose multipart anyway.

## Recommended revisions to ARCHITECTURE.md before Phase 1

1. **State the seal/open seam on the facade explicitly.** ARCHITECTURE.md §"Encrypted storage facade" already shows `write → seal → operator.write`; promote the `StorageError::Decrypt` distinct variant into the doc so the version-verifier contract is unambiguous.
2. **Document content-addressed write-once as a facade method,** not just a table property: `write_once(ciphertext) -> content_hash` is the primitive the version engine calls; `AlreadyExists`-on-different-bytes is the collision/tamper guard.
3. **Document copy/rename synthesis** — native when capable, synthesised otherwise; note that version blobs are immutable so callers should move pointers, not bytes.
4. **The `put` signature becomes `put_stream`** in Phase 1 (arch doc already states the goal).

## Files

- [`spikes/01-storage/Cargo.toml`](../../spikes/01-storage/Cargo.toml) — `opendal = "0.54"`, `aws-lc-rs`, `subtle`, minimum deps
- [`spikes/01-storage/src/lib.rs`](../../spikes/01-storage/src/lib.rs) — `Storage`, `ObjectMeta`, `SignedUrl`, `StorageError`, `validate_key`, HMAC token mint/verify
- [`spikes/01-storage/src/crypto.rs`](../../spikes/01-storage/src/crypto.rs) — `seal`/`open` (AES-256-GCM envelope), `wrap`/`unwrap` DEK, `content_hash`, `write_once`
- [`spikes/01-storage/tests/conformance.rs`](../../spikes/01-storage/tests/conformance.rs) — 22 tests across 2 backends, incl. spy-backend no-plaintext + write-once + tamper-reject

## Decision

**Greenlit.** The `Storage` facade shape from ARCHITECTURE.md survives contact with OpenDAL 0.54, and the two hub invariants hold: no plaintext reaches a backend (spy-backend proven), and version blobs are content-addressed + write-once + tamper-evident. Carry the seal/open layer and `write_once` primitive into `crates/dochub-storage` + `crates/dochub-crypto` verbatim. Move to Spike #2 (embedded-editor byte stream).
