//! Shared search filter + sort types used by `FileRepo`, `FolderRepo`,
//! and `NotesRepo`. The HTTP handler (`dochub-http::search`) builds a
//! `SearchFilters` from request params and hands it to each repo; the
//! repos translate it to SQL and return rows that the handler unions +
//! cursor-paginates.
//!
//! Spec: `docs/ux/12-search-surface.md` §"Pagination" + §"Filter
//! surface" + `docs/research/16-scale-infra.md` §"Search backend wire
//! contract".

use serde::{Deserialize, Serialize};

/// Crate-internal: dynamic bind value for the search-SQL builder.
/// Lets the per-repo query builders accumulate heterogeneous binds in
/// one Vec, then walk it in order against the placeholders.
#[derive(Debug, Clone)]
pub(crate) enum BindValue {
    Str(String),
    I64(i64),
}

/// Emit `?, ?, ?` for `n` placeholders (the `IN (…)` body). Returns an
/// empty string when `n` is zero — callers should not invoke this with
/// an empty collection (IN with no values is a syntax error).
#[must_use]
pub(crate) fn placeholders(n: usize) -> String {
    if n == 0 {
        return String::new();
    }
    let mut out = String::with_capacity(n * 2);
    out.push('?');
    for _ in 1..n {
        out.push_str(", ?");
    }
    out
}

/// Canonical content-type buckets. The handler accepts these names from
/// the `?type=` CSV and the repos translate them to SQL predicates
/// (each repo's `content_type` semantics differ — files have a stored
/// `content_type`; folders have none; notes have an implicit "note"
/// bucket).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypeBucket {
    Folder,
    Document,
    Spreadsheet,
    Pdf,
    Image,
    Video,
    Audio,
    Markdown,
    Archive,
    Other,
    /// A bucket the `NotesRepo` claims; not produced by `FileRepo`.
    Note,
}

impl TypeBucket {
    /// Parse one bucket name. Returns `None` for unknown strings — the
    /// handler treats unknowns as a no-op (no 400) so future client
    /// values don't break old servers.
    #[must_use]
    pub fn from_name(s: &str) -> Option<Self> {
        match s.trim() {
            "folder" => Some(Self::Folder),
            "document" | "doc" => Some(Self::Document),
            "spreadsheet" | "sheet" | "xlsx" => Some(Self::Spreadsheet),
            "pdf" => Some(Self::Pdf),
            "image" | "img" => Some(Self::Image),
            "video" => Some(Self::Video),
            "audio" => Some(Self::Audio),
            "markdown" | "md" => Some(Self::Markdown),
            "archive" | "zip" => Some(Self::Archive),
            "other" => Some(Self::Other),
            "note" => Some(Self::Note),
            _ => None,
        }
    }

    /// The MIME prefix(es) this bucket matches against `files.content_type`.
    /// Returns an empty slice for buckets that don't map to a MIME-prefix
    /// match (Folder / Note / Other — those are routed differently).
    #[must_use]
    pub fn content_type_predicates(self) -> &'static [&'static str] {
        match self {
            Self::Document => &[
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/msword",
            ],
            Self::Spreadsheet => &[
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
            ],
            Self::Pdf => &["application/pdf"],
            Self::Image => &["image/"],
            Self::Video => &["video/"],
            Self::Audio => &["audio/"],
            Self::Markdown => &["text/markdown"],
            Self::Archive => &[
                "application/zip",
                "application/gzip",
                "application/x-tar",
                "application/x-7z-compressed",
            ],
            _ => &[],
        }
    }
}

/// Sort key. `Relevance` is requested by the SPA but the sqlite path
/// can't compute BM25; the handler maps it to `Modified` and reflects
/// the fallback in `SearchResponse::sort_applied`. OpenSearch path
/// honours `Relevance` natively.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortBy {
    #[default]
    Relevance,
    Modified,
    Created,
    Name,
    Size,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    #[default]
    Desc,
}

