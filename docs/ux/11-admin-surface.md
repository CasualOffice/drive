# 11 — Admin dashboard

Companion to `02-surface-v2.md`. Closes pipeline §11. Aimed at the instance operator (the `is_admin` user) — read-only in v0; the toggles + actions land in v0.2 alongside the OpenSearch / Redis / ClamAV plumbing.

## Pattern reference

**Linear / Vercel / Posthog** workspace-admin pages: a single scrollable page of stat-rich cards, every card a self-contained reading of one system aspect. No nested navigation — that's a Settings ergonomic, not an admin one. An admin who's debugging an incident wants every datapoint visible at once.

## Layout

```
┌─ Admin (centered pane, 920 px max, scrolls vertically) ────────────────┐
│                                                                         │
│   # Admin                                                               │
│   Read-only view of how this Drive instance is configured.              │
│   ──────────────────────────────────────────────────────────           │
│                                                                         │
│   ┌─ System ──────────────────────────────────────────────────────┐   │
│   │   Status     ● Healthy            Uptime         3d 6h 24m   │   │
│   │   Version    0.0.1 · sha 3f5b74f  Built          Jun 7 00:23 │   │
│   │   Storage    Fs (/var/lib/drive)  Database       SQLite       │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Sessions ────────────────────────────────────────────────────┐   │
│   │   Active sessions:  3                                          │   │
│   │   Per-device list ships in v0.2.                               │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Recent sign-ins ─────────────────────────────────────────────┐   │
│   │   admin            ●  14:32   today                            │   │
│   │   (failed) owner   ✗  09:11   today                            │   │
│   │   admin            ●  18:11   yesterday                        │   │
│   │                                            [ Open audit log → ]│   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Search & cache ──────────────────────────────────────────────┐   │
│   │  [ Coming in v0.2 ]                                            │   │
│   │  OpenSearch + Redis dashboards land when the optional infra is │   │
│   │  enabled via env. Both are opt-in per project_drive_optional…  │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─ Anti-virus ──────────────────────────────────────────────────┐   │
│   │  [ Coming in v0.2 ]                                            │   │
│   │  Sandboxed ClamAV scanner on upload, optional, with a one-click │   │
│   │  toggle here.                                                   │   │
│   └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Each card uses the same `--card` surface + `--line` border + 16 px radius as Settings (`03-settings-surface.md`).
- Stat rows are two-column at desktop (≥640 px), single column on narrow. Tabular-nums for numeric values; muted labels above; ink-coloured values below.
- "Status" pill: `● Healthy` in `--success`; `● Degraded` in `--warning` when storage or db is unreachable (the endpoint returns the unhealthy flag).
- ComingSoon cards reuse the existing component with a smaller header — bullets enumerate what lands when the optional infra is enabled.

## Backend contract

### `GET /api/admin/system` (authed + admin-only)

```json
{
  "version": "0.0.1",
  "git_sha": "3f5b74f",
  "built_at": "2026-06-07T00:23:00Z",
  "license": "Apache-2.0",
  "storage_backend": "Fs",
  "storage_config": {
    "fs_root": "/var/lib/drive",
    "s3_bucket": null,
    "s3_endpoint": null,
    "s3_region": null
  },
  "db_backend": "Sqlite",
  "uptime_seconds": 281064,
  "active_sessions": 3,
  "healthy": true,
  "recent_sign_ins": [
    { "actor_username": "admin", "ok": true,  "at": "2026-06-07T14:32:11Z" },
    { "actor_username": "owner", "ok": false, "at": "2026-06-07T09:11:09Z" },
    { "actor_username": "admin", "ok": true,  "at": "2026-06-06T18:11:32Z" }
  ]
}
```

- **401** if no session.
- **403** if the caller isn't `is_admin`.
- `recent_sign_ins` is read from `audit_log` — at most 10 entries, mixing `auth.sign_in` (ok=true) and `auth.sign_in_failed` (ok=false) chronologically.

## State checklist

| | Required | Notes |
|---|---|---|
| Default (loaded) | yes | every card filled in |
| Loading | yes | skeleton rows replace stat values; cards keep their borders |
| Forbidden (non-admin) | yes | renders a polished "Admin access required" notice instead of an empty page |
| Error | yes | inline aria-live band above the affected card |
| Degraded | yes | Status pill switches to warning + a one-line "Storage or database is reporting trouble" hint |

## Out of scope (v0)

- Per-device session list + per-device revoke (P2 — needs IP + user-agent on the sessions table, both v0.2 columns).
- Actionable toggles (anti-virus on/off, cache flush, reindex) — all v0.2.
- Live metrics / charts — Phase 2 with a real /metrics endpoint.
