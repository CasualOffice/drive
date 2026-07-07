//! `dochub-index` — the Tantivy full-text **content** index (Phase 3 build
//! spec §1, PR P3.1).
//!
//! This crate wraps a single [`tantivy`] index behind a small, workspace-aware
//! API so nothing above it touches Tantivy directly (mirroring how
//! `dochub-storage` hides OpenDAL). It indexes document *content* — the
//! decrypted head bytes of a file — not just its name, which is what lets
//! search answer "which document mentions X?".
//!
//! Scope of this crate:
//!
//! - [`Index`] — open an index (on disk or in-memory), [`Index::upsert`] a
//!   document, [`Index::remove`] one by `file_id`, and [`Index::search`] a
//!   workspace-scoped query returning scored [`Hit`]s with a highlighted
//!   snippet.
//! - It is deliberately ignorant of encryption, storage, and the DB. The
//!   *indexing strategy* (which files to (re)index, decrypting their head,
//!   extracting text) lives one layer up in `dochub-http` so this crate stays
//!   a pure, unit-testable search primitive.
//!
//! Security note (build spec §1, D4): the Tantivy store holds *plaintext*
//! document content and is therefore as sensitive as the decrypted document.
//! It must live on the trusted server, access-controlled, ideally on encrypted
//! storage. This crate never persists plaintext anywhere but the Tantivy store
//! it is handed.

#![forbid(unsafe_code)]

use std::path::Path;
use std::sync::{Arc, Mutex};

use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, Value, FAST, INDEXED, STORED, STRING, TEXT,
};
use tantivy::{
    doc, Index as TantivyIndex, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
};
use thiserror::Error;

/// Writer heap budget. Tantivy requires at least ~3 MiB per thread; 30 MiB is
/// comfortable for the single-writer, low-volume lazy path we run in P3.1 and
/// keeps commits fast in tests.
const WRITER_HEAP_BYTES: usize = 30_000_000;

/// Snippet length target, in characters, for the highlighted excerpt.
const SNIPPET_MAX_CHARS: usize = 200;

/// Errors surfaced by the content index. None carry plaintext beyond a
/// caller-supplied query string in the query-parse case.
#[derive(Debug, Error)]
pub enum IndexError {
    #[error("tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[error("query parse error: {0}")]
    QueryParse(String),
    #[error("writer lock poisoned")]
    WriterPoisoned,
}

/// A document to (re)index. One per file head; `file_id` is the stable primary
/// key an [`Index::upsert`] replaces on.
#[derive(Debug, Clone)]
pub struct IndexDoc {
    /// Stable file id — the index primary key.
    pub file_id: String,
    /// Workspace the file lives in. Every [`Index::search`] filters on this so
    /// one tenant never sees another's content.
    pub workspace_id: String,
    /// Display name / title (tokenized + searchable).
    pub title: String,
    /// Lowercase filename extension (`md`, `pdf`, …); exact-match filterable.
    pub extension: String,
    /// Extracted plaintext content. Empty for formats whose extraction is a
    /// documented follow-up (docx/xlsx/pptx/pdf — indexed by title only in
    /// P3.1).
    pub content: String,
    /// `content_hash` of the head version this doc was built from — lets the
    /// caller skip re-indexing unchanged heads.
    pub content_hash: String,
    /// Head `modified_at`, epoch seconds. Stored for callers that want to
    /// order or display it; not used for scoring.
    pub modified_at: i64,
}

/// One search result: the file, its title, a highlighted snippet, and the BM25
/// score. The HTTP layer enriches this with `kind`/`modified_at` from the DB
/// and applies per-file permission filtering.
#[derive(Debug, Clone)]
pub struct Hit {
    pub file_id: String,
    pub title: String,
    /// A short excerpt around the match with `<b>…</b>` around matched terms.
    /// Empty when the match was on the title of a content-less (unsupported)
    /// document.
    pub snippet: String,
    pub score: f32,
}

