//! Runtime configuration loaded from environment variables.
//!
//! See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §"Configuration"
//! for the full env-var contract, mirrored in `.env.example`.

use std::net::SocketAddr;
use std::sync::Arc;

use dochub_crypto::EnvKek;
use thiserror::Error;
use url::Url;

/// KEK version for the Phase 0 `DOCHUB_MASTER_KEY` provider. Rotation (a bump
/// past 1) is a Phase 1 concern; the wrapped-DEK rows already carry the
/// version so re-wrap is lossless.
const MASTER_KEY_VERSION: u32 = 1;

/// KEK version for the optional `DOCHUB_MASTER_KEY_NEXT` provider — the target
/// of a KEK rotation (P1.1). Bumped past the current version so re-wrapped rows
/// record which KEK sealed them.
const MASTER_KEY_NEXT_VERSION: u32 = MASTER_KEY_VERSION + 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// Filesystem-backed storage rooted at a configured directory.
    Fs,
    /// In-process storage. Tests and ephemeral demos only — never prod.
    Memory,
    /// AWS S3 (or S3-protocol compatible service like Cloudflare R2).
    S3,
    /// `MinIO` — S3-protocol with a custom endpoint.
    Minio,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// e.g. `https://drive.casualoffice.org`.
    pub app_origin: Url,
    /// e.g. `https://usercontent-drive.casualoffice.org`. Must differ from
    /// `app_origin` in production (boot refuses to start otherwise).
    pub usercontent_origin: Url,
    pub bind: SocketAddr,
    pub backend: Backend,
    pub fs_root: Option<String>,
    pub s3_bucket: Option<String>,
    pub s3_region: Option<String>,
    pub s3_endpoint: Option<String>,
    pub aws_access_key_id: Option<String>,
    pub aws_secret_access_key: Option<String>,
    pub db_url: String,
    pub body_limit_mb: u64,
    /// Signed download URL lifetime, in seconds. Surfaced under
    /// Settings → Storage so operators see the contract they configured.
    /// Default 300s (5 min). `DOCHUB_SIGNED_URL_TTL_SECS` overrides.
    pub signed_url_ttl_secs: u64,
    pub session_secret: Vec<u8>,
    pub wopi_hmac_secret: [u8; 32],
    pub signed_url_hmac_secret: [u8; 32],
    pub admin_user: String,
    pub admin_password_hash: String,
    pub recipient_footer: bool,
    pub is_prod: bool,
    /// Master key-encryption-key (KEK), parsed from `DOCHUB_MASTER_KEY`
    /// (base64, 32 bytes). Wraps every per-workspace DEK. Boot refuses to
    /// start without it (build spec §8) — encryption at rest is not optional.
    /// Held behind an `Arc` so `Config` stays `Clone`; the key material is
    /// zeroized on drop and never appears in `Debug`.
    pub master_kek: Arc<EnvKek>,
    /// Optional *next* master KEK, parsed from `DOCHUB_MASTER_KEY_NEXT` (base64,
    /// 32 bytes). Present only during a KEK rotation (P1.1): the `rotate-kek`
    /// admin command re-wraps every per-workspace DEK from `master_kek` to this
    /// one without rewriting document blobs. `None` in steady state. Carries a
    /// bumped `key_version` so re-wrapped rows record which KEK sealed them.
    pub master_kek_next: Option<Arc<EnvKek>>,
    /// Casual Sheets origin (e.g. `https://sheet.casualoffice.org`). When
    /// `None`, the editor handoff endpoint returns 503 and the SPA shows a
    /// "editor isn't configured" toast. See docs/ux/08-editor-handoff.md.
    pub sheet_origin: Option<Url>,
    /// Casual Editor origin (e.g. `https://document.casualoffice.org`).
    /// Same opt-in semantics as `sheet_origin`.
    pub document_origin: Option<Url>,
    /// Real-time co-editing server origin (the sibling `collab` Hocuspocus/Yjs
    /// service, e.g. `https://collab.casualoffice.org`). Opt-in (build spec
    /// §3): when `None`, the `/api/files/{id}/collab*` room-brokering endpoints
    /// return 404 and editing falls back to single-user (P2.1). Parsed from
    /// `DOCHUB_COLLAB_URL`.
    pub collab_url: Option<Url>,
    /// Phase 3 §12 — OIDC sign-in. All four fields go together; either
    /// the operator configures the whole set or none of it.
    pub oidc: Option<OidcConfig>,
    /// Phase 3 §12 — when false, the password sign-in form is hidden
    /// server-side (the `/api/auth/sign-in` route returns 404). Default
    /// true so existing deployments keep working through the OIDC roll-out.
    pub allow_password_auth: bool,
}

