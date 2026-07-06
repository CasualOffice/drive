# 01 — Editor handoff for Doc-Hub

Research brief for how a document leaves the encrypted hub and enters an editor. The **primary path is embedded native editors** via the sibling SDKs (Casual Sheet / Docs / PDF): the server decrypts bytes in memory and streams them to an editor mounted inside the SPA, over the authenticated app origin. **WOPI is kept only as optional interop** for external Office-family clients (Office for the web / Collabora / ONLYOFFICE) — not the default path, and never the only one. This brief covers both, then justifies the split.

Primary sources: sibling SDK docs (`sheet` `SDK_ARCHITECTURE.md`, `document` `@casualoffice/docs`) for the embedded path; Microsoft Cloud Storage Partner Program (CSPP) docs for the WOPI interop path. Collabora / ONLYOFFICE specifics are noted `[unverified]` where the primary URL was unreachable this session.

## TL;DR

- **Embedded is primary.** Doc-Hub mints a short-lived **editor access token** `(user_id, file_id, perms, exp, jti)`, mounts the format's SDK editor in the SPA, decrypts the document bytes server-side, and streams them to that editor over the app origin. Saves encrypt, append a hash-chained version, audit, and enqueue reindex. No third-party server ever sees plaintext.
- **Co-editing is embedded too.** Team documents co-edit through the `collab` server (Yjs / Hocuspocus), which relays *opaque* document bytes and never parses or decrypts them. Presence for co-editing rides the same channel (see `14-presence.md`).
- **WOPI is optional interop only.** Kept for shops that want to open a `.docx`/`.xlsx` in Office for the web / Collabora / ONLYOFFICE. Off by default; when enabled it is the *external* handoff, and it forces a plaintext boundary (the external editor holds the bytes) that the embedded path never has.
- The accurate WOPI facts still hold and are worth keeping: required host endpoints (**CheckFileInfo, GetFile, PutFile, Lock, Unlock, RefreshLock, UnlockAndRelock**), **30-min one-per-file opaque locks**, the **409 + `X-WOPI-Lock`** discovery channel, host-opaque `(user, resource)` access tokens, RSA-SHA256 proof keys. They frame the interop path, not the product.
- sheet/ already has ~500 LOC of "WOPI-on-self" scaffolding; document/'s `host.Integration` enumerates an unwritten `wopi` impl. That scaffolding is repurposed for the *interop* lane; the *embedded* lane is the SDK embed path each editor already ships.

## 1. Primary path — embedded native editors

The default handoff never leaves Doc-Hub's trust boundary.

```
SPA opens a document
  → app origin mints an editor access token (user_id, file_id, perms, exp, jti), HMAC-signed
  → SPA mounts the format's SDK editor inline (Casual Sheet / Docs / PDF / Markdown)
  → dochub-storage reads the ciphertext blob, dochub-crypto.open() decrypts it IN MEMORY
  → server streams plaintext bytes to the embedded editor over the authenticated app origin
  → user edits (co-edits via the collab server for team docs)
  → save → dochub-crypto.seal() → write-once content-addressed blob
         → append hash-chained file_versions row (content_hash / prev_hash)
         → append audit event → enqueue dochub-index reindex
```

Properties that make this the default:

- **No external plaintext boundary.** Bytes decrypt in the Doc-Hub process and stream only to an editor served from the app origin under a per-launch token. Nothing is handed to a third-party Office server. This is the same trust boundary as the rest of the product: server-trusted, at-rest-encrypted, not zero-knowledge.
- **One `<Editor>` component, per-format SDK.** The SPA hosts each format via its sibling SDK (`sheet`, `document`, `casual_pdf`); the shell is one component that selects the SDK by MIME. No launcher, no redirect.
- **Token discipline.** The editor access token is per-launch, per-document, short-TTL; the `file_id` claim MUST equal the document id in the URL on every request. Distinct from session cookies, share-link tokens, and signed-URL tokens (`ARCHITECTURE.md` token model). sheet's existing `file_id`-claim check (`apps/server/src/wopi.ts:48-60`) is the pattern to reuse for the embedded token guard.
- **Save = a new version, never an overwrite.** The save path is append-only by construction: encrypt → write-once blob → new `file_versions` row → audit. It cannot mutate a committed version.

### Co-editing (embedded)

