# 11 — Admin dashboard

Companion to `02-surface.md`. Aimed at the instance operator (the `is_admin` user). Read-only system panels ship first; the compliance controls — key management, retention/legal-hold, audit export — are the hub's admin reason-to-exist and are specified here as first-class, not deferred.

## Pattern reference

**Linear / Vercel / Posthog** workspace-admin pages: a single scrollable page of stat-rich cards, each a self-contained reading of one system aspect. No nested navigation — an admin debugging an incident or a compliance review wants every datapoint visible at once. Compliance actions (rotate a key, place a hold, export a report) open a focused dialog from their card rather than a separate route.

## Layout

```
┌─ Admin (centered pane, 920 px max, scrolls vertically) ────────────────┐
│                                                                         │
│   # Admin                                                               │
│   How this Doc-Hub instance is configured, keyed, and governed.           │
│   ──────────────────────────────────────────────────────────           │
│                                                                         │
│   ┌─ System ──────────────────────────────────────────────────────┐   │
│   │   Status     ● Healthy            Uptime         3d 6h 24m   │   │
│   │   Version    0.0.1 · sha 3f5b74f  Built          Jul 5 00:23 │   │
│   │   Storage    Fs (/var/lib/hub)  Database       SQLite       │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Encryption & keys ───────────────────────────────────────────┐   │
│   │   Master key   KMS (aws-kms) · reachable                       │   │
│   │   Workspace DEKs   14 wrapped · 0 unwrapped-at-rest            │   │
│   │   Last rotation    KEK rotated 12 days ago                     │   │
│   │                          [ Rotate master key ]  [ Re-wrap DEKs ]│   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Integrity ───────────────────────────────────────────────────┐   │
│   │   Version chains   1 284 documents · all verified              │   │
│   │   Audit chain      ● intact through seq 40 912                  │   │
│   │   Last full verify  6h ago                    [ Verify now → ] │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Retention & legal hold ──────────────────────────────────────┐   │
│   │   Policies   3 active   ·   Held documents   7                 │   │
│   │   Pending tombstones (past retention, awaiting purge)  12      │   │
│   │        [ Manage policies ]  [ Manage holds ]  [ Review purges ]│   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Audit log ───────────────────────────────────────────────────┐   │
│   │   40 912 events · append-only · hash-chained                   │   │
│   │   Range  [ Jan 1 ]—[ Jul 6 ]   Format ( JSONL · CSV · PDF )    │   │
│   │                                     [ Export signed report → ] │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Recent sign-ins ─────────────────────────────────────────────┐   │
│   │   admin            ●  14:32   today                            │   │
│   │   (failed) owner   ✗  09:11   today             [ Audit log → ]│   │
│   └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Each card uses the same `--card` surface + `--line` border + 16 px radius as Settings.
- Stat rows are two-column at desktop (≥640 px), single column on narrow. Tabular-nums for numeric values; muted labels above, ink values below.
- "Status" pill: `● Healthy` in `--success`; `● Degraded` in `--warning` when storage, db, **or the KMS/master key** is unreachable.
- The **Integrity** card's audit/chain pill turns `--danger` on any `verify_chain` failure and links straight to the affected document's version history (`18-version-history-surface.md`). A tamper alarm is never auto-cleared.

## Key management (Encryption & keys card)

- **Master key.** Shows the source (`DOCHUB_MASTER_KEY` env or a KMS provider) and reachability. Keys are never rendered, never in responses, never logged.
- **Rotate master key** → dialog. Rotation **re-wraps every workspace DEK under the new KEK without rewriting document blobs** (per ARCHITECTURE.md). The dialog states this plainly: "Rotating re-wraps 14 data keys. Documents are not re-encrypted and stay readable throughout." Runs as a tracked job; emits `key.kek_rotated`.
- **Re-wrap DEKs** → forces a re-wrap pass (e.g. after a KMS key-version bump) without a KEK change.
- **Per-workspace re-key** (explicit, heavier) lives under the workspace's own storage settings, not here, because it *does* rewrite that workspace's blobs.
- Invariant surfaced: `0 unwrapped-at-rest` must always read zero; a non-zero value is an error state rendered in `--danger`.

## Retention & legal hold (Retention & legal hold card)

- **Manage policies** → a table of retention policies (scope: project or document type; minimum-retain and/or auto-tombstone-after durations). Create / edit / disable. A policy never authorises erasure of bytes under an active hold.
- **Manage holds** → place or release a **legal hold** on a project, folder, or document. While held, no path can tombstone or purge the target (enforced server-side and property-tested — `TESTING.md` invariant 6). Releasing a hold is itself an audited, chained event.
- **Review purges** → documents past retention and eligible for byte-purge. Purge is the only path that removes bytes, is admin-confirmed, refuses anything under hold, and appends a tombstone + audit row (the version metadata and hash-chain links are retained; only the blob is dropped). Nothing here can rewrite history.
- Every action here emits `retention.*` / `legal_hold.*` audit events.

## Audit export (Audit log card)

- The `audit_log` is append-only and hash-chained; committed rows are never updated or deleted.
- **Export signed report** → dialog: date range + format (JSONL / CSV / PDF). The export is accompanied by the chain head and an **Ed25519 signature over the exported range**, so a recipient can verify offline that the report is complete and untampered (maps to `TESTING.md` UC-8: "export report verifies against the chain"). The dialog shows the covered event count and the head hash before download.
- Scope filters: actor, action prefix (`document.*`, `share.*`, `key.*`, `legal_hold.*`), project, target document.

## Backend contract

### `GET /api/admin/system` (authed + admin-only)

```json
{
  "version": "0.0.1",
  "git_sha": "3f5b74f",
  "built_at": "2026-07-05T00:23:00Z",
  "license": "Apache-2.0",
  "storage_backend": "Fs",
  "storage_config": { "fs_root": "/var/lib/hub", "s3_bucket": null },
  "db_backend": "Sqlite",
  "uptime_seconds": 281064,
  "master_key": { "source": "kms", "provider": "aws-kms", "reachable": true },
  "keys": { "wrapped_deks": 14, "unwrapped_at_rest": 0, "last_kek_rotation": "2026-06-24T00:00:00Z" },
  "integrity": { "documents": 1284, "chains_verified": true, "audit_head_seq": 40912, "last_full_verify": "2026-07-06T08:30:00Z" },
  "retention": { "active_policies": 3, "held_documents": 7, "pending_purges": 12 },
  "audit": { "event_count": 40912, "chain_intact": true },
  "healthy": true,
  "recent_sign_ins": [
    { "actor_username": "admin", "ok": true,  "at": "2026-07-06T14:32:11Z" },
    { "actor_username": "owner", "ok": false, "at": "2026-07-06T09:11:09Z" }
  ]
}
```

- **401** if no session; **403** if the caller isn't `is_admin`.
- Never returns key material — only source, reachability, and counts.

### Action endpoints (authed + admin-only, all audited)

| Method | Path | Effect |
|---|---|---|
| `POST` | `/api/admin/keys/rotate` | Rotate KEK, re-wrap all DEKs; blobs untouched. |
| `POST` | `/api/admin/keys/rewrap` | Re-wrap DEKs without a KEK change. |
| `POST` | `/api/admin/integrity/verify` | Kick a full `verify_chain` sweep; returns a job id. |
| `GET/POST/PATCH` | `/api/admin/retention/policies` | List / create / edit retention policies. |
| `POST/DELETE` | `/api/admin/holds` | Place / release a legal hold. |
| `GET` | `/api/admin/purges` | List purge-eligible (past-retention, not-held) documents. |
| `POST` | `/api/admin/audit/export` | Date range + format → signed report (chain head + Ed25519 sig). |

## State checklist

| | Required | Notes |
|---|---|---|
| Default (loaded) | yes | every card filled |
| Loading | yes | skeleton rows replace stat values; borders kept |
| Forbidden (non-admin) | yes | polished "Admin access required" notice, not an empty page |
| Error | yes | inline aria-live band above the affected card |
| Degraded | yes | Status pill → warning; a one-line "Storage, database, or key service is reporting trouble" hint |
| Integrity failure | yes | Integrity pill → danger, deep-links the affected document's history; never auto-cleared |
| Key invariant broken | yes | `unwrapped_at_rest > 0` renders in danger with a "keys are not fully wrapped" alarm |

## Out of scope (v0)

- Per-device session list + per-device revoke (needs IP + user-agent columns).
- Live metrics / charts — later, with a real `/metrics` endpoint.
- Transparency-log anchoring of chain heads to a third party — compliance-phase extension of the export flow.
