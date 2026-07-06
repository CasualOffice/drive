# 06 — Security Baseline for Doc-Hub

> Research brief + security checklist (CLAUDE inviolable rule #4). Scope: Doc-Hub — the encrypted, tamper-evident document registry. It owns ingest (documents only), at-rest encryption, immutable hash-chained history, serving, embedded editing, compliance (audit/retention/legal-hold/provenance), content search, and an optional AI layer. Claims trace to a cited source; unverifiable items marked `[unverified]`.

> Naming in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`.

## TL;DR

- **Threat model is server-trusted, NOT zero-knowledge.** The server holds keys by design so it can index + reason over content. Encryption at rest defeats a stolen disk/DB; it does **not** defend against a fully compromised trusted server. This is a deliberate trade, stated honestly — not a gap to paper over.
- **Encryption is mandatory and ours.** AES-256-GCM envelope encryption in `dochub-crypto`; per-workspace DEK wrapped by a master KEK/KMS. Boot **refuses to start** without a key. No config flag disables it.
- **History is tamper-evident.** Every version and audit row is hash-chained (`content_hash`/`prev_hash`); `verify_chain` detects any post-hoc edit. Immutability is the product and is property-tested.
- **Ingest is allowlisted.** Documents-only MIME allowlist enforced on every ingest path, by extension **and** magic-byte sniff. Reject, don't quarantine. No arbitrary blobs, media, or archives to defend.
- **Origin separation stays non-negotiable.** Share-link/user content serves from a separate registrable origin than the app; sandbox CSP, no cookies, `attachment` for non-previewable types.
- **Retention + legal hold gate deletion.** "Delete" is a tombstone; a document under legal hold cannot be tombstoned or purged by any path.
- **Standard belt-and-braces:** Argon2id, `__Host-` cookies, CSRF, rate limits, HTTP hardening headers, `cargo audit`/`cargo deny`.

Each H2 carries **Rule / Why / How / Phase**. The threat model, OWASP walkthrough, and v0 + later checklists live at the bottom.

---

## 0. Threat model — what encryption defends, and what it does not

**Rule.** Doc-Hub is **server-trusted**, explicitly **not** zero-knowledge end-to-end encrypted. The server can decrypt document content — because it must, to extract text, index it, run the optional AI layer, co-edit, and sign provenance. The security guarantee is scoped accordingly and documented plainly.

**What at-rest encryption defends:**

- **Stolen disk / lost backup / dumped DB.** Document bytes on any storage backend (fs / S3 / MinIO / R2 / B2) are AES-256-GCM ciphertext. A raw copy of the volume, bucket, or database yields ciphertext plus wrapped DEKs — useless without the KEK.
- **A misconfigured or curious storage provider.** BYO-bucket credentials are themselves sealed; the bucket operator sees only ciphertext.
- **Casual disclosure at the substrate.** Even with substrate SSE off, our layer still encrypts; SSE is defence-in-depth on top.

**What it does NOT defend:**

- **A fully compromised, running Doc-Hub server.** Whoever controls the live process controls the KEK and the DEKs it unwraps; they can read plaintext. No at-rest scheme can prevent this — only zero-knowledge E2E could, and E2E is deliberately out of scope (it would make search, extraction, AI, co-editing, and server-side provenance impossible).
- **A malicious operator/admin with key access.** Trust in the operator is assumed; the audit log makes their actions *evident*, not impossible.
- **Compromised client endpoints.** Malware on a user's machine reading a decrypted document in their browser is out of scope.

**Why.** Being explicit about the trust boundary is the honest posture and prevents users from assuming a guarantee we don't provide. In-transit TLS + at-rest envelope encryption + tamper-evident history is the right model for a *registry the operator runs on their own server* — the DigiLocker-style use case — where the value is durability, provenance, and defence against theft of storage, not defence against the operator.

**How.** Envelope encryption in `dochub-crypto` (§14); tamper-evidence via hash chains (§15); operator actions logged to the append-only, hash-chained audit log (§10). The README, CLAUDE, and ARCHITECTURE all restate the non-zero-knowledge posture so it is never mistaken.

**Phase.** v0 posture; documented from Phase 0.

---

## 1. Path traversal

**Rule.** Storage keys are opaque server-generated identifiers (ULID/UUIDv7). The `fs` backend (via OpenDAL) canonicalises every resolved path and refuses anything escaping the configured storage root.

**Why.** Traversal manipulates `../`, absolute paths, or encoded variants to read/write arbitrary files. OWASP: allow-list validation *after* canonicalisation ([OWASP Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html)). Opaque IDs make traversal impossible by construction.

**How.** Storage key = `ulid::Ulid::new()`, never derived from user input. Keys are also encryption blob names, so they carry no semantic content. `fs` root canonicalised at boot; symlinks refused. Reject any key containing `..`, `\0`, `/`, `\`. S3/MinIO/R2/B2 use flat namespaces — keys never contain `/`.

**Phase.** v0 must-have.

---

## 2. Display name handling

**Rule.** Display name (what the user sees) and storage key (what the backend sees) are different columns. Display name is sanitised on store and re-sanitised on render.

**Why.** OWASP File Upload Cheat Sheet: generate the storage name, length-limit the display name, and validate *after decoding* to defeat double-extension and null-byte bypasses ([OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)).

**How.** `display_name`: UTF-8, NFC-normalised, max 255 codepoints. Strip ASCII controls (0x00–0x1F, 0x7F), NUL, path separators, Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`). Trim leading/trailing whitespace, leading `.`/`-`. The extension is metadata only — never drives `Content-Type` (§3). On serve, RFC 5987 `filename*=UTF-8''<pct-encoded>`.

