//! The `embed_file` background job: chunk + embed a committed head into the
//! `embeddings` table for RAG retrieval (Phase 5).
//!
//! Runs on the same `dochub-worker` queue as `index_file` (registered by
//! [`crate::spawn_indexer`]), enqueued alongside it on every commit. It reuses
//! the extraction pipeline (`dochub_core::extract`) to get plaintext, chunks +
//! embeds it (`dochub-ai`), and stores the vectors via
//! [`dochub_db::EmbeddingRepo`]. Idempotent and cheap in steady state: a file
//! whose head is already embedded at the current `content_hash` is skipped.
//!
//! The embedder is pluggable; the offline [`dochub_ai::LocalEmbedder`] is the
//! default so the pipeline needs no network (a hosted embedder slots in behind
//! the same trait later).

use std::sync::Arc;

use dochub_ai::{chunk_text, ChunkConfig, Embedder, LocalEmbedder};
use dochub_core::DocKind;
use dochub_db::{EmbeddingRepo, FileRepo, FileVersionsRepo, NewEmbedding, Registry, WorkspaceDeks};
use dochub_worker::HandlerResult;

use crate::content_search::extension_of;
use crate::HttpState;

/// Author recorded on any legacy-blob backfill an embed read triggers (mirrors
/// the indexer's `system:indexer`). Not a real user.
const EMBED_AUTHOR: &str = "system:embedder";

/// (Re)embed one file by id — the body of the `embed_file` job. Loads the file,
/// removes embeddings for a trashed/missing file, else extracts its head text,
/// chunks + embeds it, and replaces the file's stored vectors. A file with no
/// extractable text (or an unchanged head already embedded) is a no-op.
pub(crate) async fn embed_file_now(
    state: &HttpState,
    embedder: &dyn Embedder,
    file_id: &str,
) -> HandlerResult {
    let files = FileRepo::new(&state.db);
    let embeddings = EmbeddingRepo::new(&state.db);

    let file = match files.find_by_id(file_id).await {
        Ok(f) => f,
        Err(dochub_db::DbError::NotFound) => {
            embeddings.delete_for_file(file_id).await?;
            return Ok(());
        }
        Err(e) => return Err(e.into()),
    };

    // Trashed → drop its vectors.
    if file.trashed_at.is_some() {
        embeddings.delete_for_file(file_id).await?;
        return Ok(());
    }
    let Some(ws) = file.workspace_id.clone() else {
        return Ok(()); // legacy row without a workspace — can't scope.
    };

    // Only formats with extractable text carry anything to embed.
    let kind = extension_of(&file.name)
        .as_deref()
        .and_then(DocKind::from_extension);
    let Some(kind) = kind.filter(|k| dochub_core::supports_extraction(*k)) else {
        return Ok(());
    };

    // Staleness: the head hash the current bytes chain to. Skip if we already
    // embedded this exact head.
    let versions = FileVersionsRepo::new(&state.db);
    let head_hash = versions
        .head(file_id)
        .await?
        .map(|v| v.content_hash)
        .unwrap_or_default();
    if head_hash.is_empty() {
        return Ok(()); // nothing committed yet.
    }
    if embeddings.content_hash_for_file(file_id).await?.as_deref() == Some(head_hash.as_str()) {
        return Ok(()); // already embedded at this head.
    }

    // Decrypt head + extract text.
    let deks = WorkspaceDeks::new(state.db.clone(), state.config.master_kek.clone())
        .with_next_kek(state.config.master_kek_next.clone());
    let registry = Registry::new(state.db.clone(), state.storage.clone(), deks);
    let bytes = registry
        .read_or_backfill_for_file(file_id, EMBED_AUTHOR)
        .await
        .map_err(|e| format!("embed: head read failed for {file_id}: {e}"))?;
    let text = match dochub_core::extract_text(kind, &bytes) {
        Ok(t) => t,
        // Bytes that will never parse (e.g. corrupt OOXML) — nothing to embed.
        Err(_) => {
            embeddings.delete_for_file(file_id).await?;
            return Ok(());
        }
    };

    let chunks = chunk_text(&text, &ChunkConfig::default());
    if chunks.is_empty() {
        embeddings.delete_for_file(file_id).await?;
        return Ok(());
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embedder
        .embed(&texts)
        .await
        .map_err(|e| format!("embed: provider failed for {file_id}: {e}"))?;
    let dims = embedder.dims() as i64;
    let new: Vec<NewEmbedding> = chunks
        .iter()
        .zip(vectors)
        .map(|(c, vector)| NewEmbedding {
            chunk_index: c.index as i64,
            vector,
            chunk_text: c.text.clone(),
            char_start: c.char_start as i64,
            char_end: c.char_end as i64,
        })
        .collect();
    embeddings
        .replace_for_file(file_id, &ws, &head_hash, dims, &new)
        .await?;
    Ok(())
}

/// The durable-queue handler for `embed_file` jobs (payload = `file_id`).
/// Registered on the worker by [`crate::spawn_indexer`]; each job runs
/// [`embed_file_now`] off the request path with the configured embedder.
#[derive(Clone)]
pub struct EmbedFileHandler {
    state: HttpState,
    embedder: Arc<dyn Embedder>,
}

impl EmbedFileHandler {
    /// New handler using the offline [`LocalEmbedder`] default.
    #[must_use]
    pub fn new(state: HttpState) -> Self {
        Self {
            state,
            embedder: Arc::new(LocalEmbedder::default()),
        }
    }

    /// New handler with an explicit embedder (e.g. a hosted provider).
    #[must_use]
    pub fn with_embedder(state: HttpState, embedder: Arc<dyn Embedder>) -> Self {
        Self { state, embedder }
    }

    /// The embedder's dimensionality — used by search to embed the query the
    /// same way.
    #[must_use]
    pub fn dims(&self) -> usize {
        self.embedder.dims()
    }
}

impl std::fmt::Debug for EmbedFileHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EmbedFileHandler")
            .field("dims", &self.embedder.dims())
            .finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl dochub_worker::JobHandler for EmbedFileHandler {
    async fn handle(&self, job: &dochub_db::Job) -> HandlerResult {
        embed_file_now(&self.state, self.embedder.as_ref(), job.payload.trim()).await
    }
}
