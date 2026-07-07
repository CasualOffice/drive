//! `drive` — the Casual Drive binary entry point.

#![forbid(unsafe_code)]

use std::sync::Arc;

use dochub_auth::AuthState;
use dochub_core::Config;
use dochub_db::{Db, DbError, NewUser, UserRepo, WorkspaceKeysRepo};
use dochub_http::{access_log, presence::PresenceHub, router, HttpState};
use dochub_storage::{parse_master_key_hex, Storage};
use dochub_wopi::WopiState;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    // Offline subcommand — needs no config, DB, or network, so it runs before
    // `Config::from_env` (which would demand a master KEK etc.). Verifies a
    // provenance manifest's Ed25519 signature + hash chain from a file on disk.
    if std::env::args().nth(1).as_deref() == Some("verify-provenance") {
        let path = std::env::args().nth(2).ok_or_else(|| {
            anyhow::anyhow!("usage: dochub verify-provenance <path-to-manifest.json>")
        })?;
        return run_verify_provenance(&path);
    }

    let cfg = Config::from_env()?;

    // Admin subcommands run to completion and exit — they never start the HTTP
    // server. `rotate-kek` is CLI/admin only by design (no HTTP endpoint): a
    // master-key rotation is an operator action, not a request.
    if let Some(cmd) = std::env::args().nth(1) {
        return match cmd.as_str() {
            "rotate-kek" => run_rotate_kek(&cfg).await,
            other => Err(anyhow::anyhow!(
                "unknown subcommand: {other} (known: rotate-kek, verify-provenance)"
            )),
        };
    }

    let bind = cfg.bind;
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        app_origin = %cfg.app_origin,
        usercontent_origin = %cfg.usercontent_origin,
        backend = ?cfg.backend,
        db_url_scheme = %cfg.db_url.split(':').next().unwrap_or("?"),
        is_prod = cfg.is_prod,
        "starting Casual Drive",
    );

    let db = Db::connect(&cfg.db_url).await?;
    tracing::info!(backend = ?db.backend(), "metadata db connected, migrations applied");

    seed_admin_if_missing(&db, &cfg).await?;

    let storage = Storage::from_config(&cfg)?;

    let cookie_secure = cfg.app_origin.scheme() == "https";
    let auth = AuthState::new(db.clone(), cookie_secure, time::Duration::hours(24))
        .with_password_auth(cfg.allow_password_auth);

    // BYO storage master key. Optional in v0 — workspaces with BYO can't be
    // configured without it, but the rest of the app runs fine. The /api
    // handler that saves a BYO config refuses with 503 if the key is absent.
    let storage_secret_key = match std::env::var("DOCHUB_STORAGE_SECRET_KEY") {
        Ok(hex) => {
            Some(Arc::new(parse_master_key_hex(&hex).map_err(|e| {
                anyhow::anyhow!("DOCHUB_STORAGE_SECRET_KEY: {e}")
            })?))
        }
        Err(_) => {
            if cfg.is_prod {
                tracing::warn!(
                    "DOCHUB_STORAGE_SECRET_KEY not set — bring-your-own storage \
                     will be rejected. Generate with `openssl rand -hex 32`."
                );
            }
            None
        }
    };

    let registry = HttpState::default_registry(storage.clone(), cfg.signed_url_hmac_secret);
    // RT1 — start the presence hub + its expiration sweep task. The
    // hub is shared across handlers via `HttpState::presence`; the
    // background task ticks every 5 s and drops entries idle for
    // longer than 60 s. SSE stream + audit broadcast follow in 1b.
    let presence = PresenceHub::new();
    let _presence_sweep = presence.spawn_sweep();

    let state = HttpState {
        storage,
        wopi: WopiState::new(),
        db,
        auth,
        jwt_secret: Arc::new(cfg.wopi_hmac_secret),
        config: Arc::new(cfg),
        upload_limiter: HttpState::default_upload_limiter(),
        registry,
        storage_secret_key,
        presence,
    };

    // OB1 — structured access log per request. Replaces tower-http's
    // default TraceLayer (which span-wrapped requests but never emitted
    // redacted, JSON-shaped events for log aggregation). Mounted
    // outermost so its timing covers every middleware below.
    let app = router(state).layer(axum::middleware::from_fn(access_log));

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(addr = %bind, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}

