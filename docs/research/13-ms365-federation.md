# 13 — MS365 / Office Online federation (Phase 3)

The hook is wired in `drive-wopi` already — the `validate_proof_key()` callback is present, currently returns `Ok(())`, and the WOPI spec brief calls it out at `docs/research/01-wopi.md` §6. This brief picks the design back up for Phase 3.

## Why now

The Casual Sheet + Casual Document handoff covers our suite. Federating with **Microsoft Office Online** (the "Open in Office Online" Word/Excel surface) opens Drive to anyone whose org is already in the Microsoft 365 ecosystem and prefers Microsoft's editors. Same WOPI protocol, additional client. Once federated, a user can right-click a `.xlsx` in Drive → "Open in Excel Online" and round-trip the edit through Microsoft's servers without leaving the SaaS-free posture for storage.

## Locked decisions

### Stay a WOPI **host**, not a WOPI client

Drive serves the seven endpoints; Office Online is the client. We don't pull anything *into* Drive from Microsoft's storage. The federation only flips who the requesting client is — same surface, same lock semantics.

### **Validate the proof key on every request** from a registered MS client

Office Online signs every WOPI request with a per-server RSA keypair, rotated on a public schedule. Drive verifies the signature against the **current** public key, falling back to the **old** key during the rotation window. The validation:

1. Reconstruct the canonical-string Microsoft signs (`access_token + URL + timestamp`).
2. Verify against `X-WOPI-Proof` (current key) — accept on match.
3. On mismatch, retry against `X-WOPI-ProofOld` (key being rotated out).
4. On second mismatch, reject with **500** per spec (NOT 401 — the spec is explicit; some Microsoft clients treat 401 as "user signed out" and bounce the editor).
5. Timestamp is rejected when `|now - ts| > 20 min` (Microsoft's documented skew tolerance).

This runs **before** the existing `validate_access_token` HMAC check. Order matters — proof-key failure means "this isn't a real Microsoft client", access-token failure means "real client, wrong token".

### Fetch + cache Microsoft's public keys on a 24h schedule

- Pull from `https://wopi.app/api/discovery` (or the operator-configured equivalent for sovereign clouds).
- Parse the `<proof-key>` element: `value`, `oldvalue`, `endpoint`.
- Cache in-process; refresh every 24h.
- Soft-fail on fetch error → keep using last-known keys (Microsoft's keys rotate roughly monthly; a 1–2 day fetch outage shouldn't take Drive's federation down).

### Discovery document — served, not consumed

We don't fetch Microsoft's `discovery.xml` for our own clients; that lives in `sheet/` and `document/`. We *do* serve our own discovery doc at `/hosting/discovery` so Microsoft's discovery scanner can find Drive. The doc declares:

- App name (`Casual Drive`)
- Favicon
- Supported actions (`view`, `edit`, `preview`) and the WOPI endpoints
- Our root URLs for `.xlsx` and `.docx`

This is unchanged from the existing `sheet/` discovery doc — just hosted on the Drive origin instead of the editor origin.

### Office Online is opt-in per operator — not enabled by default

`DRIVE_WOPI_FEDERATE_MS365=true` toggles federation on. When off:

- `/hosting/discovery` returns 404 (so Microsoft's scanner doesn't even find us).
- The proof-key validator is bypassed entirely (no fetch, no cache).

Why opt-in: most self-hosters don't want Microsoft's editors in the loop. Defaulting on would pull in a Microsoft origin allowlist on every Drive instance.

## Locked-out decisions

- **WOPI integration testing in CI.** Microsoft's WOPI validation suite needs a Microsoft account + agreement to their terms. We test our side against handcrafted fixtures matching the spec; full Microsoft validation runs manually before a federation release.
- **Bidirectional federation** (Drive being a WOPI client to Microsoft's storage). Out of scope. Drive's job is to host *your* files; Microsoft's editor is the optional renderer.
- **Microsoft Graph integration** (Teams notifications, SharePoint sync). Different product. Not WOPI.
- **Federating arbitrary other WOPI hosts** (Google's `.gsheet` editor isn't WOPI; Collabora is but lives separately). The federation logic is Office-Online-specific because each WOPI client's proof-key flow is bespoke.

## Threat model

| Risk | Mitigation |
|---|---|
| **Forged Microsoft request** | Proof-key signature verification against the rotating public key. Without the correct private key, an attacker can't forge `X-WOPI-Proof`. |
| **Replay of a captured request** | Timestamp clamp at ±20 min + `access_token` JTI tracking (the existing HMAC token already has `jti`; the WOPI handler dedupes within the lock window). |
| **Public-key fetch poisoned via DNS** | We pin `wopi.app` over HTTPS + verify the response is well-formed XML. A successful DNS attack still requires a valid `wopi.app` TLS certificate. |
| **Stale keys after rotation** | 24h refresh + fallback to `X-WOPI-ProofOld` covers Microsoft's documented rotation window. If both keys mismatch we fail closed (500). |
| **Microsoft origin allowed to send anything** | The proof-key check + existing access-token check are independent. Even a fully-authentic Microsoft request can't access a file it doesn't have a token for. |

## Config

```
DRIVE_WOPI_FEDERATE_MS365=true
DRIVE_WOPI_DISCOVERY_URL=https://wopi.app/api/discovery   # default; override for sovereign clouds
DRIVE_WOPI_PROOF_KEY_SKEW_SECS=1200                       # 20 min default
```

Sovereign clouds (USGov, China, Germany) have their own WOPI discovery URLs. Operators configure those via the override.

## Schema

No schema changes. Federation is a request-time validation, not a stored-state feature. Audit emits an `wopi.ms365_request` event on every successful Microsoft-originated WOPI call so operators can see federation traffic in their existing audit feed.

## Implementation surface

Three files touched, ~200 LOC + tests:

- `crates/drive-wopi/src/proof_key.rs` (new): fetch + cache + verify, full unit test suite against the published test vectors at `https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proof-keys`.
- `crates/drive-wopi/src/handlers.rs`: add the proof-key check at the top of every WOPI handler when federation is enabled.
- `crates/drive-http/src/discovery.rs` (new): the served discovery doc.

## Test plan

- Microsoft's published test vectors for `X-WOPI-Proof` verification — both current and old key flows.
- Skew-clamp boundary: t=±20m valid, t=±20m1s invalid.
- Key rotation simulation: first request matches `oldvalue`, second matches `value` — both accepted.
- Both keys mismatch → 500 (not 401).
- Federation off → discovery 404 + proof-key validator never runs.
- Federation on + token signature mismatch + proof-key OK → access-token error path (401), not proof-key error path (500).

## Out of scope for v0.4

- **Collabora WOPI federation.** Same protocol, different client. Could land in v0.5 by generalising the proof-key validator into a list of registered WOPI client identities.
- **SharePoint Online sync.** Different protocol entirely.
- **Office for the Web's "co-author" mode through Drive.** Microsoft's co-author features require their own collaboration backend; Drive can't broker that.
- **Federated session SSO** (sign into Drive *via* Microsoft 365). That's §12 OIDC, with Entra as the IdP — different brief.