**Phase.** v0 must-have.

---

## 3. Ingest allowlist + content-type validation

**Rule.** Doc-Hub accepts **documents only.** The MIME allowlist is authoritative and enforced on **every** ingest path (proxy upload and any direct-to-storage path), by file extension **and** magic-byte sniff. Disallowed types are **rejected**, not quarantined. Never echo the client's `Content-Type` on serve.

**Allowlist:** `docx, xlsx, csv, xlsm (opaque), pptx, pdf, md, txt, json, yaml`. Everything else — video, images-as-primary, audio, archives, executables, arbitrary binaries — is refused at upload.

**Why.** The narrow scope is the whole security posture: a documents-only hub has a small, well-understood type surface, which is what lets us encrypt, index, and version everything without a per-type exception matrix. OWASP: validate the file signature; don't trust the `Content-Type` header; prefer a whitelist ([OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)). Refusing (vs quarantining) removes an entire class of staging-area and promotion-race bugs.

**How.** Extension check + magic-byte sniff via [`infer`](https://crates.io/crates/infer) (small, pure-Rust) with [`tree_magic_mini`](https://crates.io/crates/tree_magic_mini) as a richer fallback. The sniffed type must be in the allowlist *and* agree with the extension; mismatch (e.g. `.docx` that sniffs as `application/zip` but fails Office container structure) is rejected. `.xlsm` is accepted but stored as an **opaque** encrypted blob — never opened in an embedded editor. Stored `content_type` is always the sniffed type. Pair every serve with `X-Content-Type-Options: nosniff`.

**Phase.** v0 must-have. This is the ingest gate.

---

## 4. Serving files safely — THE critical item

**Rule.** All user content (share-link bytes) serves from a **separate registrable origin** from the Doc-Hub app. App origin (e.g. `hub.example.org`) is reserved for trusted code; user content lives at e.g. `usercontent-dochub.example.org`. Non-previewable types ship with `Content-Disposition: attachment`. Every response carries `X-Content-Type-Options: nosniff`. CSPs differ per origin.

**Why.** Google's 2012 [Content hosting for the modern web](https://security.googleblog.com/2012/08/content-hosting-for-modern-web.html) and 2023 [Securely Hosting User Data](https://security.googleblog.com/2023/04/securely-hosting-user-data-in-modern.html) are canonical: same-origin user content means XSS via uploaded content, cookie-scope issues, weakened framing. PDFs execute JS (PDF.js CVE-2024-4367, [Codean Labs](https://codeanlabs.com/blog/research/cve-2024-4367-arbitrary-js-execution-in-pdf-js/)) — and PDF is on our allowlist, so the isolation matters.

**How.**

- **Two origins** (`app_origin`, `usercontent_origin`); boot **refuses to start in prod** if they match.
- **Editor byte streams** (the primary editing path) are served over the **app origin** to the authenticated embedded editor, decrypted in memory, gated by a short-TTL editor access token (§8) — not via the user-content origin.
- **Share-link `/raw/{token}`** serves only on the user-content origin: sniffed `Content-Type`; `nosniff`; `Content-Disposition: attachment` for non-previewable types; `Content-Security-Policy: sandbox; default-src 'none'`; `Cross-Origin-Resource-Policy: same-site`; `Cross-Origin-Opener-Policy: same-origin`. No cookies are ever set here.
- **App-origin CSP:** strict — `default-src 'self'`, `script-src 'self'` (no `'unsafe-inline'`/`'unsafe-eval'`), `object-src 'none'`, `base-uri 'none'`.
- **PDF** from the user-content origin is `attachment` by default; inline preview is operator opt-in and the sandbox CSP backstops in-document JS.

**Phase.** v0 must-have. Non-negotiable #1.

---

## 5. Upload size + rate limits

**Rule.** Configurable per-request body cap, per-workspace storage quota, per-IP request rate limit.

**Why.** OWASP A04 (Insecure Design) / A05 (Security Misconfiguration) call out missing resource limits ([OWASP Top 10 2021](https://owasp.org/Top10/2021/)). Documents are bounded but a client can still fill disk or fan out abuse.

**How.** Per-request body limit via Axum `RequestBodyLimitLayer` (default 100 MiB, configurable — documents don't need gigabytes). Per-workspace quota checked pre-write and on stream completion. Per-IP rate limit via [`tower_governor`](https://crates.io/crates/tower_governor) (GCRA): auth 10/min/IP, upload 30/min/IP, download 300/min/IP, search 120/min/IP.

**Phase.** v0 must-have.

---

## 6. Content extraction + AI safety

**Rule.** Text extraction (`dochub-index` via `core`) and the optional AI layer (`dochub-ai`) are **read-only** over document content. Neither mutates a document, a version, or the hash chain. Extraction runs in-process on already-decrypted, already-allowlisted bytes; the AI provider is pluggable and its calls are audited.

**Why.** The retired Drive shipped a virus-scan hook because it accepted arbitrary binaries; a documents-only hub instead needs to guarantee that its *content-processing* layers can't become a write path or exfiltration channel. Extraction of untrusted documents is a parsing-CVE surface (`core` owns hardening there); AI adds a data-egress surface (content leaving to a provider).

**How.** Extraction goes through `core`, which is fuzzed/hardened upstream; a failed/hostile parse sets `index_state=failed` and never blocks or mutates the version. `dochub-ai` is optional and off by default; when enabled, the default provider is Claude via the Anthropic API and a **local-model adapter** serves air-gapped installs that must not egress content. Every AI action writes an audit event; AI can *suggest* (e.g. flag PII) but a human approves any resulting action. AI never receives keys and never writes to storage.

**Phase.** Extraction = Phase 3. AI = Phase 5. Read-only + audited invariant applies from the moment either ships.

---

## 7. Auth / session security

> Cross-ref: `02-auth.md` for the full design.

**Rule.** Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed. Passwords are `argon2id`. Auth endpoints are rate-limited. All token/hash comparisons are constant-time. CSRF defence on state-changing cookie-auth requests.

**Why.** OWASP A07 (Identification and Authentication Failures) + Password Storage Cheat Sheet — `argon2id` first-choice, min `m=19 MiB, t=2, p=1` ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)). `SameSite=Lax` blocks most CSRF while still allowing the optional WOPI interop redirect path.

**How.** `argon2` crate, `Argon2id`, `m=19456, t=2, p=1`, 16-byte salt from `OsRng`. Cookies `__Host-...; HttpOnly; Secure; SameSite=Lax; Path=/`; session ID 256-bit CSPRNG, server-side store. `subtle::ConstantTimeEq` for tokens/hashes/HMAC tags. CSRF: double-submit cookie + `Origin`/`Referer` check on cookie-auth state-changing requests. Rate-limit `/login` 10/min/IP; per-account exponential backoff after 5 failures.

**Phase.** v0 must-have.

---

## 8. Editor access tokens (embedded path) + WOPI interop tokens

> Cross-ref: `02-auth.md`, `01-wopi.md`.

**Rule.** The **primary** editing path mints a short-TTL, per-launch, per-document **editor access token** bound to `(user_id, file_id, perms, exp, jti)`, HMAC-signed, validated on every editor byte-stream call; the document-id in the URL must match the claim. **WOPI access tokens** are the same shape but used only on the optional external-Office interop path.

**Why.** Bytes must not be reachable by anything but the authenticated editor session that opened the document. A per-launch capability decouples "who opened it" (a session user or a share-link consumer) from "serve these bytes." Microsoft's WOPI model tolerates ~10-hour `access_token_ttl`; we go shorter because sessions are interactive.

**How.** Token = HMAC-SHA256 over `{user_id | "share:<id>", file_id, perms, exp, jti}`, TTL ~10 min, refreshed via the session cookie near expiry. Perms: `read`, `write`, `comment`. Every call validates the token, then `(URL file_id) == (token file_id)` and `(required perms) ⊆ (granted)`. WOPI proof-key validation applies only if an operator federates to external MS365 clients (opt-in interop); otherwise not needed.

**Phase.** Editor access token = Phase 2 (issuance + validation). WOPI interop tokens = optional, whenever an operator turns on the interop path.

---

## 9. Signed URL tokens for fs / memory share serving

**Rule.** When `usercontent_origin` serves share-link bytes from an fs/memory backend, the `/raw/{token}` URL carries an HMAC-signed token: payload = `{key, exp, method}`, verified in constant time.

**Why.** The user-content origin must not read session cookies (origin separation) and must not accept unauthenticated reads. Signed URLs let the app origin grant time-limited access without sharing session state.

**How.** Sign `hmac-sha256(secret, "{key}|{exp_unix}|{method}")` → base64url, verify with `subtle::ConstantTimeEq`. TTL 5 min default. S3/MinIO/R2/B2 use native pre-signed GETs where available. Share bytes are decrypted server-side before serving (the user-content origin still gets plaintext of a document the share explicitly exposes — the share is the authorisation).

**Phase.** v0 must-have.

---

## 10. Audit logging — append-only + hash-chained

**Rule.** The `audit_log` is append-only and hash-chained; committed rows are never `UPDATE`d or `DELETE`d. Log auth events, document lifecycle (create/version/restore/tombstone), share create/revoke, retention/legal-hold changes, provenance signing, and every AI action. Never log document contents, plaintext, tokens, passwords, cookie values, or keys.

**Why.** OWASP A09 (Security Logging and Monitoring Failures) — insufficient logging hides breaches; logging secrets *is* the breach (A02). For a compliance-oriented registry the audit trail is a product surface: it must be complete and provably un-rewritten.

**How.** Each audit row stores `prev_hash` = previous row's `content_hash`; `verify_chain` over the audit log detects any insertion/edit/deletion. Redact `Authorization`, `Cookie`, editor/WOPI tokens, `?access_token=` at the HTTP layer (`tower-http` `SetSensitiveHeadersLayer` + URL redactor). Body logging disabled; debug body logging refuses to start in prod. Schema: `{ts, actor_id, action, file_id?, version_seq?, ip, user_agent, result, prev_hash, content_hash}`. Exportable, offline-verifiable reports (§compliance).

**Phase.** Append-only audit log = v0 (inherited). Hash-chaining the audit log = Phase 0. Exportable verifiable reports = Phase 4.

---

## 11. HTTP-level hardening

**Rule.** Every app-origin response carries `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`, `X-Content-Type-Options: nosniff`, and a strict CSP.

**Why.** HSTS pins HTTPS; `nosniff` blocks MIME confusion; CSP `frame-ancestors` replaces legacy `X-Frame-Options`; `Permissions-Policy` shrinks the powerful-features surface ([OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)).

**The framing catch.** Embedded editors run inside the SPA on the app origin (same-origin iframes) — `frame-ancestors 'self'` covers them. Only the **optional** WOPI interop path needs an editor-owned iframe; those interop routes get a configurable `frame-ancestors <editor origins>` override. The user-content origin allows `frame-ancestors 'self' <editor origins>` for inline previews.

**How.** `tower-http::set_header` stack + per-route overrides for the WOPI interop routes.

**Phase.** v0 must-have.

---

## 12. Dependency hygiene

**Rule.** CI runs [`cargo audit`](https://crates.io/crates/cargo-audit) on every PR; `cargo deny` enforces licence + advisory + duplicate-version policy; all deps pinned in `Cargo.lock` (committed). Crypto dependencies are added only with justification and preference for audited crates.

**Why.** OWASP A06 (Vulnerable and Outdated Components). Duplicates defeat `cargo audit`; `cargo deny` catches them. Crypto is the highest-blast-radius dependency class — no homebrew, no casual additions (CLAUDE working rules #4, #7).

**How.** CI: `cargo audit --deny warnings` + `cargo deny check`. `deny.toml`: `[advisories] vulnerability = "deny"`; `[licenses]` allowlist (`Apache-2.0`, `MIT`, `BSD-3-Clause`, `ISC`, `Unicode-DFS-2016`); `[bans] multiple-versions = "warn"`. Crypto primitives come from `aws-lc-rs`/`ring`, `sha2`, `ed25519-dalek`, `argon2` — audited RustCrypto/AWS crates only.

**Phase.** v0 must-have.

---

## 13. Secrets management

**Rule.** Dev secrets in `.env` (gitignored); `.env.example` is the contract. Prod secrets injected from the operator's secret manager (Doc-Hub / AWS Secrets Manager / SOPS / k8s Secrets). Boot refuses to start with missing or default secrets.

**Why.** OWASP A02 (Cryptographic Failures) and A05 (Security Misconfiguration) cover hard-coded/default secrets.

**How.** Required: `DOCHUB_MASTER_KEY` (or `DOCHUB_KMS_*`), `DOCHUB_SESSION_SECRET`, `DOCHUB_EDITOR_HMAC_SECRET`, `DOCHUB_SIGNED_URL_HMAC_SECRET`, `DOCHUB_DB_URL`, `DOCHUB_S3_*` / bucket creds, optional `DOCHUB_OIDC_*`, optional `DOCHUB_AI_API_KEY`. All ≥ 32 bytes base64 random; boot rejects shorter values or literal `"changeme"`. HMAC/KEK secrets accept a comma-separated rotation list — leftmost signs/wraps, all verify/unwrap, drop the tail after rotation.

**Phase.** v0 must-have.

---

## 14. Encryption at rest — key management

**Rule.** Doc-Hub encrypts all document bytes at rest itself, in `dochub-crypto`, with no config path to disable it. AES-256-GCM envelope encryption: a per-workspace **DEK** wrapped by a master **KEK** (`DOCHUB_MASTER_KEY`) or an external **KMS**. Only wrapped DEKs are persisted. Boot **refuses to start** without a KEK/KMS.

**Why.** A hub cannot delegate its core promise to whatever bucket the operator chose (the retired Drive's "encryption is the substrate's job" stance is wrong for this product). Envelope encryption with per-workspace DEKs limits blast radius, enables key rotation without re-encrypting blobs, and enables per-workspace re-key/crypto-shred.

**How.**

- **Primitive:** AES-256-GCM via `aws-lc-rs`/`ring`, random 96-bit nonce per blob, stored `nonce ‖ ciphertext ‖ tag`. No homebrew.
- **DEK lifecycle:** generated per workspace, wrapped by the KEK (AES-KW/GCM) or the KMS; the wrapped DEK lives in `workspace_storage`. Unwrapped DEKs live only in memory, zeroised on drop (`zeroize`).
- **KEK/KMS:** `DOCHUB_MASTER_KEY` (32-byte base64) for self-host; `aws-sdk-kms` (or compatible) for managed KEKs behind a `kms` feature.
- **Rotation:** KEK rotation re-wraps DEKs without rewriting document blobs. Explicit workspace re-key re-encrypts blobs under a fresh DEK (crypto-shred old data). Both are lossless — property-tested: after rotation every existing document still decrypts.
- **No plaintext at rest, ever:** enforced by construction (handlers can't reach the raw operator) and by a spy-backend property test asserting ciphertext.
- **Keys never leak:** never in logs, errors, responses, or the AI provider's inputs. Substrate SSE (S3 `AES256`/`aws:kms`) documented as optional defence-in-depth on top.

**Phase.** Envelope encryption + boot key-check = Phase 0. Rotation + KMS adapter + workspace re-key = Phase 1.

---

## 15. Immutable history — tamper-evidence

**Rule.** Every committed document version is immutable and hash-chained; version blobs are write-once and content-addressed; the chain is verifiable and any break is a tamper alarm, surfaced and audited, never silently repaired.

**Why.** Tamper-evidence *is* the registry guarantee. A "history you can prove" only holds if altering any past byte is detectable. This is inviolable rule #6.

**How.**

- `file_versions(file_id, seq, storage_key, size, content_hash, prev_hash, author_id, reason, created_at)`. On every save a **new** row is appended: `content_hash = SHA-256(ciphertext)`, `prev_hash` = the previous version's `content_hash`.
- **Write-once:** blobs are content-addressed and never overwritten. "Delete" sets a tombstone under retention/legal-hold (§16); bytes under hold are never removed.
- **Verification:** `verify_chain(file_id)` recomputes hashes + links end-to-end; a mismatch is surfaced to admins and audited. The `audit_log` is chained the same way (§10).
- **Restore is additive:** restoring version *k* appends version *N+1* byte-equal to *k*; nothing is destroyed. Property-tested.
- **Provenance (optional):** Ed25519-signed document issuance/registration and periodic anchoring of chain heads for third-party-verifiable, offline-checkable provenance.

**Phase.** Version + hash-chain engine = Phase 0. Provenance signing = Phase 4.

---

## 16. Retention + legal hold

**Rule.** Deletion is always a tombstone under a retention policy; a document under **legal hold** cannot be tombstoned or purged by any path. Retention determines when a tombstoned document's bytes may finally be purged; legal hold overrides retention.

**Why.** Compliance-grade record-keeping requires that records survive deletion attempts (retention) and that records under investigation are frozen (legal hold). "No hard delete" is only meaningful if the hold is unbypassable.

**How.** `retention_policies` and `legal_holds` tables. The delete/tombstone path checks legal hold first (refuse if held), then retention (tombstone, schedule eventual purge only after the retention window). No code path removes bytes under hold — property-tested: a held document resists deletion from every entry point. All changes are audited (§10) and appear in exportable retention reports (Phase 4).

**Phase.** Tombstone path = Phase 0. Retention + legal-hold enforcement = Phase 1. Admin UI + reports = Phase 4.

---

## 17. OWASP Top 10 (2021) walkthrough

From [OWASP Top 10 2021](https://owasp.org/Top10/2021/):

- **A01 Broken Access Control** — role checks (Owner/Admin/Member); editor/WOPI token scope ⊇ op; share-link ownership; document-id in URL must match the token claim; no "URL is the secret" except the signed-URL share flow. (§1, §8, §9)
- **A02 Cryptographic Failures** — mandatory at-rest envelope encryption (§14), `argon2id` (§7), HMAC + constant-time (§8, §9), TLS in transit, HSTS (§11), no secret/plaintext/key in logs (§10).
- **A03 Injection** — `sqlx` parameterised queries; no shell-out on user input; display-name sanitised on render (§2); AI queries use bound provider APIs, never string-concatenated prompts around untrusted control tokens.
- **A04 Insecure Design** — server-trusted threat model stated honestly (§0), origin separation (§4), opaque keys (§1), documents-only allowlist (§3), immutable history (§15), pluggable adapters with explicit security contracts.
- **A05 Security Misconfiguration** — boot-time key check + secret check (§13, §14), prod invariants (origins differ, no plaintext at rest, body logging refused), default-deny CSP (§11).
- **A06 Vulnerable and Outdated Components** — `cargo audit` + `cargo deny` in CI; audited crypto crates only (§12).
- **A07 Identification and Authentication Failures** — §7.
- **A08 Software and Data Integrity Failures** — `Cargo.lock` committed; hash-chained versions + audit (§15, §10); Ed25519 provenance signing (Phase 4); signed releases (later).
- **A09 Security Logging and Monitoring Failures** — append-only, hash-chained audit log (§10).
- **A10 SSRF** — S3/KMS/OIDC/AI endpoint URLs validated: not AWS metadata IP (`169.254.169.254`), not link-local, not loopback unless dev opt-in. No other Doc-Hub code fetches user-supplied URLs.

---

## v0 / Phase 0 must-have checklist

- [ ] **Server-trusted threat model documented** (not zero-knowledge); scope of at-rest encryption stated in README/CLAUDE/ARCHITECTURE
- [ ] **Mandatory at-rest envelope encryption** (`dochub-crypto`); boot refuses without a KEK/KMS
- [ ] **No plaintext document bytes at rest** (spy-backend property test)
- [ ] **Immutable, hash-chained `file_versions`**; write-once blobs; `verify_chain` detects tampering (property test)
- [ ] **Append-only, hash-chained `audit_log`**; no `UPDATE`/`DELETE` on committed rows
- [ ] **Restore is additive** (property test); no path reduces the version count
- [ ] **Tombstone-only delete**; retention + legal-hold gate (held document cannot be purged — property test)
- [ ] **Documents-only ingest allowlist** enforced on every path, by extension + magic-byte sniff; reject not quarantine
- [ ] Opaque ULID storage keys; `fs` canonicalises + root-confines; rejects escaping symlinks
- [ ] Display name sanitised (control chars, NUL, reserved names, length, NFC)
- [ ] `X-Content-Type-Options: nosniff` on every response
- [ ] **Separate user-content origin enforced** (refuse prod boot if origins match); no cookies there; `CSP: sandbox`
- [ ] `Content-Disposition: attachment` for non-previewable share types; PDF `attachment` by default
- [ ] Strict CSP on app origin; embedded editors covered by `frame-ancestors 'self'`
- [ ] Per-request body cap, per-workspace quota, per-IP rate limit (`tower_governor`)
- [ ] `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax` cookies; `argon2id`; CSRF on cookie-auth state-changing routes; constant-time compares
- [ ] Editor access tokens scoped + short-TTL + per-call validation; document-id matches claim
- [ ] HMAC-signed short-TTL `/raw/{token}` URLs for fs/memory shares; constant-time verify
- [ ] `tracing` redaction allowlist; auth/document/share/retention events logged; no body/token/key/plaintext logging
- [ ] HSTS, Referrer-Policy, Permissions-Policy on app origin
- [ ] `cargo audit` + `cargo deny` in CI; audited crypto crates only
- [ ] `.env.example` complete; boot rejects default/short secrets; `DOCHUB_MASTER_KEY` required

## Later-phase checklist

- [ ] KEK rotation + KMS adapter + per-workspace re-key (crypto-shred) — Phase 1
- [ ] Retention/legal-hold admin UI; exportable, offline-verifiable audit + retention reports — Phase 4
- [ ] Ed25519 document signing/provenance; registrar (DigiLocker-style) issuance; chain-head anchoring — Phase 4
- [ ] AI layer read-only + audited; local-model adapter for air-gapped installs — Phase 5
- [ ] Signed releases (sigstore/cosign), per-release SBOM
- [ ] Automated dependency-bump PRs (Renovate)

## The non-negotiables

1. **Encryption is not optional.** No config disables at-rest encryption; boot refuses to start without a master KEK/KMS; no plaintext document bytes ever reach a storage backend.
2. **History is append-only and tamper-evident.** No code path overwrites or hard-deletes a committed version, an audit row, or a hash-chain link. Destructive-looking operations are tombstones under retention/legal-hold.
3. **Separate user-content origin.** Share-link/user content serves from a registrable origin distinct from the Doc-Hub app; same-origin user content is XSS waiting to happen ([Google 2012](https://security.googleblog.com/2012/08/content-hosting-for-modern-web.html); [Google 2023](https://security.googleblog.com/2023/04/securely-hosting-user-data-in-modern.html)).
4. **The threat model is honest.** Server-trusted, not zero-knowledge — stated plainly everywhere so no user assumes a guarantee we do not provide.

---

## Sources

- OWASP cheat sheets: [File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html); [Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html); [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); [HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html); [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
- OWASP Top 10: [2021 index](https://owasp.org/Top10/2021/); [A02 Cryptographic Failures](https://owasp.org/Top10/2021/A02_2021-Cryptographic_Failures/); [A05 Security Misconfiguration](https://owasp.org/Top10/2021/A05_2021-Security_Misconfiguration/); [Secure Headers Project](https://owasp.org/www-project-secure-headers/).
- Envelope encryption / KMS: [AWS — Envelope encryption](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping); [NIST SP 800-38D (GCM)](https://csrc.nist.gov/pubs/sp/800/38/d/final); [NIST SP 800-57 (key management)](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final).
- Rust crypto crates: [aws-lc-rs](https://crates.io/crates/aws-lc-rs); [ring](https://crates.io/crates/ring); [sha2](https://crates.io/crates/sha2); [ed25519-dalek](https://crates.io/crates/ed25519-dalek); [argon2](https://crates.io/crates/argon2); [zeroize](https://crates.io/crates/zeroize); [subtle](https://crates.io/crates/subtle).
- Google on user content: [Content hosting for the modern web (2012)](https://security.googleblog.com/2012/08/content-hosting-for-modern-web.html); [Securely Hosting User Data (2023)](https://security.googleblog.com/2023/04/securely-hosting-user-data-in-modern.html); [web.dev mirror](https://web.dev/articles/securely-hosting-user-data).
- MDN: [X-Content-Type-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options); [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy); [Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security).
- Sniffing + rate limit: [infer](https://crates.io/crates/infer); [tree_magic_mini](https://crates.io/crates/tree_magic_mini); [tower_governor](https://crates.io/crates/tower_governor).
- Dependency hygiene: [cargo-audit](https://crates.io/crates/cargo-audit); [RustSec Advisory Database](https://rustsec.org/).
- PDF risk: [Codean Labs — CVE-2024-4367 PDF.js](https://codeanlabs.com/blog/research/cve-2024-4367-arbitrary-js-execution-in-pdf-js/); [GHSA-wgrm-67xf-hhpq](https://github.com/advisories/GHSA-wgrm-67xf-hhpq).