/// The set of schema fields, resolved once at open.
#[derive(Debug, Clone, Copy)]
struct Fields {
    file_id: Field,
    workspace_id: Field,
    title: Field,
    extension: Field,
    content: Field,
    content_hash: Field,
    modified_at: Field,
}

fn build_schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    // `file_id`: stored, exact-match (STRING = not tokenized) so we can delete
    // by term and echo it back on a hit.
    let file_id = b.add_text_field("file_id", STRING | STORED);
    // `workspace_id`: exact-match tenant filter, also stored.
    let workspace_id = b.add_text_field("workspace_id", STRING | STORED);
    // `title`: tokenized + stored (searchable + echoed on hits).
    let title = b.add_text_field("title", TEXT | STORED);
    // `extension`: exact-match, stored.
    let extension = b.add_text_field("extension", STRING | STORED);
    // `content`: tokenized + stored (stored so we can generate snippets).
    let content = b.add_text_field("content", TEXT | STORED);
    // `content_hash`: stored only — never queried, just echoed for staleness.
    let content_hash = b.add_text_field("content_hash", STORED);
    // `modified_at`: stored + fast (epoch seconds).
    let modified_at = b.add_i64_field("modified_at", STORED | INDEXED | FAST);
    let schema = b.build();
    (
        schema,
        Fields {
            file_id,
            workspace_id,
            title,
            extension,
            content,
            content_hash,
            modified_at,
        },
    )
}

/// The content index. Cheap to clone — the underlying Tantivy index, reader,
/// and writer are shared behind `Arc`. A single shared [`IndexWriter`] guarded
/// by a `Mutex` serializes writes (P3.1 is single-writer; a bounded background
/// worker is the scale follow-up).
#[derive(Clone)]
pub struct Index {
    inner: TantivyIndex,
    reader: IndexReader,
    writer: Arc<Mutex<IndexWriter>>,
    fields: Fields,
}

impl std::fmt::Debug for Index {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Keep opaque — the store holds plaintext content.
        f.debug_struct("Index").finish_non_exhaustive()
    }
}

