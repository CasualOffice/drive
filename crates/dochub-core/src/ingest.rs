//! Documents-only ingest allowlist guard (Phase 0 build spec §2).
//!
//! Doc-Hub is a *document* registry: the narrow, authoritative allowlist below
//! is what makes at-rest encryption and content indexing tractable. Every
//! ingest path — proxy multipart upload and any direct-to-storage finalize —
//! must funnel through [`guard`]; there are no per-handler copies of the list.
//!
//! The guard checks two independent things and rejects on either:
//! 1. **Extension** — the filename extension must be on [`ALLOWED_EXTENSIONS`].
//! 2. **Magic-byte sniff** — the leading bytes must match the format:
//!    - OOXML (`docx`/`xlsx`/`xlsm`/`pptx`) and `pdf` carry real signatures,
//!      verified with the `infer` crate (ZIP/`PK` for OOXML, `%PDF` for pdf).
//!    - Text formats (`md`/`txt`/`csv`/`json`/`yaml`/`yml`) have no magic, so we
//!      require the bytes to be valid UTF-8.
//!
//! A mismatch, an unknown type, or empty input is rejected — never quarantined,
//! and the function never panics.
//!
//! Note on OOXML disambiguation: `docx`, `xlsx`, `xlsm`, and `pptx` are all ZIP
//! containers sharing the same `PK` magic. The sniff only proves "this is a ZIP
//! container"; the concrete [`DocKind`] is decided by the (already-validated)
//! filename extension. This is deliberate and documented — the guard is a
//! gate, not a full OOXML part-tree validator.

use thiserror::Error;

/// The authoritative documents-only allowlist: the only filename extensions
/// Doc-Hub will ingest. This is the single source of truth — handlers must not
/// keep their own copies. `yml` is accepted as an alias of `yaml`.
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "docx", "xlsx", "xlsm", "pptx", "pdf", "md", "txt", "csv", "json", "yaml", "yml",
];

/// A document kind accepted by the ingest allowlist.
///
/// `xlsm` and `pptx` are accepted but treated as opaque (not editor-opened).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DocKind {
    /// Word Open XML document (`docx`).
    Docx,
    /// Excel Open XML spreadsheet (`xlsx`).
    Xlsx,
    /// Excel Open XML macro-enabled spreadsheet (`xlsm`); opaque.
    Xlsm,
    /// PowerPoint Open XML presentation (`pptx`); opaque.
    Pptx,
    /// Portable Document Format (`pdf`).
    Pdf,
    /// Markdown text (`md`).
    Md,
    /// Plain text (`txt`).
    Txt,
    /// Comma-separated values (`csv`).
    Csv,
    /// JSON text (`json`).
    Json,
    /// YAML text (`yaml`/`yml`).
    Yaml,
}

impl DocKind {
    /// Maps a lowercase filename extension to its [`DocKind`], or `None` if the
    /// extension is not on the allowlist.
    #[must_use]
    pub fn from_extension(ext: &str) -> Option<Self> {
        Some(match ext {
            "docx" => Self::Docx,
            "xlsx" => Self::Xlsx,
            "xlsm" => Self::Xlsm,
            "pptx" => Self::Pptx,
            "pdf" => Self::Pdf,
            "md" => Self::Md,
            "txt" => Self::Txt,
            "csv" => Self::Csv,
            "json" => Self::Json,
            "yaml" | "yml" => Self::Yaml,
            _ => return None,
        })
    }

    /// The magic-byte family this kind is sniffed against.
    fn sniff(self) -> Sniff {
        match self {
            Self::Docx | Self::Xlsx | Self::Xlsm | Self::Pptx => Sniff::Ooxml,
            Self::Pdf => Sniff::Pdf,
            Self::Md | Self::Txt | Self::Csv | Self::Json | Self::Yaml => Sniff::Utf8Text,
        }
    }
}

/// How a [`DocKind`]'s bytes are validated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sniff {
    /// ZIP/`PK` container (all OOXML formats).
    Ooxml,
    /// `%PDF` signature.
    Pdf,
    /// No magic; must be valid UTF-8.
    Utf8Text,
}

/// Why an ingest was rejected. Rejections are terminal (HTTP `415`), never a
/// quarantine.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum IngestError {
    /// The upload had no bytes.
    #[error("empty input")]
    EmptyInput,
    /// The filename had no extension to check.
    #[error("missing file extension")]
    MissingExtension,
    /// The extension is not on the documents-only allowlist.
    #[error("disallowed extension: .{0}")]
    DisallowedExtension(String),
    /// The bytes do not match the format claimed by the extension.
    #[error("content does not match extension")]
    ContentMismatch,
}

/// Guards a single ingest: validates `name`'s extension against the allowlist
/// and sniffs `head_bytes` (the leading bytes of the upload) against the
/// format that extension claims.
///
/// Returns the resolved [`DocKind`] on success, or an [`IngestError`] describing
/// the rejection. Never panics.
///
/// # Errors
///
/// - [`IngestError::EmptyInput`] — `head_bytes` is empty.
/// - [`IngestError::MissingExtension`] — `name` has no extension.
/// - [`IngestError::DisallowedExtension`] — extension not on [`ALLOWED_EXTENSIONS`].
/// - [`IngestError::ContentMismatch`] — bytes don't match the claimed format.
pub fn guard(name: &str, head_bytes: &[u8]) -> Result<DocKind, IngestError> {
    if head_bytes.is_empty() {
        return Err(IngestError::EmptyInput);
    }

    let ext = extension(name).ok_or(IngestError::MissingExtension)?;
    let kind = DocKind::from_extension(&ext)
        .ok_or_else(|| IngestError::DisallowedExtension(ext.clone()))?;

    let matches = match kind.sniff() {
        // OOXML formats share the ZIP `PK` magic; the extension disambiguates.
        Sniff::Ooxml => infer::archive::is_zip(head_bytes),
        Sniff::Pdf => infer::archive::is_pdf(head_bytes),
        // Text formats have no magic — require valid UTF-8.
        Sniff::Utf8Text => std::str::from_utf8(head_bytes).is_ok(),
    };

    if matches {
        Ok(kind)
    } else {
        Err(IngestError::ContentMismatch)
    }
}

