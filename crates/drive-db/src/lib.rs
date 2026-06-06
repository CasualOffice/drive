//! Metadata DB layer. Wraps a `sqlx` pool with a backend-agnostic API
//! (`SQLite` default, Postgres for production) and runs migrations on connect.
//!
//! Phase 1 ships the user + session repositories. File/folder/share/wopi-lock
//! repositories will land alongside their handlers in `drive-http`.

#![forbid(unsafe_code)]

mod error;
mod pool;
mod sessions;
mod users;

pub use error::DbError;
pub use pool::{Db, DbBackend};
pub use sessions::{NewSession, Session, SessionRepo};
pub use users::{NewUser, User, UserRepo};