impl Index {
    /// Open (or create) an on-disk index rooted at `path`. The directory must
    /// exist; a fresh directory is initialized with the schema, an existing one
    /// is opened and its schema is trusted to match.
    pub fn open_in_dir(path: &Path) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let dir = tantivy::directory::MmapDirectory::open(path)
            .map_err(|e| IndexError::QueryParse(e.to_string()))?;
        let inner = TantivyIndex::open_or_create(dir, schema)?;
        Self::from_index(inner, fields)
    }

    /// Open an in-memory (RAM-backed) index. Used by tests and as the default
    /// when no `DOCHUB_INDEX_PATH` is configured.
    pub fn open_in_memory() -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let inner = TantivyIndex::create_in_ram(schema);
        Self::from_index(inner, fields)
    }

    fn from_index(inner: TantivyIndex, fields: Fields) -> Result<Self, IndexError> {
        let writer: IndexWriter = inner.writer(WRITER_HEAP_BYTES)?;
        let reader = inner
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            inner,
            reader,
            writer: Arc::new(Mutex::new(writer)),
            fields,
        })
    }

    /// Insert or replace the document for `doc.file_id`. Idempotent: deletes any
    /// existing document with the same `file_id` term, then adds the new one and
    /// commits. Safe to call repeatedly (the reindex path does).
    pub fn upsert(&self, doc: &IndexDoc) -> Result<(), IndexError> {
        let f = self.fields;
        let mut writer = self.writer.lock().map_err(|_| IndexError::WriterPoisoned)?;
        writer.delete_term(Term::from_field_text(f.file_id, &doc.file_id));
        writer.add_document(doc! {
            f.file_id => doc.file_id.clone(),
            f.workspace_id => doc.workspace_id.clone(),
            f.title => doc.title.clone(),
            f.extension => doc.extension.clone(),
            f.content => doc.content.clone(),
            f.content_hash => doc.content_hash.clone(),
            f.modified_at => doc.modified_at,
        })?;
        writer.commit()?;
        drop(writer);
        self.reader.reload()?;
        Ok(())
    }

    /// Remove the document for `file_id` (tombstone / trash). A no-op if the id
    /// is not present. Commits so subsequent searches reflect the removal.
    pub fn remove(&self, file_id: &str) -> Result<(), IndexError> {
        let mut writer = self.writer.lock().map_err(|_| IndexError::WriterPoisoned)?;
        writer.delete_term(Term::from_field_text(self.fields.file_id, file_id));
        writer.commit()?;
        drop(writer);
        self.reader.reload()?;
        Ok(())
    }

    /// Workspace-scoped full-text search over `title` + `content`. Returns up to
    /// `limit` scored [`Hit`]s, highest score first, each with a highlighted
    /// snippet drawn from the content field. An empty or unparseable query
    /// yields no hits (never an error the caller must special-case beyond the
    /// query-parse error).
    pub fn search(
        &self,
        workspace_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<Hit>, IndexError> {
        let query = query.trim();
        if query.is_empty() || limit == 0 {
            return Ok(vec![]);
        }
        let f = self.fields;
        let searcher = self.reader.searcher();

        // User query over title + content.
        let mut parser = QueryParser::for_index(&self.inner, vec![f.title, f.content]);
        parser.set_conjunction_by_default();
        let user_query: Box<dyn Query> = parser
            .parse_query(query)
            .map_err(|e| IndexError::QueryParse(e.to_string()))?;

        // Tenant filter — exact workspace term, required.
        let ws_query: Box<dyn Query> = Box::new(TermQuery::new(
            Term::from_field_text(f.workspace_id, workspace_id),
            IndexRecordOption::Basic,
        ));

        let scoped: BooleanQuery =
            BooleanQuery::new(vec![(Occur::Must, ws_query), (Occur::Must, user_query)]);

        // Snippet generator over the content field, driven by the user query so
        // matched terms are highlighted.
        let snippet_gen =
            tantivy::snippet::SnippetGenerator::create(&searcher, &scoped, f.content).ok();

        let top = searcher.search(&scoped, &TopDocs::with_limit(limit).order_by_score())?;
        let mut hits = Vec::with_capacity(top.len());
        for (score, addr) in top {
            let stored: TantivyDocument = searcher.doc(addr)?;
            let file_id = first_text(&stored, f.file_id).unwrap_or_default();
            let title = first_text(&stored, f.title).unwrap_or_default();
            let snippet = snippet_gen
                .as_ref()
                .map(|g| {
                    let s = g.snippet_from_doc(&stored);
                    let html = s.to_html();
                    if html.is_empty() {
                        // No content match (e.g. title-only hit): fall back to a
                        // plain leading excerpt of the content, if any.
                        truncate_chars(&first_text(&stored, f.content).unwrap_or_default())
                    } else {
                        html
                    }
                })
                .unwrap_or_default();
            hits.push(Hit {
                file_id,
                title,
                snippet,
                score,
            });
        }
        Ok(hits)
    }

    /// Number of documents currently indexed for `workspace_id`. Test/observability helper.
    pub fn doc_count(&self, workspace_id: &str) -> Result<usize, IndexError> {
        let searcher = self.reader.searcher();
        let ws_query = TermQuery::new(
            Term::from_field_text(self.fields.workspace_id, workspace_id),
            IndexRecordOption::Basic,
        );
        let n = searcher.search(&ws_query, &tantivy::collector::Count)?;
        Ok(n)
    }
}

