//! Domain types, errors, IDs, and runtime configuration shared across the
//! Casual Drive workspace.
//!
//! This crate must not depend on any other crate in the workspace. Everything
//! else depends on it (or its narrower siblings).

#![forbid(unsafe_code)]

pub mod config;
pub mod error;
pub mod id;
pub mod ingest;

pub use config::{Backend, Config, ConfigError, OidcConfig};
pub use error::DriveError;
pub use id::{FileId, FolderId};
pub use ingest::{guard, DocKind, IngestError, ALLOWED_EXTENSIONS};
