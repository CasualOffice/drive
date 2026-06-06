//! Metadata DB layer. Wraps a `sqlx` pool with a backend-agnostic API
//! (`SQLite` default, Postgres for production) and runs migrations on connect.
//!
//! Phase 1 ships repositories for users, sessions, folders, and files.
//! Share-link + WOPI-lock repositories will land alongside their handlers
//! in `drive-http`.

#![forbid(unsafe_code)]

mod error;
mod files;
mod folders;
mod pool;
mod sessions;
mod users;

pub use error::DbError;
pub use files::{File, FileRepo, NewFile};
pub use folders::{Folder, FolderRepo, NewFolder};
pub use pool::{Db, DbBackend};
pub use sessions::{NewSession, Session, SessionRepo};
pub use users::{NewUser, User, UserRepo};