/// First stored text value of `field` in `doc`, if any.
fn first_text(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Truncate to at most [`SNIPPET_MAX_CHARS`] on a char boundary, appending an
/// ellipsis when clipped.
fn truncate_chars(s: &str) -> String {
    if s.chars().count() <= SNIPPET_MAX_CHARS {
        return s.to_string();
    }
    let mut out: String = s.chars().take(SNIPPET_MAX_CHARS).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: &str, ws: &str, title: &str, ext: &str, content: &str) -> IndexDoc {
        IndexDoc {
            file_id: id.into(),
            workspace_id: ws.into(),
            title: title.into(),
            extension: ext.into(),
            content: content.into(),
            content_hash: format!("hash-of-{id}"),
            modified_at: 0,
        }
    }

    #[test]
    fn finds_by_content_not_name() {
        let idx = Index::open_in_memory().unwrap();
        idx.upsert(&doc(
            "f1",
            "ws1",
            "Meeting notes.md",
            "md",
            "The quarterly revenue exceeded expectations by a wide margin.",
        ))
        .unwrap();
        idx.upsert(&doc(
            "f2",
            "ws1",
            "Unrelated.md",
            "md",
            "grocery list milk eggs",
        ))
        .unwrap();

        let hits = idx.search("ws1", "revenue", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file_id, "f1");
        assert!(hits[0].snippet.contains("revenue"));
    }

    #[test]
    fn workspace_isolation() {
        let idx = Index::open_in_memory().unwrap();
        idx.upsert(&doc("a", "wsA", "a.md", "md", "shared secret phrase alpha"))
            .unwrap();
        idx.upsert(&doc("b", "wsB", "b.md", "md", "shared secret phrase alpha"))
            .unwrap();

        let a = idx.search("wsA", "alpha", 10).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].file_id, "a");

        let b = idx.search("wsB", "alpha", 10).unwrap();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].file_id, "b");
    }

    #[test]
    fn upsert_replaces_prior_content() {
        let idx = Index::open_in_memory().unwrap();
        idx.upsert(&doc("f1", "ws1", "doc.md", "md", "old term zebra"))
            .unwrap();
        assert_eq!(idx.search("ws1", "zebra", 10).unwrap().len(), 1);

        // New version: different content, same file_id.
        idx.upsert(&doc("f1", "ws1", "doc.md", "md", "new term giraffe"))
            .unwrap();
        assert!(idx.search("ws1", "zebra", 10).unwrap().is_empty());
        assert_eq!(idx.search("ws1", "giraffe", 10).unwrap().len(), 1);
        // Still a single doc for the workspace.
        assert_eq!(idx.doc_count("ws1").unwrap(), 1);
    }

    #[test]
    fn remove_deletes_from_index() {
        let idx = Index::open_in_memory().unwrap();
        idx.upsert(&doc("f1", "ws1", "doc.md", "md", "findable content"))
            .unwrap();
        assert_eq!(idx.search("ws1", "findable", 10).unwrap().len(), 1);
        idx.remove("f1").unwrap();
        assert!(idx.search("ws1", "findable", 10).unwrap().is_empty());
        assert_eq!(idx.doc_count("ws1").unwrap(), 0);
    }

    #[test]
    fn empty_query_is_no_hits() {
        let idx = Index::open_in_memory().unwrap();
        idx.upsert(&doc("f1", "ws1", "doc.md", "md", "content"))
            .unwrap();
        assert!(idx.search("ws1", "", 10).unwrap().is_empty());
        assert!(idx.search("ws1", "   ", 10).unwrap().is_empty());
    }

    #[test]
    fn title_match_also_returned() {
        let idx = Index::open_in_memory().unwrap();
        // Unsupported format: content is empty, only the title carries the term.
        idx.upsert(&doc("f1", "ws1", "Budget spreadsheet", "xlsx", ""))
            .unwrap();
        let hits = idx.search("ws1", "budget", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file_id, "f1");
    }

    #[test]
    fn on_disk_index_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let idx = Index::open_in_dir(dir.path()).unwrap();
        idx.upsert(&doc("f1", "ws1", "d.md", "md", "persistent needle"))
            .unwrap();
        assert_eq!(idx.search("ws1", "needle", 10).unwrap().len(), 1);
    }
}
