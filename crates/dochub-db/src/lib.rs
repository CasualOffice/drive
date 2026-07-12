//! Metadata DB layer. Wraps a `sqlx` pool with a backend-agnostic API
//! (`SQLite` default, Postgres for production) and runs migrations on connect.
//!
//! Phase 1 ships repositories for users, sessions, folders, and files.
//! Share-link + WOPI-lock repositories will land alongside their handlers
//! in `dochub-http`.

#![forbid(unsafe_code)]

mod acl;
mod audit;
mod error;
mod file_versions;
mod files;
mod folders;
mod invitations;
mod jobs;
mod key_rotation;
mod legal_holds;
mod notes;
mod oidc;
mod pool;
mod projects;
mod provenance_keys;
mod registry;
mod retention;
mod search;
mod sessions;
mod share_links;
mod tags;
mod users;
mod workspace_keys;
mod workspace_storage;
mod workspaces;

pub use acl::{resource_kind, subject_kind, AclGrant, AclRepo, NewAclGrant};
pub use audit::{action, AuditChainStatus, AuditEvent, AuditRepo, NewAuditEvent};
pub use error::DbError;
pub use file_versions::{FileVersionsRepo, NewVersion, Version};
pub use files::{File, FileRepo, FileStatus, NewFile};
pub use folders::{Folder, FolderRepo, NewFolder};
pub use invitations::{NewWorkspaceInvitation, WorkspaceInvitation, WorkspaceInvitationRepo};
pub use jobs::{state as job_state, Job, JobsRepo, NewJob, KIND_INDEX_FILE};
pub use key_rotation::RotationReport;
pub use legal_holds::{target_kind, LegalHold, LegalHoldsRepo, NewLegalHold};
pub use notes::{
    order_key_between, parse_wiki_links, NewNote, Note, NoteBacklink, NoteLinksRepo, NoteNode,
    NotesRepo,
};
pub use oidc::{NewOidcFlowState, OidcFlowState, OidcFlowStateRepo};
pub use pool::{Db, DbBackend};
pub use projects::{NewProject, Project, ProjectMemberRepo, ProjectMembership, ProjectRepo};
pub use provenance_keys::{ProvenanceKeyError, ProvenanceKeypair, ProvenanceKeysRepo};
pub use registry::{Registry, RegistryError};
pub use retention::{NewRetentionPolicy, RetentionPolicy, RetentionRepo};
pub use search::{SearchFilters, SearchPaging, SortBy, SortDir, TypeBucket};
pub use sessions::{NewSession, Session, SessionRepo};
pub use share_links::{NewShareLink, ShareLink, ShareLinkRepo};
pub use tags::{NewTag, Tag, TagRepo};
pub use users::{NewUser, User, UserRepo};
pub use workspace_keys::{DekError, WorkspaceDeks, WorkspaceKeysRepo};
pub use workspace_storage::{
    NewWorkspaceStorage, WorkspaceStorage, WorkspaceStorageProvider, WorkspaceStorageRepo,
};
pub use workspaces::{
    Workspace, WorkspaceKind, WorkspaceMemberRepo, WorkspaceMembership, WorkspaceRepo,
    WorkspaceRole, WorkspaceWithRole,
};
