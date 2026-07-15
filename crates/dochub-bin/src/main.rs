//! `dochub` — the Doc-Hub binary entry point.

#![forbid(unsafe_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use dochub_auth::AuthState;
use dochub_core::Config;
use dochub_db::{Db, DbError, NewUser, UserRepo, WorkspaceKeysRepo};
use dochub_http::{access_log, presence::PresenceHub, router, HttpState};
use dochub_storage::{parse_master_key_hex, Storage};
use dochub_wopi::WopiState;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Config-free meta flags (`--version`, `--help`) print to stdout and exit.
    // Handled before `init_tracing`/`Config::from_env` so they work on a bare
    // image with no env set (e.g. `docker run casualoffice/dochub --version`).
    if let Some(out) = meta_arg_output(std::env::args().nth(1).as_deref()) {
        println!("{out}");
        return Ok(());
    }

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

    // Offline audit-export verification — same rationale: no config/DB/network.
    if std::env::args().nth(1).as_deref() == Some("verify-audit") {
        let path = std::env::args().nth(2).ok_or_else(|| {
            anyhow::anyhow!("usage: dochub verify-audit <path-to-audit-export.json>")
        })?;
        return run_verify_audit(&path);
    }

    // Container HEALTHCHECK — probe the local `/healthz` and exit 0/1 without
    // needing curl in the runtime image. Reads only DOCHUB_BIND (port) and
    // DOCHUB_APP_ORIGIN (Host header), so it runs before `Config::from_env`.
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        return run_healthcheck();
    }

    let cfg = Config::from_env()?;

    // Admin subcommands run to completion and exit — they never start the HTTP
    // server. `rotate-kek` is CLI/admin only by design (no HTTP endpoint): a
    // master-key rotation is an operator action, not a request.
    if let Some(cmd) = std::env::args().nth(1) {
        return match cmd.as_str() {
            "rotate-kek" => run_rotate_kek(&cfg).await,
            other => Err(anyhow::anyhow!(
                "unknown subcommand: {other} (known: rotate-kek, verify-provenance, verify-audit, healthcheck)"
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
        "starting Doc-Hub",
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

    // Background content indexer — drains the durable job queue, running an
    // `index_file` job (decrypt head, extract text, upsert into the content
    // index) off the request path for every committed version. The lazy
    // reindex on `/api/search/content` remains as an idempotent backstop.
    let _indexer = dochub_http::spawn_indexer(state.clone());

    // OB1 — structured access log per request. Replaces tower-http's
    // default TraceLayer (which span-wrapped requests but never emitted
    // redacted, JSON-shaped events for log aggregation). Mounted
    // outermost so its timing covers every middleware below.
    let app = router(state).layer(axum::middleware::from_fn(access_log));

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(addr = %bind, "listening");
    // Graceful shutdown: on SIGTERM (rolling deploy / `docker stop`) or SIGINT
    // (Ctrl-C), stop accepting new connections and let in-flight requests finish
    // instead of cutting them mid-flight.
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("shutdown complete");
    Ok(())
}

/// Resolves when the process is asked to terminate — SIGINT (Ctrl-C) or, on
/// Unix, SIGTERM (the signal orchestrators and `docker stop` send).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                tracing::warn!(error = %e, "could not install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => tracing::info!("SIGINT received; draining in-flight requests"),
        () = terminate => tracing::info!("SIGTERM received; draining in-flight requests"),
    }
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

/// `verify-audit <path>` — offline verification of an audit export (Phase 4).
/// Reads the JSON file `GET /api/admin/audit/export` produced, re-walks the
/// hash chain entirely offline: each row's `entry_hash` is recomputed from its
/// own fields + stored `prev_hash`, and every `prev_hash` must link to the
/// previous row's `entry_hash`. Needs no config, DB, or network. Prints
/// `OK`/`FAIL` and exits non-zero on any break so automation can gate on it.
fn run_verify_audit(path: &str) -> anyhow::Result<()> {
    let bytes =
        std::fs::read(path).map_err(|e| anyhow::anyhow!("cannot read audit export {path}: {e}"))?;
    let export: dochub_db::AuditExport = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("{path} is not a valid audit export: {e}"))?;

    match dochub_db::verify_exported_chain(&export.events) {
        dochub_db::AuditChainStatus::Intact => {
            println!(
                "OK: audit export verified — {} event(s), hash chain intact (server verdict: {}, generated {})",
                export.events.len(),
                export.chain_status,
                export.generated_at,
            );
            Ok(())
        }
        dochub_db::AuditChainStatus::Broken { at_index } => {
            eprintln!("FAIL: audit chain broken at event index {at_index}");
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

/// Container HEALTHCHECK probe. Connects to the local `/healthz` on the bound
/// port and exits 0 when it returns 200, non-zero otherwise. Deliberately
/// dependency-free (raw TCP, no HTTP client) so the runtime image stays slim.
fn run_healthcheck() -> anyhow::Result<()> {
    let port = healthcheck_port(std::env::var("DOCHUB_BIND").ok().as_deref());
    // Always probe the loopback: the server may bind 0.0.0.0, but the check
    // runs inside the same container/network namespace.
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let timeout = Duration::from_secs(3);

    // The host-dispatch middleware 421s any Host that doesn't match the app
    // origin, so send the configured one (parsed straight from
    // DOCHUB_APP_ORIGIN). Falls back to the loopback authority when unset.
    let host =
        dochub_core::app_origin_host_from_env().unwrap_or_else(|| format!("127.0.0.1:{port}"));

    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream.write_all(
        format!("GET /healthz HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes(),
    )?;

    let mut resp = String::new();
    stream.read_to_string(&mut resp)?;
    if healthcheck_ok(&resp) {
        Ok(())
    } else {
        anyhow::bail!(
            "healthcheck failed: {}",
            resp.lines().next().unwrap_or("no response")
        )
    }
}

/// Extract the listen port from a `DOCHUB_BIND` value (`host:port`, incl. IPv6
/// `[::]:port`), falling back to the 8080 default when unset or unparseable.
fn healthcheck_port(bind: Option<&str>) -> u16 {
    bind.and_then(|b| b.rsplit(':').next())
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8080)
}

/// A `/healthz` response is healthy iff its status line is 200.
fn healthcheck_ok(response: &str) -> bool {
    let status = response.lines().next().unwrap_or_default();
    status.starts_with("HTTP/1.1 200") || status.starts_with("HTTP/1.0 200")
}

/// Map a config-free meta flag to the text it should print, or `None` to fall
/// through to normal startup. Pure + synchronous so it's unit-testable without
/// spawning `main`.
fn meta_arg_output(arg: Option<&str>) -> Option<String> {
    match arg {
        Some("--version" | "-V") => Some(format!("dochub {}", env!("CARGO_PKG_VERSION"))),
        Some("--help" | "-h") => Some(help_text()),
        _ => None,
    }
}

fn help_text() -> String {
    format!(
        "dochub {v} — the Doc-Hub server + admin CLI\n\
         \n\
         USAGE:\n\
         \x20   dochub                                  start the HTTP server (configured via env)\n\
         \x20   dochub rotate-kek                       re-wrap workspace DEKs to DOCHUB_MASTER_KEY_NEXT\n\
         \x20   dochub verify-provenance <manifest.json>  verify a provenance manifest offline\n\
         \x20   dochub verify-audit <export.json>         verify an audit export offline\n\
         \x20   dochub healthcheck                      probe local /healthz (container HEALTHCHECK)\n\
         \x20   dochub --version | -V                   print the version and exit\n\
         \x20   dochub --help | -h                      print this help and exit\n\
         \n\
         Configuration is via DOCHUB_* environment variables. See\n\
         https://github.com/CasualOffice/drive/blob/main/.docker/README.md",
        v = env!("CARGO_PKG_VERSION"),
    )
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{routing::get, Router};
    use tokio::sync::oneshot;

    /// The serve loop must return promptly once its shutdown future resolves —
    /// this guards the `with_graceful_shutdown` wiring against regressions (e.g.
    /// awaiting a future that never completes). OS-signal delivery itself is a
    /// runtime concern and isn't exercised here.
    #[tokio::test]
    async fn graceful_shutdown_returns_when_signalled() {
        let app = Router::new().route("/healthz", get(|| async { "ok" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (tx, rx) = oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
        });

        tx.send(()).unwrap();
        let joined = tokio::time::timeout(Duration::from_secs(5), server).await;
        assert!(joined.is_ok(), "serve did not shut down within 5s");
        assert!(joined.unwrap().unwrap().is_ok(), "serve returned an error");
    }

    #[test]
    fn version_flag_reports_the_cargo_version() {
        let expected = format!("dochub {}", env!("CARGO_PKG_VERSION"));
        assert_eq!(
            super::meta_arg_output(Some("--version")).as_deref(),
            Some(expected.as_str())
        );
        assert_eq!(
            super::meta_arg_output(Some("-V")).as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn help_flag_lists_usage_and_subcommands() {
        let out = super::meta_arg_output(Some("--help")).expect("--help prints");
        assert_eq!(super::meta_arg_output(Some("-h")), Some(out.clone()));
        assert!(out.contains("USAGE"));
        for cmd in [
            "rotate-kek",
            "verify-provenance",
            "verify-audit",
            "healthcheck",
            "--version",
        ] {
            assert!(out.contains(cmd), "help should mention `{cmd}`");
        }
    }

    #[test]
    fn non_meta_args_fall_through_to_startup() {
        // A real subcommand and the no-arg server-start path must NOT be
        // swallowed by the meta-flag handler.
        assert_eq!(super::meta_arg_output(Some("rotate-kek")), None);
        assert_eq!(super::meta_arg_output(Some("verify-audit")), None);
        assert_eq!(super::meta_arg_output(Some("healthcheck")), None);
        assert_eq!(super::meta_arg_output(None), None);
    }

    #[test]
    fn healthcheck_port_parses_bind_or_defaults() {
        assert_eq!(super::healthcheck_port(Some("0.0.0.0:8080")), 8080);
        assert_eq!(super::healthcheck_port(Some("127.0.0.1:9000")), 9000);
        assert_eq!(super::healthcheck_port(Some("[::]:7070")), 7070);
        // Unset or unparseable → the documented 8080 default.
        assert_eq!(super::healthcheck_port(None), 8080);
        assert_eq!(super::healthcheck_port(Some("garbage")), 8080);
        assert_eq!(super::healthcheck_port(Some("host:notaport")), 8080);
    }

    #[test]
    fn healthcheck_ok_only_on_200_status_line() {
        assert!(super::healthcheck_ok("HTTP/1.1 200 OK\r\n\r\nok"));
        assert!(super::healthcheck_ok("HTTP/1.0 200 OK\r\n\r\nok"));
        assert!(!super::healthcheck_ok(
            "HTTP/1.1 503 Service Unavailable\r\n\r\n"
        ));
        assert!(!super::healthcheck_ok("HTTP/1.1 404 Not Found\r\n\r\n"));
        assert!(!super::healthcheck_ok(""));
    }
}