/// `rotate-kek` — lossless master-KEK rotation (P1.1). Re-wraps every
/// per-workspace DEK from the current master KEK (`DOCHUB_MASTER_KEY`) to the
/// next one (`DOCHUB_MASTER_KEY_NEXT`) without touching a single document blob.
///
/// Only runs when the next key is configured. Prints a report and exits
/// non-zero if any workspace failed to rotate, so an operator's automation can
/// gate the key cut-over on a clean run.
async fn run_rotate_kek(cfg: &Config) -> anyhow::Result<()> {
    let Some(next) = cfg.master_kek_next.as_ref() else {
        anyhow::bail!(
            "rotate-kek requires DOCHUB_MASTER_KEY_NEXT (base64 32-byte KEK) — nothing to rotate to"
        );
    };

    let db = Db::connect(&cfg.db_url).await?;
    tracing::info!(backend = ?db.backend(), "metadata db connected for KEK rotation");

    let report = WorkspaceKeysRepo::new(&db)
        .rewrap_all(cfg.master_kek.as_ref(), next.as_ref())
        .await;

    tracing::info!(
        rotated = report.rotated,
        failed = report.failed.len(),
        "KEK rotation complete",
    );
    println!(
        "rotate-kek: re-wrapped {} workspace DEK(s); {} failed",
        report.rotated,
        report.failed.len(),
    );
    for ws in &report.failed {
        println!("  failed: {ws}");
    }

    if report.is_clean() {
        println!("rotate-kek: done — every workspace DEK is now sealed under the next KEK.");
        println!("Promote DOCHUB_MASTER_KEY_NEXT to DOCHUB_MASTER_KEY and unset the next key.");
        Ok(())
    } else {
        anyhow::bail!(
            "{} workspace(s) failed to rotate — old KEK left in place for them",
            report.failed.len()
        )
    }
}

/// `verify-provenance <path>` — offline verification of a signed provenance
/// manifest (P1.4). Reads the JSON file, re-verifies the Ed25519 signature over
/// the canonical serialization AND re-walks the hash chain (each `prev_hash`
/// equals the previous link's `content_hash`, head matches the last link).
/// Needs no config, DB, or network. Prints `OK`/`FAIL` and exits non-zero on
/// any failure so automation can gate on the result.
fn run_verify_provenance(path: &str) -> anyhow::Result<()> {
    let bytes =
        std::fs::read(path).map_err(|e| anyhow::anyhow!("cannot read manifest {path}: {e}"))?;
    let signed: dochub_crypto::provenance::SignedProvenance = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("{path} is not a valid provenance manifest: {e}"))?;

    match dochub_crypto::provenance::verify_signed(&signed) {
        Ok(()) => {
            let m = &signed.manifest;
            println!(
                "OK: provenance for file {} verified — signature valid, {} version(s) chain intact, head {}",
                m.file_id,
                m.chain.len(),
                m.head.as_deref().unwrap_or("(none)"),
            );
            Ok(())
        }
        Err(e) => {
            eprintln!("FAIL: provenance verification failed: {e}");
            std::process::exit(1);
        }
    }
}

/// Seed the admin user from env if no row matches the configured username.
/// The env carries an already-hashed Argon2id PHC string — we don't accept
/// raw passwords here.
async fn seed_admin_if_missing(db: &Db, cfg: &Config) -> Result<(), DbError> {
    let users = UserRepo::new(db);
    match users.find_by_username(&cfg.admin_user).await {
        Ok(_) => {
            tracing::info!(username = %cfg.admin_user, "admin user present in DB, skipping seed");
            Ok(())
        }
        Err(DbError::NotFound) => {
            users
                .insert(&NewUser {
                    username: cfg.admin_user.clone(),
                    password_hash: cfg.admin_password_hash.clone(),
                    is_admin: true,
                })
                .await?;
            tracing::info!(username = %cfg.admin_user, "admin user seeded from env");
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// `DOCHUB_LOG_FORMAT=json` ships one JSON object per line (for fluent /
/// Loki / Vector / Datadog), `text` keeps the human-readable dev layout
/// (default in non-prod). Production deploys default to `json` so
/// operators get parseable access logs out of the box.
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,dochub=debug,dochub_http::access=info".into());
    let is_prod = matches!(
        std::env::var("DOCHUB_PROD").as_deref(),
        Ok("1" | "true" | "yes" | "on"),
    );
    let format = std::env::var("DOCHUB_LOG_FORMAT").unwrap_or_else(|_| {
        if is_prod {
            "json".into()
        } else {
            "text".into()
        }
    });

    let registry = tracing_subscriber::registry().with(filter);
    if format == "json" {
        registry
            .with(
                fmt::layer()
                    .json()
                    .with_current_span(false)
                    .with_span_list(false),
            )
            .init();
    } else {
        registry.with(fmt::layer()).init();
    }
}