Team documents co-edit through the `collab` server (Yjs / Hocuspocus). The collab server relays **opaque** document bytes — it never parses or decrypts them, so it is not a plaintext-at-rest surface. Editor-level presence (cursors, selections, who-is-typing) lives here; Doc-Hub-shell presence (who has the editor open) is a separate, coarser channel documented in `14-presence.md`. Two clients editing one document both land their saves as ordered, hash-chained versions (Testing UC-5).

## 2. Optional interop — WOPI for external Office clients

WOPI is the handoff **when an operator opts in** to editing hub documents in Office for the web / Collabora / ONLYOFFICE instead of the embedded editors. It is off by default. Enabling it is a deliberate trade: the external editor receives decrypted bytes over WOPI's REST surface, so for the duration of that session the plaintext crosses Doc-Hub's boundary into a third-party editor. That is acceptable only under the same server-trusted model (TLS in transit, the external editor is operator-chosen and trusted); it is never the path for untrusted or high-sensitivity documents, and the docs-only allowlist still gates what can be opened.

Everything below is the accurate WOPI host contract, framed as the interop surface Doc-Hub implements when the feature is on.

### 2.1 Minimum endpoint set

`rest/endpoints`: "All actions require the CheckFileInfo and GetFile operations." `online/discovery#action-requirements`: the `edit` action requires `update` (= PutFile + PutRelativeFile) and `locks` (= Lock + Unlock + RefreshLock + UnlockAndRelock).

| Operation | Verb + path | `X-WOPI-Override` | Required |
|---|---|---|---|
| CheckFileInfo | `GET /wopi/files/{id}` | — | yes |
| GetFile | `GET /wopi/files/{id}/contents` | — | yes |
| PutFile | `POST /wopi/files/{id}/contents` | `PUT` | yes |
| PutRelativeFile | `POST /wopi/files/{id}` | `PUT_RELATIVE` | yes (Save-As) |
| Lock | `POST /wopi/files/{id}` | `LOCK` | yes |
| Unlock | `POST /wopi/files/{id}` | `UNLOCK` | yes |
| RefreshLock | `POST /wopi/files/{id}` | `REFRESH_LOCK` | yes |
| UnlockAndRelock | `POST /wopi/files/{id}` | `LOCK` + `X-WOPI-OldLock` present | yes |
| GetLock | `POST /wopi/files/{id}` | `GET_LOCK` | optional (`SupportsGetLock`) |

URLs MUST start with `/wopi/` (no `/ids/`). Containers, ecosystem, bootstrapper, Delete/RenameFile, OneNote, broadcast, CSPP-Plus RTC: out of scope.

Status-code contract: `200` success; `400` if `X-WOPI-Lock` missing; `401` bad token; `404` not-found/not-authorized; **`409` lock mismatch with `X-WOPI-Lock: <current>` response header**; `412` for GetFile over `X-WOPI-MaxExpectedSize`; `413` for PutFile over host cap; `500` server error.

`CheckFileInfo` required properties: **BaseFileName, OwnerId, Size, UserId, Version** (`Version` is string-typed even when numeric). To enable editing add `UserCanWrite=true`, `SupportsUpdate=true`, `SupportsLocks=true`, `SupportsExtendedLockLength=true`. Anonymous: set `IsAnonymousUser=true`; `UserId` may be omitted but `OwnerId` stays mandatory. Optional `FileUrl` gives Office a CDN bypass for GetFile but doesn't replace it. Omit unwanted properties — never send `null`.

**Interop crypto boundary.** GetFile serves decrypted bytes (dochub-crypto.open() runs before the WOPI response); PutFile re-seals and appends a new hash-chained version. The blob at rest is still ciphertext — WOPI only exposes plaintext over the authenticated, TLS interop channel to the trusted external editor.

### 2.2 Discovery XML

The WOPI *client* (Office for the web, Collabora, ONLYOFFICE) publishes `discovery.xml`. Doc-Hub, as host, fetches and caches it; the host never publishes one.

Office for the web endpoints (`online/build-test-ship/environments`):

- Production: `https://onenote.officeapps.live.com/hosting/discovery`
- Dogfood: `https://ffc-onenote.officeapps.live.com/hosting/discovery`

Collabora and ONLYOFFICE expose the equivalent at `/hosting/discovery`, following the Microsoft schema [unverified — Collabora/ONLYOFFICE primary URLs were blocked by WebFetch this session].

Shape: `<wopi-discovery>` > `<net-zone>` > `<app name="Word" favIconUrl="…">` > `<action name="edit" ext="docx" requires="locks,update" urlsrc="…"/>`. Example from `online/discovery`:

