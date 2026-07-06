# 02 — Authentication & Identity for Doc-Hub

> Research brief. Doc-Hub = Rust/Axum backend + SPA with embedded editors, an encrypted tamper-evident document registry with **projects/teams** (workspaces + members + roles + invitations). Must self-host on a $5 VPS and scale to teams. Editing is embedded (bytes decrypt server-side and stream to the editor over the app origin); **WOPI is demoted to optional interop**, not the primary path.

> Naming in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`.

**Methodology note.** All sources below were grounded via `WebSearch` snippets against official docs (Nextcloud, Seafile, Pydio, ownCloud, OWASP, Microsoft Learn, crates.io, GitHub). Where a snippet was ambiguous, the claim is tagged `[unverified]`.

---

## TL;DR

- The comparable self-hostable Drives all converge on **server-side sessions for the web UI + OIDC for SSO**, not JWT-in-localStorage. oCIS is the outlier: OIDC is mandatory and it ships an embedded IdP (LibreGraph Connect).
- **The editor access token is *not* user auth.** It is a per-launch, per-document capability the embedded editor presents on every byte-stream call; the Doc-Hub mints it after authorising the user. Same shape backs the optional WOPI interop path (Microsoft tolerates up to ~10 h `access_token_ttl`); we go shorter because sessions are interactive.
- **OWASP 2024 baseline:** Argon2id at `m=19 MiB, t=2, p=1` minimum (or `m=47 MiB, t=1, p=1`); cookies `__Host-`, `HttpOnly; Secure`; never put session tokens in `localStorage`. Doc-Hub uses **`SameSite=Lax`** (00-synthesis tension #5) so the optional WOPI interop redirect still works; Lax + CSRF token + Origin check is the standard belt-and-braces.
- **Share-links done right:** 128-bit random token (not UUIDv4 — it's 122 bits), optional Argon2id-hashed password, expiry default, view/download scope, server-side revocation row, served on the isolated user-content origin.
- **For a Rust/Axum stack the boring stack works:** `argon2`, `tower-sessions` (skip `axum-login`), `openidconnect` (Auth Code + PKCE) for SSO, `jsonwebtoken` for HMAC editor-access + signed-URL tokens, `tower_governor` for rate limits.
- **Recommendation: real accounts with projects/teams from day one.** Doc-Hub is a compliance-oriented registry — roles (Owner/Admin/Member), magic-link invitations, and per-workspace ownership are core scope, not deferred. A single-admin personal locker is just a workspace of one, so the same model serves the $5-VPS solo user and a team without a schema fork.

---

## 1. Survey: how comparable self-hostable Drives do identity

### Nextcloud (PHP / Apache or FPM, MySQL/MariaDB/Postgres)

- **Auth methods:** built-in local users (PHP-hashed), **LDAP/AD** via the bundled `user_ldap` app, **OIDC** via `user_oidc` (can do provisioning or delegate to another backend), **SAML** via `user_saml` ("SSO & SAML" app). See docs: User auth OIDC, User auth LDAP. ([docs.nextcloud.com][nc-oidc], [docs.nextcloud.com][nc-ldap])
- **Sessions:** PHP server-side sessions, cookie-based; no JWT for the web UI.
- **Share-link model:** the gold standard. Per-link **password**, **expiration date** (admin can force a default and enforce a max), and per-folder **permissions**: *Read-only*, *Allow upload and editing*, *File-drop* (write-only), *Hide download*. Admins can enforce password policy globally. ([docs.nextcloud.com][nc-share])
- **Install footprint:** 128 MB RAM/PHP process minimum, 512 MB recommended; 64-bit OS+PHP; needs a webserver + DB. Comfortably runs on a $5 VPS at single-user scale but it's not lightweight. ([docs.nextcloud.com][nc-sys])
- **Lesson:** the share-link UI is the model to copy. Mixing "password" and "expiry" in the same dialog has historically had race-condition bugs (see issue 175968 [unverified]); apply both atomically server-side.

### Seafile (C/Python backend, MySQL/MariaDB)

- **Auth methods:** local accounts (django-style password hash) by default; **LDAP/AD** in CE and Pro; **OAuth** (`pro` and CE since 7.0); **Shibboleth/SAML** via Apache module; **Remote-User** header for fronting with anything else. Authentication backend is switchable. ([manual.seafile.com][sf-ldap-ce], [manual.seafile.com][sf-oauth], [manual.seafile.com][sf-shib])
- **Sessions:** Django session cookies; no first-class JWT for the browser UI.
- **Share-link model:** REST `POST /api/v2.1/share-links/` with `password`, `expire_days`, and `permissions` (`can_edit`, `can_download`). Three preset permission levels: *Preview and Download*, *Preview only*, *Edit on cloud and download*. Admins set `SHARE_LINK_PASSWORD_MIN_LENGTH`, `SHARE_LINK_PASSWORD_STRENGTH_LEVEL`, `SHARE_LINK_EXPIRE_DAYS_MIN/MAX`. ([plus.seafile.com][sf-api], [manual.seafile.com][sf-seahub])
- **Lesson:** policy knobs (min password length, max expiry) are admin-tunable and worth copying.

### Filerun (PHP / MySQL, commercial-but-self-hostable)

- **Auth methods:** local accounts + **LDAP** + **SAML 2.0 / OAuth / OpenID / WS-Federation via SimpleSAMLphp** (delegates the heavy lifting to a separate PHP IdP shim). ([docs.filerun.com][fr-auth], [docs.filerun.com][fr-saml])
- **Install:** PHP extensions (`mysqlnd`, `curl`, `zip`, `xml`, `mbstring`, `imagick`) plus the **ionCube Loader** (closed-source bytecode protection). ([docs.filerun.com][fr-php])
- **Lesson:** outsourcing federated auth to a sidecar (SimpleSAMLphp) keeps the core lean — same pattern as standing an external IdP in front of Doc-Hub. We do **not** want ionCube-style closed-source dependencies.

### Pydio Cells (Go, MySQL/MariaDB required, optional MongoDB)

- **Auth methods:** Cells embeds an OIDC server (a fork of CoreOS Dex [unverified]); the browser auths against it and gets a **JWT** back. Enterprise edition can federate to external OIDC/SAML IdPs. The session API issues JWTs the JS client carries. ([docs.pydio.com][pyd-auth], [docs.pydio.com][pyd-idp])
- **Install footprint:** 4 GB RAM minimum, 8 GB recommended; MySQL/MariaDB required (5.7+/10.3+, *not* 8.0.22). Heavyweight — not a $5 VPS target. ([pydio.com][pyd-req])
- **Lesson:** "OIDC everywhere, even for our own UI" is architecturally clean but it's the reason Cells needs 4 GB. JWT-as-session means revocation requires either short TTL or a denylist; both add complexity.

### ownCloud Infinite Scale / oCIS (Go single binary)

- **Auth methods:** **OIDC is mandatory.** oCIS ships an embedded IdP (LibreGraph Connect / `lico`) on port 9130, backed by the IDM service. For real deployments the embedded IdP is meant to be replaced with Keycloak/Authelia/authentik. ([owncloud.dev][ocis-idp], [doc.owncloud.com][ocis-idp-doc])
- **Sessions:** OIDC tokens (proxy validates); single-binary Go process. ([github.com][ocis-readme])
- **Install:** single Go binary, Go 1.25+ to build; otherwise drop-in. ([github.com][ocis-readme])
- **Lesson:** "force OIDC, ship a built-in IdP for small installs" is a powerful design but it bakes a federated-auth dependency into every install. Too heavy for Doc-Hub, where OIDC is optional and a solo self-hoster should not need to run Keycloak to open their own locker.

| Product | Lang | DB | Default web auth | OIDC | Share-link primitives |
|---|---|---|---|---|---|
| Nextcloud | PHP | MySQL/PG | Session cookie | Plugin | password, expiry, R/W/file-drop, hide-download |
| Seafile | C/Py | MySQL | Session cookie | OAuth/OIDC | password, expire_days, can_edit/can_download |
| Filerun | PHP | MySQL | Session cookie | via SimpleSAMLphp | password, expiry [unverified] |
| Pydio Cells | Go | MySQL+ | OIDC → JWT | Required | password, expiry, ACL-based |
| oCIS | Go | — | **OIDC required** | Embedded IdP | password, expiry, role |

---

## 2. Identity model — resolved: accounts + projects/teams

The historical framing weighed three options. Doc-Hub's compliance posture (audit, retention, legal hold, provenance) needs accountable identity — "who created version 7, who restored it, who put it under legal hold" — so the anonymous and single-admin-only options are insufficient. The model is **real accounts organised into workspaces**:

**(a) Anonymous share-links only.** *(rejected as the primary model)* No accounts, every document behind an unguessable URL. Kept only as the *sharing* surface (§5), never as the account model — a registry with no accountable actor can't audit anything.

**(b) Single-tenant self-host (one admin).** *(subsumed)* A solo self-hoster is served by a **personal locker = a workspace of one**. No separate code path — the same accounts/roles/workspace schema degenerates cleanly to one user.

**(c) Accounts + projects/teams.** *(chosen)* Real sign-in (local password and/or OIDC), workspaces with **Owner/Admin/Member** roles, magic-link invitations, atomic ownership transfer, per-workspace encryption keys. This is the actual product shape.
- **Pros:** accountable identity for the audit trail; teams and personal lockers share one model; per-workspace DEKs map naturally onto workspaces.
- **Cons/scope owned up front:** roles, invitations, and the workspace schema are Phase-0/1 scope, not deferred. Password reset/recovery and full multi-IdP federation remain later work.

The design goal is that the solo $5-VPS user and a compliance team run **the same code** — the team just has more members in the workspace.

---

## 3. Industry-standard secure implementation, per layer

### Password hashing — Argon2id

OWASP Password Storage Cheat Sheet (current): use **Argon2id**. Recommended profiles:

- `m = 47 MiB, t = 1, p = 1` *or*
- `m = 19 MiB, t = 2, p = 1` (minimum). ([cheatsheetseries.owasp.org][owasp-pw], [github.com][owasp-pw-md])

Some practitioners cite RFC 9106's bumped values (`m = 64 MiB, t = 3, p = 1`); see the open OWASP issue tracking that update. ([github.com][owasp-pw-rfc])

**Rust:** [`argon2`][crate-argon2] (pure Rust, RustCrypto). Use `Argon2::default()` then tune `Params`; salt via `OsRng`; never roll your own.

### Sessions — cookies, not JWT in `localStorage`

OWASP Session Management Cheat Sheet is explicit:

> "Do not store authentication tokens, session IDs, JWTs, refresh tokens, or any credential in `localStorage` or `sessionStorage`. Instead, use `HttpOnly; Secure; SameSite=Strict` cookies (preferred) or a Backend-for-Frontend (BFF) pattern."
> Recommended canonical form: `Set-Cookie: __Host-SID=<token>; path=/; Secure; HttpOnly; SameSite=Strict`. ([cheatsheetseries.owasp.org][owasp-sess])

**Rust:** [`tower-sessions`][crate-tower-sess] (storage-pluggable; SQLite/Postgres-backed store, Redis when scaled) + a ~30-line custom extractor. **Skip [`axum-login`][crate-axum-login] for v0** (00-synthesis tension #7): `tower-sessions` + the extractor is the dominant pattern; add axum-login only if friction emerges. Auto-invalidate sessions on password change by binding a `session_auth_hash` (derived from the password hash) into the session and checking it per request.

### OAuth / OIDC

- [`openidconnect`][crate-oidc] — the foundation crate, mirrors Go's `coreos/go-oidc` API surface.
- [`oauth2`][crate-oauth2] — lower-level OAuth 2.0 only.
- For Axum specifically, [`axum-oidc`][crate-axum-oidc] wraps `openidconnect` with extractors and a middleware layer. ([lib.rs][lib-axum-oidc])

When v0 doesn't need OIDC, **don't pull it in.** Keep the trait that backs `AuthnBackend` so it's a drop-in later.

### CSRF

OWASP CSRF Cheat Sheet:
- For stateful (cookie session) apps: **synchronizer-token pattern**.
- For stateless: **double-submit cookie**.
- **`SameSite=Strict` is defense in depth, not a substitute** — combine with a token. ([cheatsheetseries.owasp.org][owasp-csrf])

For the Doc-Hub SPA: **`SameSite=Lax`** on the session cookie (Strict would block the optional WOPI interop editor→Doc-Hub redirect) + a CSRF token bound to the session, sent via custom header (`X-CSRF-Token`) on mutating requests, plus an `Origin`/`Referer` check. Reject requests missing the header for any non-`GET`/`HEAD` cookie-auth route.

### Rate limiting

[`tower_governor`][crate-gov] — GCRA (Generic Cell Rate Algorithm), keys by peer IP or custom extractor, plays with Axum/Tonic/Hyper. Emits `x-ratelimit-after`, `retry-after` headers. Latest is 0.8.0. ([crates.io][crate-gov])

Apply to: `/login`, `/share/<id>` (per-IP), `POST /share-links` (per-user), `/password-reset` (per-email + per-IP).

### Magic links / password reset

OWASP Forgot Password Cheat Sheet + Auth Cheat Sheet baseline:
- Token = CSPRNG, sufficiently long (treat as session-token-grade entropy).
- TTL **≤ 1 h** for reset; magic-login articles suggest 15–30 min typical, 5–10 min ideal. ([cheatsheetseries.owasp.org][owasp-auth], [supertokens.com][magic-link])
- **Single-use:** invalidate on consumption.
- Rate-limit reset endpoint like a login endpoint (per-email and per-IP).
- Always return the same response whether the email exists or not (no account enumeration).

---

## 4. Editor access tokens — the primary path (and WOPI as optional interop)

Editing in Doc-Hub is **embedded**: the SPA hosts native Sheet/Docs/PDF/Markdown editors, the server decrypts document bytes in memory and streams them to the editor over the authenticated app origin, and save re-encrypts and appends a hash-chained version. The capability that gates that byte stream is the **editor access token** — decoupled from the session cookie exactly as WOPI's `access_token` was, and reused verbatim on the optional external-Office WOPI interop path.

Critical separation (the token is a capability, not user auth):

> "Access tokens should expire (become invalid) automatically after a period of time … `access_token_ttl` … Microsoft recommends … 10 hours." ([learn.microsoft.com][wopi-concepts])

In practice for Doc-Hub:

1. User opens a document in the SPA. The Doc-Hub validates their **session cookie** and their workspace role.
2. The app origin mints a **fresh, per-launch, per-document editor access token**: HMAC-SHA256 over `{user_id | "share:<id>", file_id, perms, exp, jti}`. It is **not** the session cookie and must not be reusable across documents.
3. The embedded editor presents the token on every byte-stream call. The server validates it, checks `(URL file_id) == (token file_id)` and `(required perms) ⊆ (granted)` (view-only blocks save), decrypts, and streams bytes.
4. Save re-encrypts, appends a new hash-chained version, writes an audit event, and enqueues reindex. Token is per-launch — close-and-reopen mints a new one; revocation is by short TTL.

This decoupling is what lets a share-link viewer (no account) open a document read-only: they get a token scoped `read` with a shorter TTL, and the editor never needs to know whether a session user or a share consumer opened it.

**Optional WOPI interop.** For operators who want to open documents in external Office clients, the same token shape drives a WOPI host module. There, **proof keys** (`X-WOPI-Proof`) are a separate defence — the client signs requests with a key whose public half is in `/hosting/discovery`; the host verifies ([collaboraonline.com][cool-sec], [learn.microsoft.com][wopi-proof]). Proof-key validation is only required when federating to MS365; for the embedded-editor primary path it is not used.

---

## 5. Share-links done right

Cribbing from Nextcloud's share UI ([docs.nextcloud.com][nc-share]) and Seafile's API ([plus.seafile.com][sf-api]):

- **Token:** 128 random bits from a CSPRNG, base64url-encoded (22 chars). **Do not use UUIDv4** — it carries only 122 bits of entropy (6 are fixed for variant/version), which is below the NIST SP 800-90A bar. ([neilmadden.blog][nm-uuid])
- **Optional password:** stored Argon2id-hashed, same params as user passwords. Enforce a minimum length (Seafile defaults to admin-set, Nextcloud has a "force password" policy).
- **Expiry:** default ON with a sane default (7 d). Admin can enforce a maximum. Expiration evaluated server-side from a `expires_at TIMESTAMPTZ` column.
- **Permissions:** a small enum — `view`, `view_download` (documents only; no `file_drop`/write-back into someone else's hub, which would violate accountable authorship). Anything view-grade mints a per-launch editor access token scoped `read`; there is no share-grade write path.
- **Isolation:** share bytes serve on the **user-content origin** via `/raw/{token}` (sandbox CSP, `attachment` for non-previewable types, no cookies), never on the app origin.
- **Revocation:** a row in `share_links`; delete row → 404. Track `created_at`, `last_accessed_at`, `access_count` for the owner's "shared by me" UI.
- **No enumeration:** never disclose whether a token doesn't exist vs is wrong-password — return the same "Enter password" / 404 page either way.

---

## 6. Stable URL contract

A registry's URLs **are** its contract. Get the IDs stable on day one so the audit trail and share links stay valid forever.

- **Stable URL shape:**
  - Document open (embedded editor): `/api/files/<file_id>/edit` (auth-gated; mints a per-launch editor access token, not a URL the user sees).
  - Public share bytes: `/raw/<share_token>` on the **user-content origin** (never auth-gated; always 128-bit random).
  - Optional WOPI interop bootstrap: `/wopi/files/<file_id>?access_token=...` (only when the interop path is enabled).
- **Scaling a workspace from one to many:** the account/role/workspace schema exists from Phase 0, so adding members is data, not a migration — a `user_id`/`workspace_id` FK is already on `files` and `share_links`. OIDC (§3, brief 12) slots in as config. Share-link URLs are unaffected because they're row-keyed, not user-keyed.

The hard mistakes to avoid:
- Encoding the user in the document URL (`/u/sachin/files/123`) — locks the namespace to one identity model forever.
- Reusing an editor access token or WOPI `access_token` as a session token. Don't.
- Making share-tokens guessable now ("we'll regenerate them in v1") — you won't, and the old ones live forever in chat history and audit logs.

---

## 7. Recommendation

**Real accounts with projects/teams, from Phase 0 — a solo user is just a workspace of one.**

Why:
- **Accountable identity for compliance** — audit, retention, legal hold, and provenance all name an actor. Anonymous or single-admin-only models can't attribute "who restored version 7."
- **One model, two audiences** — the $5-VPS solo user (personal locker = workspace of one) and a team (workspace with Owner/Admin/Member) run the same code. No schema fork later.
- **Per-workspace encryption maps naturally** — each workspace owns a DEK (`dochub-crypto`); adding members shares the workspace, not the key material in plaintext.
- **Preserves the share UX** — `/raw/<token>` on the user-content origin works without a session; the editor handoff stays decoupled via the editor access token.
- **Stays $5-VPS-shaped** — no external IdP required (OIDC optional), SQLite default, single Rust binary.

### Concrete stack

| Concern | Choice |
|---|---|
| Password hash | `argon2` crate, `Params::new(19456, 2, 1, None)` (OWASP minimum) |
| Session store | `tower-sessions`, SQLite/Postgres-backed (Redis when scaled); **no `axum-login`** |
| Cookie | `__Host-dochub_sid=...; Path=/; Secure; HttpOnly; SameSite=Lax` |
| CSRF | session-bound token; required `X-CSRF-Token` header + Origin check on non-GET cookie-auth routes |
| Rate limit | `tower_governor` on `/login` (10/min/IP), `/raw/*` (60/min/IP), upload (30/min/IP) |
| Editor access tokens | HMAC-SHA256 over `{user_id\|"share:<id>", file_id, perms, exp, jti}`, ~10 min TTL, key in `DOCHUB_EDITOR_HMAC_SECRET` |
| Signed share URLs | HMAC-SHA256 over `{key, exp, method}`, `DOCHUB_SIGNED_URL_HMAC_SECRET`, 5 min TTL, constant-time verify |
| Share-links | 128-bit token, optional Argon2id-hashed password, default 7 d expiry, `view`/`view_download` |
| Roles | Owner / Admin / Member per workspace; magic-link invitations; atomic ownership transfer |
| OIDC | Authorization Code + PKCE via `openidconnect` (brief 12); sessions stay Doc-Hub-side |
| WOPI | **optional interop only** — same token shape; proof-keys only if federating to MS365 |

The single decision that makes this work: **editor access tokens are minted per launch from whatever identity opened the document** — a session user *or* a share-link consumer. Both flows produce the same token shape, so the embedded editor (and the optional WOPI host) never needs to know which one it is.

Env seed for the first admin (bootstrap of the first workspace): `DOCHUB_ADMIN_USER`, `DOCHUB_ADMIN_PASSWORD_HASH`.

---

## Sources

- Nextcloud — OIDC: <https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_oidc.html>
- Nextcloud — LDAP: <https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_ldap.html>
- Nextcloud — File sharing admin: <https://docs.nextcloud.com/server/23/admin_manual/configuration_files/file_sharing_configuration.html>
- Nextcloud — File sharing user manual: <https://docs.nextcloud.com/server/31/user_manual/en/files/sharing.html>
- Nextcloud — System requirements: <https://docs.nextcloud.com/server/stable/admin_manual/installation/system_requirements.html>
- Seafile — LDAP (CE): <https://manual.seafile.com/latest/config/ldap_in_ce/>
- Seafile — OAuth: <https://manual.seafile.com/11.0/deploy/oauth/>
- Seafile — Shibboleth: <https://manual.seafile.com/12.0/config/shibboleth_authentication/>
- Seafile — Share links API: <https://plus.seafile.com/published/web-api/v2.1/share-links.md>
- Seafile — seahub_settings: <https://haiwen.github.io/seafile-admin-docs/12.0/config/seahub_settings_py/>
- Filerun — Authentication integration: <https://docs.filerun.com/authentication_integration>
- Filerun — SimpleSAMLphp: <https://docs.filerun.com/simplesamlphp>
- Filerun — PHP requirements: <https://docs.filerun.com/php_configuration>
- Pydio — Authentication: <https://docs.pydio.com/latest/developer-guide/introduction/authentication/>
- Pydio — Cells as IdP: <https://docs.pydio.com/latest/admin-guide/connect-your-users/single-sign-on-features/cells-as-identity-provider/>
- Pydio — Cells requirements: <https://pydio.com/en/docs/cells/v4/requirements>
- oCIS — Project page: <https://owncloud.dev/ocis/>
- oCIS — IDP service: <https://owncloud.dev/services/idp/>
- oCIS — IDP service config: <https://doc.owncloud.com/ocis/next/deployment/services/s-list/idp.html>
- oCIS — README / build: <https://github.com/owncloud/ocis/blob/master/README.md>
- OWASP — Password Storage: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- OWASP — Password Storage (md): <https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md>
- OWASP — Password Storage RFC 9106 issue: <https://github.com/OWASP/CheatSheetSeries/issues/1183>
- OWASP — Session Management: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP — Authentication: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP — Forgot Password: <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- OWASP — CSRF Prevention: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- crates.io — `argon2`: <https://crates.io/crates/argon2>
- crates.io — `axum-login`: <https://crates.io/crates/axum-login>
- crates.io — `axum-oidc`: <https://crates.io/crates/axum-oidc>
- lib.rs — `axum-oidc`: <https://lib.rs/crates/axum-oidc>
- crates.io — `tower_governor`: <https://crates.io/crates/tower_governor>
- GitHub — `tower-governor`: <https://github.com/benwis/tower-governor>
- Microsoft Learn — WOPI CheckFileInfo: <https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo>
- Microsoft Learn — WOPI key concepts: <https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts>
- Microsoft Learn — WOPI proof keys: <https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proofkeys>
- Collabora — Security: <https://www.collaboraonline.com/security/>
- SuperTokens — Magic links: <https://supertokens.com/blog/magiclinks>
- Neil Madden — Moving away from UUIDs (entropy): <https://neilmadden.blog/2018/08/30/moving-away-from-uuids/>

<!-- link reference definitions used by shorthand citations above -->
[nc-oidc]: https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_oidc.html
[nc-ldap]: https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_ldap.html
[nc-share]: https://docs.nextcloud.com/server/23/admin_manual/configuration_files/file_sharing_configuration.html
[nc-sys]: https://docs.nextcloud.com/server/stable/admin_manual/installation/system_requirements.html
[sf-ldap-ce]: https://manual.seafile.com/latest/config/ldap_in_ce/
[sf-oauth]: https://manual.seafile.com/11.0/deploy/oauth/
[sf-shib]: https://manual.seafile.com/12.0/config/shibboleth_authentication/
[sf-api]: https://plus.seafile.com/published/web-api/v2.1/share-links.md
[sf-seahub]: https://haiwen.github.io/seafile-admin-docs/12.0/config/seahub_settings_py/
[fr-auth]: https://docs.filerun.com/authentication_integration
[fr-saml]: https://docs.filerun.com/simplesamlphp
[fr-php]: https://docs.filerun.com/php_configuration
[pyd-auth]: https://docs.pydio.com/latest/developer-guide/introduction/authentication/
[pyd-idp]: https://docs.pydio.com/latest/admin-guide/connect-your-users/single-sign-on-features/cells-as-identity-provider/
[pyd-req]: https://pydio.com/en/docs/cells/v4/requirements
[ocis-idp]: https://owncloud.dev/services/idp/
[ocis-idp-doc]: https://doc.owncloud.com/ocis/next/deployment/services/s-list/idp.html
[ocis-readme]: https://github.com/owncloud/ocis/blob/master/README.md
[owasp-pw]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[owasp-pw-md]: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md
[owasp-pw-rfc]: https://github.com/OWASP/CheatSheetSeries/issues/1183
[owasp-sess]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
[owasp-auth]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
[owasp-csrf]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
[crate-argon2]: https://crates.io/crates/argon2
[crate-tower-sess]: https://crates.io/crates/tower-sessions
[crate-axum-login]: https://crates.io/crates/axum-login
[crate-oidc]: https://crates.io/crates/openidconnect
[crate-oauth2]: https://crates.io/crates/oauth2
[crate-axum-oidc]: https://crates.io/crates/axum-oidc
[lib-axum-oidc]: https://lib.rs/crates/axum-oidc
[crate-gov]: https://crates.io/crates/tower_governor
[wopi-cfi]: https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/files/checkfileinfo
[wopi-concepts]: https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts
[wopi-proof]: https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proofkeys
[cool-sec]: https://www.collaboraonline.com/security/
[magic-link]: https://supertokens.com/blog/magiclinks
[nm-uuid]: https://neilmadden.blog/2018/08/30/moving-away-from-uuids/
[plus.seafile.com]: https://plus.seafile.com/published/web-api/v2.1/share-links.md
[manual.seafile.com]: https://manual.seafile.com/latest/config/ldap_in_ce/
[docs.nextcloud.com]: https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_auth_oidc.html
[docs.filerun.com]: https://docs.filerun.com/authentication_integration
[docs.pydio.com]: https://docs.pydio.com/latest/developer-guide/introduction/authentication/
[pydio.com]: https://pydio.com/en/docs/cells/v4/requirements
[owncloud.dev]: https://owncloud.dev/services/idp/
[doc.owncloud.com]: https://doc.owncloud.com/ocis/next/deployment/services/s-list/idp.html
[cheatsheetseries.owasp.org]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[github.com]: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md
[supertokens.com]: https://supertokens.com/blog/magiclinks
[neilmadden.blog]: https://neilmadden.blog/2018/08/30/moving-away-from-uuids/
[collaboraonline.com]: https://www.collaboraonline.com/security/
[lib.rs]: https://lib.rs/crates/axum-oidc
[learn.microsoft.com]: https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts
[crates.io]: https://crates.io/crates/tower_governor
