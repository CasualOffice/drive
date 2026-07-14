//! Domain types, errors, IDs, and runtime configuration shared across the
//! Doc-Hub workspace.
//!
//! This crate depends only on `dochub-crypto` — the leaf crypto crate, which
//! itself has no workspace dependencies — so `Config` can hold the master KEK
//! (build spec §8). Everything else in the workspace depends on this crate.

#![forbid(unsafe_code)]

pub mod config;
pub mod error;
pub mod extract;
pub mod id;
pub mod ingest;

pub use config::{dev_master_kek, dev_master_kek_next, Backend, Config, ConfigError, OidcConfig};
pub use error::DriveError;
pub use extract::{extract_text, supports as supports_extraction, ExtractError};
pub use id::{FileId, FolderId};
pub use ingest::{guard, DocKind, IngestError, ALLOWED_EXTENSIONS};