```xml
<action name="edit" ext="docx" requires="locks,update"
        urlsrc="https://word-edit.officeapps.live.com/we/wordeditorframe.aspx?
        <ui=UI_LLCC&><rs=DC_LLCC&><showpagestats=PERFSTATS&>"/>
```

`urlsrc` is a template. Host parses `<name=PLACEHOLDER&>` segments: known placeholder → substitute and drop the angle brackets; unknown → drop the whole segment. **`WOPI_SOURCE` is the one mandatory placeholder** (URL-encoded WOPISrc); others (`UI_LLCC`, `DC_LLCC`, `SESSION_CONTEXT`) are optional. `SESSION_CONTEXT` is echoed back on every subsequent request in `X-WOPI-SessionContext` — useful for log correlation.

The `<proof-key>` element carries the RSA public key in both `.NET CspBlob` form (`value` / `oldvalue`) and portable RSA form (`modulus` / `exponent` / `oldmodulus` / `oldexponent`, base64).

Refresh cadence: Microsoft recommends 12–24h plus re-fetch immediately on proof-key validation failure (failure ≈ key rotation). **Do not honour the HTTP `Expires` header** on discovery — explicitly broken per `online/discovery`.

### 2.3 Access tokens + proof keys

**Access tokens** (`rest/concepts#access-token`). Host-issued, opaque, client never parses. Scoped to `(user, resource)` — never reused across users or files. Must match the CheckFileInfo permission bits. Sent on every request as `?access_token=…`; `Authorization: Bearer` is optional, so hosts MUST accept the URL param. `access_token_ttl` is **absolute JS-epoch milliseconds** (recommend ~10h); `0` means unknown and disables Office's save-prompt-before-expiry → data-loss risk. Don't auto-revoke — early revocation triggers session-timeout loops.

For Doc-Hub interop: reuse the editor access token as a signed JWT `{file_id, user_id, perms, exp}`. The `file_id` claim MUST be compared against URL `:id` on every request — the same guard the embedded path uses (§1); sheet's `apps/server/src/wopi.ts:48-60` already does this.

**Proof keys** (`online/scenarios/proofkeys`). Office's defence against forged requests using leaked tokens. Office-for-the-web-specific; **skip it when the only interop clients are Collabora/ONLYOFFICE under an operator's control, mandatory if federating to Office for the web.**

Headers per request: `X-WOPI-Proof` (RSA-SHA256, current key), `X-WOPI-ProofOld` (same payload, previous key), `X-WOPI-TimeStamp` (`DateTime.UtcNow.Ticks`, 100-ns intervals since 0001-01-01, signed i64).

Signed byte sequence, big-endian:

```
[i32 len(token)][UTF-8 token]
[i32 len(URL)  ][UTF-8 URL_UPPERCASED, full querystring]
[i32 8         ][i64 timestamp]
```

