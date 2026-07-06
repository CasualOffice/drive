# Testing

Doc-Hub is a compliance-grade document registry. Its guarantees — encryption, immutability, provenance, access control — are only real if they are tested, continuously. This is the test contract every PR is measured against. It is an inviolable rule (`CLAUDE.md` #7): **no feature merges without tests.**

## The pyramid

| Layer | Tool | Owns | Speed |
|---|---|---|---|
| **Unit** | `cargo test` (Rust), Vitest (web) | Pure logic: crypto primitives, hash-chain math, config parsing, path confinement, token signing, repo query builders. | ms |
| **Property** | `proptest` | Invariants that must hold for *all* inputs: seal→open round-trips, chain verification, immutability, key rotation. | ms–s |
| **Integration** | `cargo test` + testcontainers | Crates against real SQLite + Postgres, real OpenDAL backends, real HTTP router. | s |
| **Contract** | fixtures | Editor byte-stream + token contract; optional WOPI interop; OIDC flow; storage-adapter conformance across all backends. | s |
| **End-to-end / use-cases** | Playwright | Real browser against the built binary, one test per named user case (below). | s–min |
| **Security** | `cargo audit`, `cargo deny`, targeted tests | Dependency CVEs, license policy, SSRF/authz/path-traversal regression tests. | s |

Coverage gate: **≥ 85%** line coverage on the Rust workspace (`cargo llvm-cov`), enforced in CI. New crypto/immutability code targets 100% branch coverage.

## Non-negotiable invariants (property + integration tested)

These encode the product promises. If any regresses, the build fails.

1. **No plaintext at rest.** For every ingest path, a spy storage backend asserts the bytes it receives are ciphertext, and `open(seal(x)) == x` for all `x`.
2. **Boot refuses without a key.** Starting without a master KEK/KMS aborts with a clear error.
3. **History is append-only.** After N edits there are exactly N chained versions; no API call reduces the version count or mutates a committed version/audit row.
4. **Chain integrity is detectable.** Corrupting any stored version or audit row makes `verify_chain` fail at that link; an intact chain always verifies.
5. **Restore is additive.** Restoring version *k* yields version *N+1* byte-equal to *k*, with *k* and the chain preserved.
6. **Retention & legal hold hold.** A document under legal hold cannot be tombstoned or purged by any path.
7. **Key rotation is lossless.** After KEK rotation, every existing document still decrypts.
8. **Ingest allowlist.** Disallowed MIME types are rejected on both the proxy and direct-to-storage paths, by extension and magic-byte sniff.
9. **Origin isolation.** Production boot aborts if app origin == user-content origin; the user-content origin never sets cookies; `/raw/{token}` is not served on the app origin.
10. **Token separation.** A share-link token cannot act as an editor token (and vice versa); document-id in URL must match the editor token claim.

## End-to-end use-cases (Playwright)

Each maps to a `docs/ux/01-flows.md` flow and must exist before the flow ships:

- **UC-1 Onboard:** first-run admin setup → sign in.
- **UC-2 Project & upload:** create a project, upload a `.docx`, see it listed; upload a `.mp4` → rejected.
- **UC-3 Native edit → version:** open a `.docx`, edit, save; history shows v2 chained to v1; content_hash differs.
- **UC-4 Restore:** restore v1; a v3 appears byte-equal to v1; v2 still present.
- **UC-5 Co-edit:** two browsers edit one document; both saves land as ordered versions.
- **UC-6 Content search:** search a phrase that exists only *inside* a `.pdf`/`.xlsx`; the document is found with a snippet.
- **UC-7 Share:** create a password+expiry share link; recipient opens on the user-content origin; expired link 404s.
- **UC-8 Audit & retention:** perform actions; audit feed lists them in order; export report verifies against the chain; a held document resists deletion.
- **UC-9 Provenance:** issue a signed document; verify its signature + chain offline.
- **UC-10 AI (when shipped):** semantic query surfaces a doc keyword search misses; PII scan flags fixtures; no document/history mutation occurs.

## Fixtures

- Golden documents per format (docx/xlsx/pdf/md/txt/csv/json/yaml) with known content strings for extraction/search assertions.
- Known-answer crypto vectors (seal/open, wrap/unwrap) checked into `dochub-crypto/tests/vectors/`.
- A tamper corpus: pre-built version chains with deliberate corruptions for verification tests.

## Running

```bash
cargo test --workspace                      # unit + integration
cargo test --workspace --features proptest  # property tests
cargo llvm-cov --workspace --fail-under-lines 85
cargo audit --deny warnings && cargo deny check
pnpm --dir web test                         # component/unit (Vitest)
pnpm --dir web test:e2e                      # Playwright use-cases
```

Integration tests spin Postgres + MinIO via testcontainers; the same suite runs against SQLite + fs so both portability targets stay green.

## CI gates

Every PR runs the full command block above plus `cargo fmt --check` and `cargo clippy --workspace -- -Dwarnings`. The marketing site keeps its Lighthouse CI thresholds (Performance/Accessibility/SEO ≥ 0.95 mobile). A red gate blocks merge — no exceptions, no `--no-verify`.

## Definition of done

A change is done when: behaviour has unit + integration coverage; any touched invariant has a property test; any touched flow has (or updates) its e2e use-case; docs in the same PR reflect the change; the coverage gate holds; and the security checklist in `research/06-security.md` is satisfied for new endpoints.
