//! `GET /api/search/content` — Phase 3 P3.1 full-text **content** search.
//!
//! Distinct from [`crate::search`] (the name/metadata + filter surface backed
//! by SQL `LIKE`): this endpoint queries the Tantivy content index
//! (`dochub-index`) so a phrase that exists only *inside* a document is found.
//! Spec: `docs/design/phase-3-build.md` §1–§2, `docs/ARCHITECTURE.md`
//! §"Content indexing".
//!
//! Indexing is **lazy**: before searching we run [`reindex_pending`] for the
//! caller's workspace, which decrypts the head of any file the index hasn't
//! caught up on, extracts text, and upserts it. That keeps results fresh
//! without a background OS thread (a real bounded worker is the scale
//! follow-up, build spec §1 "Worker").
//!
//! ## Why the index lives in a process-global registry, not `HttpState`
//!
//! The `Index` handle can't be added to [`HttpState`] without editing every
//! `HttpState { .. }` construction site — including `dochub-bin`, which is out
//! of scope for this PR. Instead we keep a process-global map keyed by the
//! `Arc<Config>` pointer of the owning state: one `HttpState` (and all its
//! cheap clones) share one index; two independently-built states (each test
//! fixture, or a future multi-tenant split) get their own. The `Arc<Config>`
//! is pinned in the map so its address can never be recycled under a stale
//! entry.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use dochub_auth::AuthSession;
use dochub_core::{Config, DocKind};
use dochub_db::{File, FileRepo, FileVersionsRepo, Registry, WorkspaceDeks};
use dochub_index::{Index, IndexDoc};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;

use crate::{workspaces::resolve_active_workspace, HttpState};

/// Author recorded on any legacy-blob backfill the reindex triggers. Not a real
/// user — the backfill just seals pre-version bytes into the chain so they can
/// be read + indexed (see [`Registry::read_or_backfill_for_file`]).
const INDEXER_AUTHOR: &str = "system:indexer";

/// Upper bound on files reindexed per lazy pass. Steady state this is zero
/// (nothing pending); the cap only matters on the first search after a bulk
/// import.
const REINDEX_BATCH: i64 = 200;

// ── Process-global index registry ────────────────────────────────────────

type IndexRegistry = Mutex<HashMap<usize, (Arc<Config>, Arc<Index>)>>;

fn index_registry() -> &'static IndexRegistry {
    static REG: OnceLock<IndexRegistry> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve (opening on first use) the content index for this state. On-disk
