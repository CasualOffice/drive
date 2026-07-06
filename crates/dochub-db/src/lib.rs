//! Metadata DB layer. Wraps a `sqlx` pool with a backend-agnostic API
//! (`SQLite` default, Postgres for production) and runs migrations on connect.
//!
//! Phase 1 ships repositories for users, sessions, folders, and files.
//! Share-link + WOPI-lock repositories will land alongside their handlers
//! in `dochub-http`.

#![forbid(unsafe_code)]

mod audit;
mod error;
mod file_versions;
mod files;
mod folders;
mod invitations;
mod notes;
mod oidc;
mod pool;
mod registry;
mod search;
mod sessions;
mod share_links;
mod users;
mod workspace_keys;
mod workspace_storage;
mod workspaces;

pub use audit::{AuditEvent, AuditRepo, NewAuditEvent};
pub use error::DbError;
pub use file_versions::{FileVersionsRepo, NewVersion, Version};
pub use files::{File, FileRepo, FileStatus, NewFile};
pub use folders::{Folder, FolderRepo, NewFolder};
pub use invitations::{NewWorkspaceInvitation, WorkspaceInvitation, WorkspaceInvitationRepo};
pub use notes::{
    order_key_between, parse_wiki_links, NewNote, Note, NoteBacklink, NoteLinksRepo, NoteNode,
    NotesRepo,
};
pub use oidc::{NewOidcFlowState, OidcFlowState, OidcFlowStateRepo};
pub use pool::{Db, DbBackend};
pub use registry::{Registry, RegistryError};
pub use search::{SearchFilters, SearchPaging, SortBy, SortDir, TypeBucket};
pub use sessions::{NewSession, Session, SessionRepo};
pub use share_links::{NewShareLink, ShareLink, ShareLinkRepo};
pub use users::{NewUser, User, UserRepo};
pub use workspace_keys::{DekError, WorkspaceDeks, WorkspaceKeysRepo};
pub use workspace_storage::{
    NewWorkspaceStorage, WorkspaceStorage, WorkspaceStorageProvider, WorkspaceStorageRepo,
};
pub use workspaces::{
    Workspace, WorkspaceKind, WorkspaceMemberRepo, WorkspaceMembership, WorkspaceRepo,
    WorkspaceRole, WorkspaceWithRole,
};