/// All the filter knobs a `/api/search` request can carry. Repos
/// translate this into their own SQL; unknown / inapplicable filters
/// are silently no-ops on a given repo (e.g. `size_min` on folders).
#[derive(Debug, Clone, Default)]
pub struct SearchFilters {
    /// Lowercased query string. May be empty when at least one other
    /// filter is set (the handler guarantees this invariant).
    pub q: String,
    /// One or more workspace ids the caller is allowed to read from.
    /// Required — the handler builds this from the caller's
    /// memberships intersected with any `?workspace=` params.
    pub workspace_ids: Vec<String>,
    /// Optional folder scope — when set, results are restricted to
    /// rows whose `parent_id == folder_id` (files + folders only;
    /// notes ignore this).
    pub folder_id: Option<String>,
    /// Empty = any. Non-empty = must match one of these buckets.
    pub types: Vec<TypeBucket>,
    /// Empty = any. Non-empty = must be owned by one of these users.
    pub owner_ids: Vec<String>,
    pub modified_after: Option<time::OffsetDateTime>,
    pub modified_before: Option<time::OffsetDateTime>,
    pub created_after: Option<time::OffsetDateTime>,
    pub created_before: Option<time::OffsetDateTime>,
    pub size_min: Option<u64>,
    pub size_max: Option<u64>,
    /// `None` = either; `Some(true)` = must have ≥ 1 active share
    /// link; `Some(false)` = must have zero.
    pub has_share_link: Option<bool>,
    /// `None` = exclude trashed (default); `Some(true)` = only trashed;
    /// `Some(false)` = only non-trashed (explicit).
    pub in_trash: Option<bool>,
}

/// Pagination control for one repo call. The handler computes a single
/// canonical `last_value` from the cursor + sort, then asks each repo
/// for the next slice past it.
#[derive(Debug, Clone)]
pub struct SearchPaging {
    pub sort_by: SortBy,
    pub sort_dir: SortDir,
    /// `(last_sort_value_string, last_id)` from a cursor; `None` for
    /// the first page. Repos compare ROW(sort_value, id) > / < this
    /// tuple to slice past the previously-seen page.
    pub after: Option<(String, String)>,
    /// Page size. Repos return at most this many rows.
    pub limit: i64,
}

impl SearchPaging {
    /// Effective ORDER BY column name on each table. Maps `Relevance`
    /// onto `modified_at` for the sqlite path (the handler will tag
    /// the response so the SPA knows the fallback happened).
    #[must_use]
    pub fn order_column(&self) -> &'static str {
        match self.sort_by {
            SortBy::Relevance | SortBy::Modified => "modified_at",
            SortBy::Created => "created_at",
            SortBy::Name => "name",
            SortBy::Size => "size",
        }
    }

    #[must_use]
    pub fn order_sql(&self) -> &'static str {
        match self.sort_dir {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_bucket_aliases() {
        assert_eq!(TypeBucket::from_name("pdf"), Some(TypeBucket::Pdf));
        assert_eq!(TypeBucket::from_name("DOC"), None); // case-sensitive on purpose
        assert_eq!(TypeBucket::from_name("doc"), Some(TypeBucket::Document));
        assert_eq!(TypeBucket::from_name("xlsx"), Some(TypeBucket::Spreadsheet));
        assert_eq!(TypeBucket::from_name("img"), Some(TypeBucket::Image));
        assert_eq!(TypeBucket::from_name("madeup"), None);
    }

    #[test]
    fn content_type_predicates_for_image_match_prefix() {
        let preds = TypeBucket::Image.content_type_predicates();
        assert_eq!(preds, &["image/"]);
    }

    #[test]
    fn folder_and_note_buckets_have_no_mime_predicates() {
        assert!(TypeBucket::Folder.content_type_predicates().is_empty());
        assert!(TypeBucket::Note.content_type_predicates().is_empty());
    }

    #[test]
    fn order_column_maps_relevance_to_modified() {
        let p = SearchPaging {
            sort_by: SortBy::Relevance,
            sort_dir: SortDir::Desc,
            after: None,
            limit: 30,
        };
        assert_eq!(p.order_column(), "modified_at");
        assert_eq!(p.order_sql(), "DESC");
    }
}