Accept ANY of: (1) `Proof` verifies under current key; (2) `ProofOld` verifies under current key (client rotated after issuing); (3) `Proof` verifies under old key (host hasn't refreshed discovery). Reject if `TimeStamp` > 20 min old. Failure → **HTTP 500** (not 401, per spec). On success against old key, re-fetch discovery.

Rust: `rsa` crate, `RsaPublicKey::new(BigUint::from_bytes_be(&modulus), BigUint::from_bytes_be(&exponent))` then `key.verify(Pkcs1v15Sign::new::<Sha256>(), &expected, &sig)`. Port the proof-key fixtures from the Microsoft Office-Online-Test-Tools repo as a unit test.

Gotcha: TLS terminated ahead of Axum makes the app see `http://` while Office signed `https://`. Preserve scheme via `X-Forwarded-Proto` and reconstruct, or terminate TLS in-process.

### 2.4 Lock semantics

From `rest/concepts#lock` and the per-operation pages:

- **One lock per file.** Lock ID is opaque ≤1024 ASCII (≤256 without `SupportsExtendedLockLength`). Host stores verbatim, never parses.
- **Auto-expires after 30 min** unless refreshed. Normative. Hosts must enforce.
- **Not user-bound.** A Lock under user A's token may be released by an Unlock under user B's token, as long as B may edit the file and `X-WOPI-Lock` matches (`rest/concepts#lock`).
- **`Lock` with the current lock ID = RefreshLock** (`rest/files/lock`).
- **`UnlockAndRelock` reuses `X-WOPI-Override: LOCK`**, differentiated only by `X-WOPI-OldLock`. Must be atomic — no observable unlocked state mid-op. A router that dispatches on Override alone mis-routes this.
- **`PutFile` on an unlocked file** is allowed iff the file is 0 bytes (createnew); otherwise 409.
- **The 409 + `X-WOPI-Lock` response header is mandatory and asymmetric.** Emit `X-WOPI-Lock: <current>` on 409 (empty string if currently unlocked, omit if the lock is non-WOPI-representable). The 200 path forbids the header. Forgetting it sends Office into retry-spin.

Observed refresh cadences: Office calls RefreshLock ~every 10 min; Collabora's `storage.wopi.locking.refresh` defaults to 900 s [grounded via WebSearch of Collabora SDK config docs]; ONLYOFFICE follows the 30-min budget [unverified]. Stale-detect on `lock_age > 30 min - grace`, not a tight 10-min window.

Concurrent edits across *different* WOPI clients (Office + Collabora on the same file) are NOT mediated by WOPI. First lock wins; the second sees 409 → "locked by other." This limitation does not exist on the embedded path, where the `collab` server mediates all co-editing.

### 2.5 Real-time co-editing under WOPI

**WOPI does not do co-editing. The WOPI client does.** This is the key asymmetry with the embedded path, where *Doc-Hub's* `collab` server owns co-editing.

Office for the web (`online/scenarios/coauth`): user A opens → CheckFileInfo (A) → Lock (A, Office-internal lock ID). User B joins the existing session — no second Lock. Edits merge inside Office's servers; PutFile fires periodically (Word 30 s if dirty; Excel 2 min, always the **principal user** = latest joiner; PowerPoint 60 s if dirty). Perm re-checks: Word/PPT CheckFileInfo per user ≤5 min; Excel RefreshLock per user ≤15 min. Last user leaves → Unlock. Lock count is never a proxy for editor count. Host MUST accept Unlock/RefreshLock under any participating user's token if perms + lock-ID match; `X-WOPI-Editors` on PutFile is the audit channel.

Collabora Online / ONLYOFFICE Docs: each presents as **one WOPI client per file** — one Lock, one debounced PutFile stream on autosave + last-disconnect. Their internal collab is their concern. [unverified — Collabora/ONLYOFFICE SDK URLs blocked by WebFetch this session; sourced from DeepWiki summaries.]

Implication for Doc-Hub interop: honour exactly one lock per file; accept full-file binary overwrites (no diff/patch at the WOPI layer); bump `Version` + emit `X-WOPI-ItemVersion` on every successful PutFile; never assume the PutFile-token user is the only author; and re-seal + append a hash-chained version on every PutFile so the immutability guarantee survives the interop round-trip.

## 3. What sheet/ and document/ contribute to each lane

Both editors already ship an SDK embed path (the embedded lane) and partial WOPI surface (the interop lane).

### Embedded lane (primary)

- sheet: mount via its SDK embed path (`SDK_ARCHITECTURE.md`); Doc-Hub streams decrypted bytes into the ExcelJS worker; saves POST back to the Doc-Hub app origin under the editor access token.
- document: `@casualoffice/docs` embed booting ProseMirror from streamed bytes; save posts to Doc-Hub.
- Both: co-edit under Doc-Hub's `collab` server (Yjs/Hocuspocus); the editor's own Yjs room rides underneath and never talks to a third party.

### Interop lane (optional WOPI)

sheet/ — current state: `apps/server/src/wopi.ts` (293 LOC, working host: CheckFileInfo/GetFile/PutFile with JWT-scoped tokens, `file_id` claim validated); `apps/web/src/file-source/wopi-file-source.ts` (215 LOC, self-targeting client); `playwright.wopi.config.ts` + e2e harness. To act as an interop WOPI client it needs a `/hosting/discovery`, an iframe entry route, a lock-refresh loop, and naming hygiene (`wopi.ts` → `wopi-self-host.ts`; add `wopi-discovery.ts`).

document/ — current state: stateless Go gateway, Yjs over WS, `host.Integration` enumerating `inline | wopi | jwtapi`; `backend/test/mock-wopi/` empty; `HOST_INTEGRATION` env defined, wopi impl unwritten. Needs the concrete `backend/internal/host/wopi/` impl (GetFile/PutFile + lock refresh tied to room lifecycle), a discovery + iframe route, gateway-owned lock (not the browser), and a populated mock covering all lock states.

Common (interop): POST tokens into a JS-created iframe, never GET (defeats bfcache double-load, `online/hostpage`); emit `X-WOPI-RequestingApplication` for correlation; cache discovery ≥12h; re-fetch on proof-key failure when Office federation lands.

## 4. Pain points and gotchas (interop lane)

- **409 + `X-WOPI-Lock` is mandatory and asymmetric** (forbidden on 200, required on 409).
- **`Authorization: Bearer` is optional;** query `access_token` is canonical.
- **`UnlockAndRelock` shares `X-WOPI-Override: LOCK`** — distinguished only by `X-WOPI-OldLock`.
- **Proof-key URL is uppercased including the full querystring**; only uppercase the bytes, don't re-encode.
- **TLS terminated ahead of the app breaks proof.** Reconstruct via `X-Forwarded-Proto` or terminate in-process.
- **`access_token_ttl` is absolute ms, not a duration.**
- **Don't revoke tokens early.**
- **PutFile no-lock path only for 0-byte files** (createnew).
- **`Version` must change on every PutFile and be `string`-typed.**
- **`OwnerId`/`UserId` must be alphanumeric** — strip ULID/UUID separators.
- **Excel's PutFile-token user ≠ latest editor** (principal-user rule). Audit by `X-WOPI-Editors`.
- **Two different WOPI clients cannot co-edit the same file** — the embedded lane has no such limit.
- **Discovery `Expires` header lies.**
- **WOPI Validator destroys the test file.** Use a throwaway `.wopitest` in CI.
- **Host page must JS-create the iframe** and POST into it.
- **Re-seal on every PutFile** — the interop round-trip must not skip the encrypt + hash-chain append, or a WOPI save would break the no-plaintext-at-rest and immutability invariants.

## 5. Alternatives considered

**Embedded SDK (chosen as primary).** Doc-Hub decrypts bytes in-process and streams them to an editor mounted in the SPA under a per-launch token; co-editing via the `collab` server. No third-party plaintext boundary, full control of the save/version/audit path, and the sibling editors already ship the embed path. This is the default.

**WOPI (kept as optional interop).** Real spec + Microsoft validator + battle-tested lock/version semantics + a free path to open documents in Office/Collabora/ONLYOFFICE. Cost: it forces a plaintext boundary into a third-party editor and cannot co-edit across two different WOPI clients. Correct as an opt-in interop lane, wrong as the default for an encrypted hub — hence demoted.

**Signed-URL handoff — rejected.** Doc-Hub issues a presigned download, editor edits in memory, PUTs back. No lock, no version negotiation, no mid-session permission re-check, and — fatal here — it would hand out plaintext via a presigned URL, breaking no-plaintext-at-rest. Fine only for a single-user viewer over already-decrypted bytes on the app origin.

**postMessage-only bespoke protocol — rejected.** Every op custom and unverifiable; third parties can't integrate; no proof-key story. WOPI already uses postMessage as a UI-glue layer over REST (`online/scenarios/postmessage`), which is the right division for the interop lane.

## Sources

Primary — sibling SDK docs (embedded lane):

- /Users/sachin/Desktop/melp/services/sheet/SDK_ARCHITECTURE.md
- /Users/sachin/Desktop/melp/services/sheet/CLAUDE.md · README.md
- /Users/sachin/Desktop/melp/services/document/CLAUDE.md · README.md (`@casualoffice/docs` embed path)

Primary — Microsoft Learn CSPP (interop lane, fetched this session):

- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/endpoints
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/getfile
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/putfile
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/lock
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/unlock
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/refreshlock
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/unlockandrelock
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/discovery
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proofkeys
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/coauth
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/postmessage
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/hostpage
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/build-test-ship/environments
- https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/build-test-ship/validator

Secondary (WebSearch snippets — primary URLs WebFetch-denied this session, marked `[unverified]` in body):

- https://sdk.collaboraonline.com/docs/installation/Configuration.html — Collabora `storage.wopi.locking.refresh` default 900s.
- https://deepwiki.com/CollaboraOnline/online/2.1-coolwsd-main-process — COOLWSD/DocumentBroker architecture summary.
- https://deepwiki.com/ONLYOFFICE/DocumentServer/7.4-wopi-protocol
- https://api.onlyoffice.com/docs/docs-api/more-information/faq/using-wopi/ — 30-min lock + refresh.
- https://github.com/Microsoft/Office-Online-Test-Tools-and-Documentation — proof-key fixtures + SampleHostPage.html.
- https://github.com/Microsoft/wopi-validator-core — open-source Validator.