/// Extracts the lowercase extension from a filename, or `None` when there is no
/// usable extension (no dot, trailing dot, or dotfile like `.gitignore`).
fn extension(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let (stem, ext) = base.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        // ".gitignore" (no stem) or "trailing." (no ext) — not a real extension.
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal but valid ZIP: an empty archive is just an End-Of-Central-
    /// Directory record (`PK\x05\x06` + 18 zero bytes). Enough to satisfy the
    /// ZIP magic sniff that all OOXML kinds share.
    const EMPTY_ZIP: &[u8] = &[
        0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    /// A tiny PDF: only the `%PDF-1.4` header is needed for the magic sniff.
    const PDF: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n";
    /// 8-byte PNG signature — stand-in for "wrong content".
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn allowlist_and_dockind_agree() {
        // Every allowed extension resolves to a DocKind, and every DocKind
        // extension is on the allowlist — no drift between the two.
        for ext in ALLOWED_EXTENSIONS {
            assert!(
                DocKind::from_extension(ext).is_some(),
                "allowlisted `{ext}` has no DocKind",
            );
        }
    }

    #[test]
    fn accepts_correct_type_and_extension() {
        let cases: &[(&str, &[u8], DocKind)] = &[
            ("report.docx", EMPTY_ZIP, DocKind::Docx),
            ("book.xlsx", EMPTY_ZIP, DocKind::Xlsx),
            ("macro.xlsm", EMPTY_ZIP, DocKind::Xlsm),
            ("deck.pptx", EMPTY_ZIP, DocKind::Pptx),
            ("paper.pdf", PDF, DocKind::Pdf),
            ("notes.md", b"# Heading\n", DocKind::Md),
            ("plain.txt", b"hello world", DocKind::Txt),
            ("data.csv", b"a,b,c\n1,2,3\n", DocKind::Csv),
            ("cfg.json", b"{\"k\": 1}", DocKind::Json),
            ("cfg.yaml", b"key: value\n", DocKind::Yaml),
            ("cfg.yml", b"key: value\n", DocKind::Yaml),
            // Case-insensitive extension handling.
            ("SHOUT.PDF", PDF, DocKind::Pdf),
            ("Report.DocX", EMPTY_ZIP, DocKind::Docx),
        ];
        for (name, bytes, expected) in cases {
            assert_eq!(
                guard(name, bytes),
                Ok(*expected),
                "expected {name} to be accepted as {expected:?}",
            );
        }
    }

    #[test]
    fn rejects_corpus() {
        let cases: &[(&str, &[u8], IngestError)] = &[
            // Disallowed extensions, regardless of content.
            (
                "clip.mp4",
                &[0, 0, 0, 0x18, b'f', b't', b'y', b'p'],
                IngestError::DisallowedExtension("mp4".into()),
            ),
            (
                "tool.exe",
                &[0x4D, 0x5A, 0x90, 0x00],
                IngestError::DisallowedExtension("exe".into()),
            ),
            (
                "bundle.zip",
                EMPTY_ZIP,
                IngestError::DisallowedExtension("zip".into()),
            ),
            (
                "pic.png",
                PNG,
                IngestError::DisallowedExtension("png".into()),
            ),
            // Extension/content mismatch: .docx name, PNG bytes.
            ("trojan.docx", PNG, IngestError::ContentMismatch),
            // A PDF renamed as an OOXML type is also a mismatch.
            ("fake.pptx", PDF, IngestError::ContentMismatch),
            // Invalid UTF-8 in a text format.
            (
                "broken.txt",
                &[0xFF, 0xFE, 0x00, 0x80],
                IngestError::ContentMismatch,
            ),
            // Empty input (checked before extension).
            ("empty.txt", b"", IngestError::EmptyInput),
            // No extension at all.
            ("README", b"some bytes", IngestError::MissingExtension),
            // Dotfile — no real extension.
            (".gitignore", b"target/\n", IngestError::MissingExtension),
        ];
        for (name, bytes, expected) in cases {
            assert_eq!(
                guard(name, bytes),
                Err(expected.clone()),
                "expected {name} to be rejected with {expected:?}",
            );
        }
    }

    #[test]
    fn empty_input_wins_over_disallowed_extension() {
        // Empty check runs first, so even a bad extension reports EmptyInput.
        assert_eq!(guard("x.exe", b""), Err(IngestError::EmptyInput));
    }

    #[test]
    fn path_like_names_use_final_segment() {
        assert_eq!(guard("dir/sub/report.pdf", PDF), Ok(DocKind::Pdf));
        assert_eq!(
            guard("a.docx/notreal", PDF),
            Err(IngestError::MissingExtension)
        );
    }
}