/// when `DOCHUB_INDEX_PATH` names a directory, otherwise in-memory.
fn index_for(state: &HttpState) -> Result<Arc<Index>, StatusCode> {
    let key = Arc::as_ptr(&state.config) as usize;
    let mut reg = index_registry()
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if let Some((_, idx)) = reg.get(&key) {
        return Ok(idx.clone());
    }
    let index = match std::env::var("DOCHUB_INDEX_PATH") {
        Ok(p) if !p.trim().is_empty() => {
            std::fs::create_dir_all(&p).map_err(|e| {
                tracing::error!(error = %e, path = %p, "create index dir failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
            Index::open_in_dir(Path::new(&p)).map_err(|e| {
                tracing::error!(error = %e, "open on-disk index failed");
                StatusCode::INTERNAL_SERVER_ERROR
            })?
        }
        _ => Index::open_in_memory().map_err(|e| {
            tracing::error!(error = %e, "open in-memory index failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?,
    };
    let index = Arc::new(index);
    reg.insert(key, (state.config.clone(), index.clone()));
    Ok(index)
}

// ── Lazy reindex ─────────────────────────────────────────────────────────

/// Bring the content index up to date for one workspace: remove trashed files,
/// then (re)index every pending / changed head. Extractable formats are
/// decrypted and their text indexed via `dochub_core::extract`:
/// `md/txt/csv/json/yaml` (UTF-8) and `docx/xlsx/pptx` (OOXML text). `xlsm`
/// (opaque by policy) and `pdf` (extractor pending) are indexed by **title +
/// extension only**.
///
/// Idempotent and cheap in steady state (the candidate query returns nothing
/// once every head is indexed). A read failure on one file is logged and
/// skipped, leaving it `pending` for a later pass — one bad blob never fails
/// the whole search.
pub(crate) async fn reindex_pending(
    state: &HttpState,
    index: &Index,
    workspace_id: &str,
) -> Result<(), StatusCode> {
    let files = FileRepo::new(&state.db);

    // 1. Tombstone/trash → remove from the index.
    let trashed = files
        .list_trashed_indexed(workspace_id)
        .await
        .map_err(internal)?;
    for id in trashed {
        index.remove(&id).map_err(index_internal)?;
        files
            .set_index_state(&id, "trashed", None)
            .await
            .map_err(internal)?;
    }

    // 2. (Re)index pending / changed heads.
    let candidates = files
        .list_index_candidates(workspace_id, REINDEX_BATCH)
        .await
        .map_err(internal)?;

    for f in candidates {
        index_one(state, index, workspace_id, &f).await?;
    }
    Ok(())
}

/// Index a single non-trashed file's head into `index`: decrypt + extract its
/// text (or title-only for unsupported kinds), upsert, and record its
/// `index_state`. A head-read failure leaves the file `pending` (returns `Ok`
/// without touching the index) so one bad blob never fails the caller. Shared
/// by the lazy [`reindex_pending`] sweep and the background [`index_file_now`]
/// job path.
pub(crate) async fn index_one(
    state: &HttpState,
    index: &Index,
    workspace_id: &str,
    f: &dochub_db::File,
) -> Result<(), StatusCode> {
    let deks = WorkspaceDeks::new(state.db.clone(), state.config.master_kek.clone());
    let registry = Registry::new(state.db.clone(), state.storage.clone(), deks);
    let versions = FileVersionsRepo::new(&state.db);
    let files = FileRepo::new(&state.db);

    let ext = extension_of(&f.name);
    let kind = ext.as_deref().and_then(DocKind::from_extension);
    // Extractable = plain text (md/txt/csv/json/yaml) OR OOXML with a text
    // extractor (docx/xlsx/pptx). xlsm (opaque) and pdf remain title-only until
    // their extractors land (`dochub_core::extract`).
    let extractable = kind.is_some_and(dochub_core::supports_extraction);

    let (content, state_label) = if extractable {
        let kind = kind.expect("extractable implies a known kind");
        match registry
            .read_or_backfill_for_file(&f.id, INDEXER_AUTHOR)
            .await
        {
            Ok(bytes) => match dochub_core::extract_text(kind, &bytes) {
                Ok(text) => (text, "ready"),
                Err(e) => {
                    // Extractor rejected these bytes (e.g. a corrupt OOXML
                    // container): index title-only rather than retrying forever
                    // on bytes that will never parse.
                    tracing::warn!(file_id = %f.id, error = %e, "reindex: text extraction failed");
                    (String::new(), "unsupported")
                }
            },
            Err(e) => {
                // Missing/unreadable head — leave pending, try again later.
                tracing::warn!(file_id = %f.id, error = %e, "reindex: head read failed");
                return Ok(());
            }
        }
    } else {
        // xlsm/pdf (and any non-document): title/extension only.
        (String::new(), "unsupported")
    };

    // Head hash for staleness bookkeeping (empty when the file has no committed
    // version yet — a stable sentinel that won't re-trigger).
    let head_hash = versions
        .head(&f.id)
        .await
        .map_err(internal)?
        .map(|v| v.content_hash)
        .unwrap_or_default();

    let doc = IndexDoc {
        file_id: f.id.clone(),
        workspace_id: workspace_id.to_string(),
        title: f.name.clone(),
        extension: ext.unwrap_or_default(),
        content,
        content_hash: head_hash.clone(),
        modified_at: f.modified_at.unix_timestamp(),
    };
    index.upsert(&doc).map_err(index_internal)?;
    files
        .set_index_state(&f.id, state_label, Some(&head_hash))
        .await
        .map_err(internal)?;
    Ok(())
}

// ── Eager, single-file indexing (background worker path) ───────────────────

/// (Re)index one file by id, eagerly — the body of the `index_file` job the
/// durable queue runs after every commit. Resolves the process index, loads the
/// file, and either removes it (missing or trashed) or indexes its head via
/// [`index_one`]. Idempotent: safe to run repeatedly and safe to race with the
/// lazy [`reindex_pending`] sweep (both upsert the same `file_id`).
pub(crate) async fn index_file_now(state: &HttpState, file_id: &str) -> Result<(), StatusCode> {
    let index = index_for(state)?;
    let files = FileRepo::new(&state.db);

    let file = match files.find_by_id(file_id).await {
        Ok(f) => f,
        // Hard-deleted / unknown id — ensure it is not left in the index.
        Err(dochub_db::DbError::NotFound) => {
            index.remove(file_id).map_err(index_internal)?;
            return Ok(());
        }
        Err(e) => return Err(internal(e)),
    };

    // Trashed → tombstone out of the index (mirrors reindex_pending step 1).
    if file.trashed_at.is_some() {
        index.remove(file_id).map_err(index_internal)?;
        files
            .set_index_state(file_id, "trashed", None)
            .await
            .map_err(internal)?;
        return Ok(());
    }

    let Some(ws) = file.workspace_id.clone() else {
        // A pre-workspaces legacy row can't be tenant-scoped; skip it.
        return Ok(());
    };
    index_one(state, &index, &ws, &file).await
}

// ── Background worker: the `index_file` job handler ────────────────────────

/// The durable-queue handler for `index_file` jobs (payload = `file_id`).
/// Registered on the [`dochub_worker::Worker`] spawned by [`spawn_indexer`];
/// each job runs [`index_file_now`] off the request path.
#[derive(Clone)]
pub struct IndexFileHandler {
    state: HttpState,
}

impl IndexFileHandler {
    #[must_use]
    pub fn new(state: HttpState) -> Self {
        Self { state }
    }
}

impl std::fmt::Debug for IndexFileHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IndexFileHandler").finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl dochub_worker::JobHandler for IndexFileHandler {
    async fn handle(&self, job: &dochub_db::Job) -> dochub_worker::HandlerResult {
        let file_id = job.payload.trim();
        index_file_now(&self.state, file_id)
            .await
            .map_err(|code| format!("index_file {file_id}: {code}").into())
    }
}

/// Build and spawn the background indexer: a [`dochub_worker::Worker`] with the
/// `index_file` handler registered, draining the durable queue. Returns the
/// `JoinHandle` so the caller can abort it on shutdown (mirrors
/// `PresenceHub::spawn_sweep`).
#[must_use]
pub fn spawn_indexer(state: HttpState) -> tokio::task::JoinHandle<()> {
    let worker = dochub_worker::Worker::new(state.db.clone()).register(
        dochub_db::KIND_INDEX_FILE,
        std::sync::Arc::new(IndexFileHandler::new(state)),
    );
    std::sync::Arc::new(worker).spawn()
}

// ── Handler ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct ContentSearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
    /// Optional explicit workspace; must be one the caller belongs to.
    /// Defaults to the caller's active (Personal) workspace.
    pub workspace: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct ContentHit {
    pub file_id: String,
    pub title: String,
    /// Coarse content kind derived from the extension (markdown/pdf/…).
    pub kind: String,
    /// Highlighted excerpt around the match.
    pub snippet: String,
    pub score: f32,
    pub modified_at: String,
}

/// `GET /api/search/content?q=&limit=&workspace=` — session-authed,
/// workspace-scoped, permission-filtered content hits.
pub(crate) async fn content_search(
    State(s): State<HttpState>,
    session: AuthSession,
    Query(q): Query<ContentSearchQuery>,
) -> Result<Json<Vec<ContentHit>>, StatusCode> {
    let query = q.q.as_deref().map_or("", str::trim).to_string();
    let limit = q.limit.unwrap_or(20).clamp(1, 50);

    // Workspace scope — resolve_active_workspace enforces membership.
    let workspace = resolve_active_workspace(&s.db, &session.user_id, q.workspace.as_deref())
        .await
        .map_err(ws_status)?;

    // Lazy: catch the index up before querying so results are fresh.
    let index = index_for(&s)?;
    reindex_pending(&s, &index, &workspace).await?;

    if query.is_empty() {
        return Ok(Json(vec![]));
    }

    let hits = index
        .search(&workspace, &query, limit)
        .map_err(index_internal)?;

    // Permission filter + enrich from the DB. The index is already
    // workspace-scoped; we re-check workspace + trashed as defense in depth and
    // to pick up any row trashed since the last reindex. `readable_scope`
    // ACL-filters so a hit the caller may not view never leaks.
    let scope = dochub_authz::readable_scope(&s.db, &session.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let files = FileRepo::new(&s.db);
    let mut out = Vec::with_capacity(hits.len());
    for h in hits {
        let Ok(file) = files.find_by_id(&h.file_id).await else {
            continue;
        };
        if file.workspace_id.as_deref() != Some(workspace.as_str())
            || file.trashed_at.is_some()
            || !scope.can_view_file(&file)
        {
            continue;
        }
        out.push(ContentHit {
            file_id: h.file_id,
            title: h.title,
            kind: kind_of(&file),
            snippet: h.snippet,
            score: h.score,
            modified_at: file.modified_at.format(&Rfc3339).unwrap_or_default(),
        });
    }
    Ok(Json(out))
}

// ── Helpers ──────────────────────────────────────────────────────────────

fn internal(e: dochub_db::DbError) -> StatusCode {
    tracing::error!(error = %e, "content search db error");
    StatusCode::INTERNAL_SERVER_ERROR
}

fn index_internal(e: dochub_index::IndexError) -> StatusCode {
    tracing::error!(error = %e, "content index error");
    StatusCode::INTERNAL_SERVER_ERROR
}

fn ws_status(e: crate::workspaces::WsError) -> StatusCode {
    use crate::workspaces::WsError;
    match e {
        WsError::Forbidden | WsError::NotAMember => StatusCode::FORBIDDEN,
        WsError::NotFound | WsError::Personal => StatusCode::NOT_FOUND,
        WsError::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
        WsError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Lowercase filename extension, or `None` when there is none.
fn extension_of(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = base.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

/// Coarse content-kind label for the SPA, derived from the extension.
fn kind_of(file: &File) -> String {
    let ext = extension_of(&file.name);
    match ext.as_deref() {
        Some("md") => "markdown",
        Some("txt") => "text",
        Some("csv") => "csv",
        Some("json") => "json",
        Some("yaml" | "yml") => "yaml",
        Some("pdf") => "pdf",
        Some("docx") => "document",
        Some("xlsx" | "xlsm") => "spreadsheet",
        Some("pptx") => "presentation",
        _ => "file",
    }
    .to_string()
}