#[derive(Debug, Clone)]
pub struct OidcConfig {
    pub issuer: Url,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_url: Url,
    /// `openid email profile` by default.
    pub scopes: Vec<String>,
    /// When set, members of this group (per the IdP's `groups` claim)
    /// are flagged `is_admin = true` on every sign-in.
    pub admin_group: Option<String>,
    /// When true, unknown OIDC subjects auto-provision a new user row.
    /// When false, a sign-in by an unknown subject returns 403.
    pub auto_create_users: bool,
    /// Shown on the sign-in card next to the IdP button.
    pub provider_label: String,
    /// Stable identifier used in the `users.oidc_provider_id` column so
    /// rotating issuers / multi-IdP futures don't lose users. Defaults
    /// to a hash of the issuer URL if unset by the operator.
    pub provider_id: String,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required env var: {0}")]
    Missing(&'static str),
    #[error("invalid {0}: {1}")]
    Invalid(&'static str, String),
    #[error("app and user-content origins must not share a host:port in production — host-dispatch can't tell them apart, collapsing the two-origin isolation (app origin: {0})")]
    OriginsMatch(String),
    #[error("secret {0} too short — need 32 bytes (raw or base64)")]
    SecretTooShort(&'static str),
    #[error("secret {0} appears to be a development default — refuse to start in prod")]
    SecretIsDevDefault(&'static str),
    #[error("fs backend selected but DOCHUB_FS_ROOT is missing")]
    FsRootMissing,
    #[error("S3/MinIO backend selected but {0} is missing")]
    S3FieldMissing(&'static str),
    #[error("DOCHUB_MASTER_KEY is required (base64 32-byte KEK) — refusing to start without at-rest encryption")]
    MasterKeyMissing,
    #[error("DOCHUB_MASTER_KEY is invalid: {0}")]
    MasterKeyInvalid(&'static str),
    #[error("DOCHUB_MASTER_KEY_NEXT is invalid: {0}")]
    NextMasterKeyInvalid(&'static str),
}

impl Config {
    /// Build a Config from the environment. Returns `ConfigError` on the
    /// first invariant violation. See `.env.example` for the contract.
    pub fn from_env() -> Result<Self, ConfigError> {
        let is_prod = env_bool("DOCHUB_PROD").unwrap_or(false);

        let app_origin = env_url("DOCHUB_APP_ORIGIN")?;
        let usercontent_origin = env_url("DOCHUB_USERCONTENT_ORIGIN")?;
        // Compare the *dispatch identity* (host:port), not the full URL. The
        // two-origin isolation is enforced by host-dispatch, which keys on
        // `origin_host` (host:port) — scheme and path are ignored. So origins
        // that merely differ by scheme or path (e.g. `https://h.example` vs
        // `https://h.example/uc`) are indistinguishable to dispatch and must be
        // rejected too; a full-URL `==` check let them slip through and collapse
        // the app/user-content boundary.
        if is_prod && origins_share_dispatch_host(&app_origin, &usercontent_origin) {
            return Err(ConfigError::OriginsMatch(app_origin.to_string()));
        }

        let bind: SocketAddr = std::env::var("DOCHUB_BIND")
            .unwrap_or_else(|_| "127.0.0.1:8080".into())
            .parse()
            .map_err(|e: std::net::AddrParseError| {
                ConfigError::Invalid("DOCHUB_BIND", e.to_string())
            })?;

        let backend = match std::env::var("DOCHUB_BACKEND").as_deref() {
            Ok("fs") => Backend::Fs,
            Ok("memory") => Backend::Memory,
            Ok("s3") => Backend::S3,
            Ok("minio") => Backend::Minio,
            Ok(other) => return Err(ConfigError::Invalid("DOCHUB_BACKEND", other.into())),
            Err(_) => Backend::Fs,
        };

        let fs_root = std::env::var("DOCHUB_FS_ROOT").ok();
        let s3_bucket = std::env::var("DOCHUB_S3_BUCKET").ok();
        let s3_region = std::env::var("DOCHUB_S3_REGION").ok();
        let s3_endpoint = std::env::var("DOCHUB_S3_ENDPOINT").ok();
        let aws_access_key_id = std::env::var("AWS_ACCESS_KEY_ID").ok();
        let aws_secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY").ok();

        match backend {
            Backend::Fs if fs_root.is_none() => return Err(ConfigError::FsRootMissing),
            Backend::S3 | Backend::Minio => {
                if s3_bucket.is_none() {
                    return Err(ConfigError::S3FieldMissing("DOCHUB_S3_BUCKET"));
                }
                if aws_access_key_id.is_none() {
                    return Err(ConfigError::S3FieldMissing("AWS_ACCESS_KEY_ID"));
                }
                if aws_secret_access_key.is_none() {
                    return Err(ConfigError::S3FieldMissing("AWS_SECRET_ACCESS_KEY"));
                }
            }
            _ => {}
        }

        let db_url = std::env::var("DOCHUB_DB_URL").unwrap_or_else(|_| "sqlite::memory:".into());

        let body_limit_mb: u64 = std::env::var("DOCHUB_BODY_LIMIT_MB")
            .unwrap_or_else(|_| "100".into())
            .parse()
            .map_err(|e: std::num::ParseIntError| {
                ConfigError::Invalid("DOCHUB_BODY_LIMIT_MB", e.to_string())
            })?;

        // 300s (5 min) matches the signed_get callers in dochub-http and
        // is what most production setups want. Clamp at the bottom so a
        // misconfigured 0/1 doesn't silently invalidate every URL faster
        // than the SPA can use it.
        let signed_url_ttl_secs: u64 = std::env::var("DOCHUB_SIGNED_URL_TTL_SECS")
            .unwrap_or_else(|_| "300".into())
            .parse::<u64>()
            .map_err(|e: std::num::ParseIntError| {
                ConfigError::Invalid("DOCHUB_SIGNED_URL_TTL_SECS", e.to_string())
            })?
            .max(30);

        let session_secret = env_secret_bytes("DOCHUB_SESSION_SECRET", is_prod)?;
        let wopi_hmac_secret = env_secret_32("DOCHUB_WOPI_HMAC_SECRET", is_prod)?;
        let signed_url_hmac_secret = env_secret_32("DOCHUB_SIGNED_URL_HMAC_SECRET", is_prod)?;

        let admin_user = std::env::var("DOCHUB_ADMIN_USER").unwrap_or_else(|_| "admin".into());
        let admin_password_hash = std::env::var("DOCHUB_ADMIN_PASSWORD_HASH")
            .map_err(|_| ConfigError::Missing("DOCHUB_ADMIN_PASSWORD_HASH"))?;

        let recipient_footer = env_bool("DOCHUB_RECIPIENT_FOOTER").unwrap_or(true);

        // Boot invariant (build spec §8): no master key, no start. Parsed
        // before the optional origin blocks so a misconfigured deployment
        // fails on the most important thing first.
        let master_kek = parse_master_kek(std::env::var("DOCHUB_MASTER_KEY").ok())?;
        // Optional rotation target. Absent in steady state; set only while a
        // `rotate-kek` run is planned. Validated like the master key so a
        // typo'd rotation key fails at boot, not mid-rotation.
        let master_kek_next = parse_master_kek_next(std::env::var("DOCHUB_MASTER_KEY_NEXT").ok())?;

        let sheet_origin = match std::env::var("DOCHUB_SHEET_ORIGIN").ok() {
            Some(s) if !s.is_empty() => Some(
                Url::parse(&s)
                    .map_err(|e| ConfigError::Invalid("DOCHUB_SHEET_ORIGIN", e.to_string()))?,
            ),
            _ => None,
        };
        let document_origin = match std::env::var("DOCHUB_DOCUMENT_ORIGIN").ok() {
            Some(s) if !s.is_empty() => Some(
                Url::parse(&s)
                    .map_err(|e| ConfigError::Invalid("DOCHUB_DOCUMENT_ORIGIN", e.to_string()))?,
            ),
            _ => None,
        };
        let collab_url = match std::env::var("DOCHUB_COLLAB_URL").ok() {
            Some(s) if !s.is_empty() => Some(
                Url::parse(&s)
                    .map_err(|e| ConfigError::Invalid("DOCHUB_COLLAB_URL", e.to_string()))?,
            ),
            _ => None,
        };

        Ok(Self {
            app_origin,
            usercontent_origin,
            bind,
            backend,
            fs_root,
            s3_bucket,
            s3_region,
            s3_endpoint,
            aws_access_key_id,
            aws_secret_access_key,
            db_url,
            body_limit_mb,
            signed_url_ttl_secs,
            session_secret,
            wopi_hmac_secret,
            signed_url_hmac_secret,
            admin_user,
            admin_password_hash,
            recipient_footer,
            is_prod,
            master_kek,
            master_kek_next,
            oidc: load_oidc_from_env()?,
            allow_password_auth: env_bool("DOCHUB_ALLOW_PASSWORD_AUTH").unwrap_or(true),
            sheet_origin,
            document_origin,
            collab_url,
        })
    }

    /// The bare host (`host:port` for non-default ports) extracted from
    /// `app_origin`. Used by the Host-dispatch middleware.
    #[must_use]
    pub fn app_origin_host(&self) -> String {
        origin_host(&self.app_origin)
    }

    #[must_use]
    pub fn usercontent_origin_host(&self) -> String {
        origin_host(&self.usercontent_origin)
    }
}

fn origin_host(u: &Url) -> String {
    match (u.host_str(), u.port()) {
        (Some(h), Some(p)) => format!("{h}:{p}"),
        (Some(h), None) => h.to_string(),
        _ => String::new(),
    }
}

/// True when two origins are indistinguishable to the host-dispatch layer —
/// i.e. they share the same non-empty `host:port`, even if their full URLs
/// differ by scheme or path. Sharing the dispatch host collapses the
/// app/user-content isolation, so boot must reject it in production.
fn origins_share_dispatch_host(app: &Url, usercontent: &Url) -> bool {
    let a = origin_host(app);
    !a.is_empty() && a == origin_host(usercontent)
}

/// The app-origin authority (`host[:port]`, default ports stripped) parsed
/// straight from `DOCHUB_APP_ORIGIN` — no full [`Config`] (or master key)
/// required. The container healthcheck uses it to send a `Host` header that
/// satisfies the host-dispatch middleware. `None` when the var is unset or
/// unparseable.
#[must_use]
pub fn app_origin_host_from_env() -> Option<String> {
    app_origin_host_from_raw(std::env::var("DOCHUB_APP_ORIGIN").ok().as_deref())
}

fn app_origin_host_from_raw(raw: Option<&str>) -> Option<String> {
    let host = origin_host(&Url::parse(raw?).ok()?);
    (!host.is_empty()).then_some(host)
}

fn env_url(name: &'static str) -> Result<Url, ConfigError> {
    let raw = std::env::var(name).map_err(|_| ConfigError::Missing(name))?;
    Url::parse(&raw).map_err(|e| ConfigError::Invalid(name, e.to_string()))
}

fn env_bool(name: &str) -> Option<bool> {
    match std::env::var(name).ok()?.to_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn env_secret_bytes(name: &'static str, is_prod: bool) -> Result<Vec<u8>, ConfigError> {
    let raw = std::env::var(name).map_err(|_| ConfigError::Missing(name))?;
    if raw.len() < 32 {
        return Err(ConfigError::SecretTooShort(name));
    }
    if is_prod && is_dev_default(&raw) {
        return Err(ConfigError::SecretIsDevDefault(name));
    }
    Ok(raw.into_bytes())
}

fn env_secret_32(name: &'static str, is_prod: bool) -> Result<[u8; 32], ConfigError> {
    let bytes = env_secret_bytes(name, is_prod)?;
    let mut out = [0u8; 32];
    // Take the first 32 bytes; longer secrets are accepted but truncated for
    // fixed-width HMAC keys.
    out.copy_from_slice(&bytes[..32]);
    Ok(out)
}

/// Parse the master KEK from a raw `DOCHUB_MASTER_KEY` value. Pure (takes the
/// value rather than reading the env directly) so the boot invariant is unit
/// testable without racing on process-global env state.
fn parse_master_kek(raw: Option<String>) -> Result<Arc<EnvKek>, ConfigError> {
    let raw = raw.ok_or(ConfigError::MasterKeyMissing)?;
    if raw.trim().is_empty() {
        return Err(ConfigError::MasterKeyMissing);
    }
    let kek = EnvKek::from_base64(&raw, MASTER_KEY_VERSION).map_err(|e| match e {
        dochub_crypto::CryptoError::BadKeyLength => {
            ConfigError::MasterKeyInvalid("must decode to exactly 32 bytes")
        }
        _ => ConfigError::MasterKeyInvalid("not valid standard base64"),
    })?;
    Ok(Arc::new(kek))
}

/// Parse the optional *next* master KEK from a raw `DOCHUB_MASTER_KEY_NEXT`
/// value. Unlike [`parse_master_kek`], absence (or an all-whitespace value) is
/// not an error — it just means "no rotation pending" and yields `None`. When
/// present it must be a valid base64 32-byte key, sealed under the bumped
/// [`MASTER_KEY_NEXT_VERSION`]. Pure for the same testability reason.
fn parse_master_kek_next(raw: Option<String>) -> Result<Option<Arc<EnvKek>>, ConfigError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let kek = EnvKek::from_base64(&raw, MASTER_KEY_NEXT_VERSION).map_err(|e| match e {
        dochub_crypto::CryptoError::BadKeyLength => {
            ConfigError::NextMasterKeyInvalid("must decode to exactly 32 bytes")
        }
        _ => ConfigError::NextMasterKeyInvalid("not valid standard base64"),
    })?;
    Ok(Some(Arc::new(kek)))
}

/// A fixed, well-known master KEK for tests and local fixtures. Not wired to
/// any production path — `Config::from_env` always derives the KEK from the
/// environment. `#[doc(hidden)]` keeps it out of the public surface.
#[doc(hidden)]
#[must_use]
pub fn dev_master_kek() -> Arc<EnvKek> {
    Arc::new(EnvKek::from_bytes([0x2a; 32], MASTER_KEY_VERSION))
}

/// A fixed, well-known *next* master KEK for rotation tests — distinct key
/// material and the bumped [`MASTER_KEY_NEXT_VERSION`], so a re-wrap from
/// [`dev_master_kek`] to this one is observable. `#[doc(hidden)]` keeps it out
/// of the public surface; never wired to a production path.
#[doc(hidden)]
#[must_use]
pub fn dev_master_kek_next() -> Arc<EnvKek> {
    Arc::new(EnvKek::from_bytes([0x5b; 32], MASTER_KEY_NEXT_VERSION))
}

/// Load the optional OIDC block from env. All four required fields must
/// be set together (issuer + client_id + client_secret + redirect_url),
/// otherwise we return None and Drive runs without OIDC.
fn load_oidc_from_env() -> Result<Option<OidcConfig>, ConfigError> {
    let Ok(issuer_str) = std::env::var("DOCHUB_OIDC_ISSUER") else {
        return Ok(None);
    };
    if issuer_str.is_empty() {
        return Ok(None);
    }
    let issuer = Url::parse(&issuer_str)
        .map_err(|e| ConfigError::Invalid("DOCHUB_OIDC_ISSUER", e.to_string()))?;
    let client_id = std::env::var("DOCHUB_OIDC_CLIENT_ID")
        .map_err(|_| ConfigError::Missing("DOCHUB_OIDC_CLIENT_ID"))?;
    let client_secret = std::env::var("DOCHUB_OIDC_CLIENT_SECRET")
        .map_err(|_| ConfigError::Missing("DOCHUB_OIDC_CLIENT_SECRET"))?;
    let redirect_url = std::env::var("DOCHUB_OIDC_REDIRECT_URL")
        .map_err(|_| ConfigError::Missing("DOCHUB_OIDC_REDIRECT_URL"))
        .and_then(|s| {
            Url::parse(&s)
                .map_err(|e| ConfigError::Invalid("DOCHUB_OIDC_REDIRECT_URL", e.to_string()))
        })?;
    let scopes: Vec<String> = std::env::var("DOCHUB_OIDC_SCOPES")
        .unwrap_or_else(|_| "openid email profile".into())
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let admin_group = std::env::var("DOCHUB_OIDC_ADMIN_GROUP")
        .ok()
        .filter(|s| !s.is_empty());
    let auto_create_users = env_bool("DOCHUB_OIDC_AUTO_CREATE_USERS").unwrap_or(true);
    let provider_label = std::env::var("DOCHUB_OIDC_PROVIDER_LABEL")
        .unwrap_or_else(|_| "your identity provider".into());
    // Stable id; defaults to a short hash of the issuer URL so two
    // deployments pointing at different IdPs don't collide on the
    // `users.oidc_provider_id` unique index.
    let provider_id = std::env::var("DOCHUB_OIDC_PROVIDER_ID")
        .unwrap_or_else(|_| stable_provider_id(issuer.as_str()));

    Ok(Some(OidcConfig {
        issuer,
        client_id,
        client_secret,
        redirect_url,
        scopes,
        admin_group,
        auto_create_users,
        provider_label,
        provider_id,
    }))
}

/// 12-hex-char fingerprint of the issuer URL. Stable across restarts;
/// changes only if the issuer URL itself changes (which would invalidate
/// the existing `users.oidc_subject` linkage anyway).
fn stable_provider_id(issuer: &str) -> String {
    use sha2::{Digest, Sha256};
    let h = Sha256::digest(issuer.as_bytes());
    h.iter()
        .take(6)
        .fold(String::with_capacity(12), |mut acc, b| {
            use std::fmt::Write;
            let _ = write!(&mut acc, "{b:02x}");
            acc
        })
}

fn is_dev_default(s: &str) -> bool {
    const KNOWN_BAD: &[&str] = &[
        "changeme",
        "change-me",
        "default",
        "dev-only-",
        "REPLACE_BEFORE_PROD",
    ];
    KNOWN_BAD.iter().any(|bad| s.contains(bad))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_host_strips_default_port() {
        let u = Url::parse("https://drive.example.org").unwrap();
        assert_eq!(origin_host(&u), "drive.example.org");
    }

    #[test]
    fn origin_host_keeps_nondefault_port() {
        let u = Url::parse("http://127.0.0.1:8080").unwrap();
        assert_eq!(origin_host(&u), "127.0.0.1:8080");
    }

    #[test]
    fn origins_sharing_host_port_are_a_conflict() {
        let share = |a: &str, b: &str| {
            origins_share_dispatch_host(&Url::parse(a).unwrap(), &Url::parse(b).unwrap())
        };
        // Same host:port but different path or scheme → indistinguishable to
        // host-dispatch → conflict (the bug a full-URL `==` check missed).
        assert!(share(
            "https://hub.example.org",
            "https://hub.example.org/uc"
        ));
        assert!(share("https://hub.example.org", "http://hub.example.org"));
        assert!(share("https://hub.example.org", "https://hub.example.org"));
        // Distinct host or port → safe.
        assert!(!share("https://hub.example.org", "https://uc.example.org"));
        assert!(!share("http://localhost:8080", "http://localhost:8081"));
    }

    #[test]
    fn app_origin_host_from_raw_matches_host_dispatch_expectation() {
        // Same output as `Config::app_origin_host` — the healthcheck's Host
        // header must exactly satisfy the host-dispatch middleware.
        assert_eq!(
            app_origin_host_from_raw(Some("http://localhost:8080")).as_deref(),
            Some("localhost:8080")
        );
        assert_eq!(
            app_origin_host_from_raw(Some("https://hub.example.com")).as_deref(),
            Some("hub.example.com") // default 443 stripped
        );
        assert_eq!(app_origin_host_from_raw(None), None);
        assert_eq!(app_origin_host_from_raw(Some("not a url")), None);
    }

    #[test]
    fn master_key_missing_is_error() {
        assert!(matches!(
            parse_master_kek(None),
            Err(ConfigError::MasterKeyMissing)
        ));
        assert!(matches!(
            parse_master_kek(Some("   ".into())),
            Err(ConfigError::MasterKeyMissing)
        ));
    }

    #[test]
    fn master_key_invalid_is_error() {
        // Not base64.
        assert!(matches!(
            parse_master_kek(Some("not!!base64!!".into())),
            Err(ConfigError::MasterKeyInvalid(_))
        ));
        // Valid base64 but wrong length (16 bytes).
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let short = STANDARD.encode([0u8; 16]);
        assert!(matches!(
            parse_master_kek(Some(short)),
            Err(ConfigError::MasterKeyInvalid(_))
        ));
    }

    #[test]
    fn master_key_valid_base64_parses() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let key = STANDARD.encode([7u8; 32]);
        assert!(parse_master_kek(Some(key)).is_ok());
    }

    #[test]
    fn next_master_key_absent_is_none() {
        // Unset and all-whitespace both mean "no rotation pending".
        assert!(matches!(parse_master_kek_next(None), Ok(None)));
        assert!(matches!(
            parse_master_kek_next(Some("   ".into())),
            Ok(None)
        ));
    }

    #[test]
    fn next_master_key_invalid_is_error() {
        assert!(matches!(
            parse_master_kek_next(Some("not!!base64!!".into())),
            Err(ConfigError::NextMasterKeyInvalid(_))
        ));
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let short = STANDARD.encode([0u8; 16]);
        assert!(matches!(
            parse_master_kek_next(Some(short)),
            Err(ConfigError::NextMasterKeyInvalid(_))
        ));
    }

    #[test]
    fn next_master_key_valid_base64_parses_with_bumped_version() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use dochub_crypto::KeyProvider;
        let key = STANDARD.encode([9u8; 32]);
        let parsed = parse_master_kek_next(Some(key)).unwrap().expect("some");
        assert_eq!(parsed.key_version(), MASTER_KEY_NEXT_VERSION);
        assert_ne!(MASTER_KEY_NEXT_VERSION, MASTER_KEY_VERSION);
    }

    #[test]
    fn dev_default_detection() {
        assert!(is_dev_default("dev-only-32-byte-secret-DO-NOT-USE-aa"));
        assert!(is_dev_default("changeme"));
        assert!(is_dev_default("REPLACE_BEFORE_PROD"));
        assert!(!is_dev_default("aZkP9wQ8r3X2nF7Yv5L1bH4mT0jC6dE9"));
    }
}
