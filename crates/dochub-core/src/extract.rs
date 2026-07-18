//! Plaintext extraction for the content index.
//!
//! [`extract_text`] turns a decrypted document's bytes into searchable
//! plaintext, so the Tantivy index (`dochub-index`) can answer "which document
//! mentions X?" for Office formats — not just the plain-text ones.
//!
//! Coverage:
//! - `md / txt / csv / json / yaml` — decoded as UTF-8 (lossy), returned as-is.
//! - `docx / xlsx / pptx` — the OOXML container is unzipped and the text nodes
//!   of the relevant parts are streamed out (`quick-xml`). We extract *text*,
//!   not layout: runs are joined with single spaces and whitespace is
//!   collapsed, which is exactly what a token-based index wants. `xlsx` covers
//!   both shared strings and per-worksheet inline strings (see `xlsx_text`).
//! - `pdf` — the text layer is extracted via `pdf-extract` (pure-Rust: `lopdf`
//!   parse + font-table glyph→text decode). It runs behind `catch_unwind`
//!   because it parses untrusted upload bytes; a parse error or panic degrades
//!   to "index title-only", never a crashed worker. Scanned/image-only PDFs
//!   carry no text layer (no OCR), so they extract to little/nothing — expected.
//! - `xlsm` — treated as opaque (macro-enabled; product scope calls it opaque),
//!   so it is title-only: returns [`ExtractError::Unsupported`].
//!
//! Design note: extraction lives in `core` per CLAUDE.md ("text extraction …
//! lives in `core`, not re-implemented" upstream). It is pure (bytes in, string
//! out), so it is unit-testable without storage, crypto, or a DB, and the
//! background worker (`dochub-worker`) calls it off the request path.

use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use thiserror::Error;

use crate::ingest::DocKind;

/// Cap on extracted text per document. Tantivy indexes the head of a large
/// document; 8 MiB of plaintext is far more than any real document's searchable
/// body and bounds memory on a pathological input.
const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;

/// Errors from text extraction. None carry document content.
#[derive(Debug, Error)]
pub enum ExtractError {
    /// The `kind` is opaque by policy (`xlsm`, macro-enabled). Callers index
    /// such files by title/metadata only.
    #[error("no text extractor for {0:?}")]
    Unsupported(DocKind),
    /// The OOXML container could not be opened as a zip.
    #[error("malformed OOXML container: {0}")]
    Container(String),
    /// The PDF could not be parsed (malformed, encrypted without a key, or the
    /// parser panicked on hostile input). The caller indexes title-only.
    #[error("PDF text extraction failed: {0}")]
    Pdf(String),
}

/// Whether [`extract_text`] can produce body text for `kind`. Lets callers
/// decide "index content" vs "title only" without catching an error.
#[must_use]
pub fn supports(kind: DocKind) -> bool {
    matches!(
        kind,
        DocKind::Md
            | DocKind::Txt
            | DocKind::Csv
            | DocKind::Json
            | DocKind::Yaml
            | DocKind::Docx
            | DocKind::Xlsx
            | DocKind::Pptx
            | DocKind::Pdf
    )
}

/// Extract searchable plaintext from a document's decrypted bytes.
///
/// Returns [`ExtractError::Unsupported`] for `xlsm` (opaque by policy — index
/// title only), [`ExtractError::Container`] if an OOXML file is not a valid zip,
/// and [`ExtractError::Pdf`] if a PDF can't be parsed. The result is truncated
/// to [`MAX_TEXT_BYTES`] on a char boundary.
pub fn extract_text(kind: DocKind, bytes: &[u8]) -> Result<String, ExtractError> {
    let text = match kind {
        DocKind::Md | DocKind::Txt | DocKind::Csv | DocKind::Json | DocKind::Yaml => {
            String::from_utf8_lossy(bytes).into_owned()
        }
        DocKind::Docx => ooxml_text(bytes, &["word/document.xml"], false)?,
        DocKind::Xlsx => xlsx_text(bytes)?,
        DocKind::Pptx => ooxml_text(bytes, &[], true)?,
        DocKind::Pdf => pdf_text(bytes)?,
        DocKind::Xlsm => return Err(ExtractError::Unsupported(kind)),
    };
    Ok(truncate_on_char_boundary(text, MAX_TEXT_BYTES))
}

/// Extract the text layer of a PDF via `pdf-extract`.
///
/// Isolated behind [`std::panic::catch_unwind`]: the underlying parser
/// (`lopdf` with font-table decoding) runs on untrusted upload bytes and can
/// panic on malformed input, and extraction runs on the background worker — a
/// panic must degrade to a title-only index, never crash the task. Truncation
/// to [`MAX_TEXT_BYTES`] is applied by the caller.
fn pdf_text(bytes: &[u8]) -> Result<String, ExtractError> {
    let parsed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(bytes)
    }));
    match parsed {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(ExtractError::Pdf(e.to_string())),
        Err(_) => Err(ExtractError::Pdf(
            "parser panicked on malformed input".into(),
        )),
    }
}

/// Open `bytes` as an OOXML (zip) container and concatenate the text nodes of
/// the requested parts.
///
/// `exact_parts` are entry names read verbatim (missing ones are skipped). When
/// `slides` is set, every `ppt/slides/slideN.xml` entry is included too (their
/// count is not known ahead of time). Text from all parts is joined with
/// spaces.
fn ooxml_text(bytes: &[u8], exact_parts: &[&str], slides: bool) -> Result<String, ExtractError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| ExtractError::Container(e.to_string()))?;

    // Collect the entry names we want, in a stable order.
    let mut wanted: Vec<String> = exact_parts.iter().map(|s| (*s).to_string()).collect();
    if slides {
        let mut slide_parts: Vec<(u32, String)> = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
            .filter_map(|name| slide_number(&name).map(|n| (n, name)))
            .collect();
        // slide1, slide2, … — numeric order, not lexical (slide10 < slide2).
        slide_parts.sort_by_key(|(n, _)| *n);
        wanted.extend(slide_parts.into_iter().map(|(_, name)| name));
    }

    let mut out = String::new();
    for name in wanted {
        let Ok(mut entry) = archive.by_name(&name) else {
            continue; // absent part (e.g. no shared strings) — skip.
        };
        let mut xml = Vec::new();
        if entry.read_to_end(&mut xml).is_err() {
            continue;
        }
        append_xml_text(&xml, &mut out);
        if out.len() >= MAX_TEXT_BYTES {
            break;
        }
    }
    Ok(collapse_ws(&out))
}

/// Extract text from an `.xlsx`, covering **both** ways a cell stores a string:
///
/// - **Shared strings** (`xl/sharedStrings.xml`) — Excel's default; a table of
///   deduplicated strings that cells reference by index. All its text is body.
/// - **Inline strings** — some (streaming) writers emit the string directly in
///   the worksheet as `<c t="inlineStr"><is><t>…</t></is></c>` instead. These
///   live in `xl/worksheets/sheetN.xml`, where the **only** `<t>` elements are
///   inline strings — cell numbers are `<v>` and formulas `<f>` — so a
///   `<t>`-scoped pass captures them without pulling in numeric/formula noise
///   (including the shared-string *indices* in `<v>`).
fn xlsx_text(bytes: &[u8]) -> Result<String, ExtractError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| ExtractError::Container(e.to_string()))?;

    let mut out = String::new();

    // Shared strings first (the common case). All text nodes are body text.
    if let Ok(mut entry) = archive.by_name("xl/sharedStrings.xml") {
        let mut xml = Vec::new();
        if entry.read_to_end(&mut xml).is_ok() {
            append_xml_text(&xml, &mut out);
        }
    }

    // Inline strings from each worksheet — `<t>` elements only.
    let mut sheets: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .filter(|name| is_worksheet(name))
        .collect();
    sheets.sort(); // deterministic; order is irrelevant to a bag-of-words index
    for name in sheets {
        if out.len() >= MAX_TEXT_BYTES {
            break;
        }
        let Ok(mut entry) = archive.by_name(&name) else {
            continue;
        };
        let mut xml = Vec::new();
        if entry.read_to_end(&mut xml).is_ok() {
            append_element_text(&xml, &mut out, b"t");
        }
    }

    Ok(collapse_ws(&out))
}

/// A worksheet body part: `xl/worksheets/sheet1.xml`, …. Excludes the `_rels`
/// sidecars (`xl/worksheets/_rels/…`) which don't start with `sheet`.
fn is_worksheet(name: &str) -> bool {
    // OOXML part names are spec-lowercase, so a case-sensitive suffix match is
    // correct here (and `strip_suffix` sidesteps the extension-casing lint).
    name.strip_prefix("xl/worksheets/sheet")
        .and_then(|rest| rest.strip_suffix(".xml"))
        .is_some()
}

/// Like [`append_xml_text`] but emits character data **only** while inside a
/// `target` element (matched by local name, ignoring any namespace prefix). A
/// space is appended when each `target` element closes so adjacent cells' text
/// never fuses. Used to pull inline-string `<t>` text out of a worksheet
/// without also grabbing the surrounding `<v>` numbers / `<f>` formulas.
fn append_element_text(xml: &[u8], out: &mut String, target: &[u8]) {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut depth: u32 = 0;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) if e.local_name().as_ref() == target => depth += 1,
            Ok(Event::End(e)) if e.local_name().as_ref() == target && depth > 0 => {
                depth -= 1;
                out.push(' ');
            }
            Ok(Event::Text(e)) if depth > 0 => {
                if let Ok(t) = e.xml_content() {
                    out.push_str(&t);
                }
            }
            Ok(Event::CData(e)) if depth > 0 => {
                if let Ok(t) = e.decode() {
                    out.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(e)) if depth > 0 => {
                if let Ok(Some(c)) = e.resolve_char_ref() {
                    out.push(c);
                } else if let Ok(name) = e.decode() {
                    if let Some(c) = named_entity(&name) {
                        out.push(c);
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
        if out.len() >= MAX_TEXT_BYTES {
            break;
        }
    }
}

/// Parse the `N` out of `ppt/slides/slideN.xml`. Returns `None` for anything
/// else — including `ppt/slides/_rels/slideN.xml.rels` (fails the `slideN`
/// numeric parse), so it doubles as the "is this a slide body?" test.
fn slide_number(name: &str) -> Option<u32> {
    let stem = name
        .strip_prefix("ppt/slides/slide")?
        .strip_suffix(".xml")?;
    stem.parse().ok()
}

/// Stream one XML part into `out`. Character data (`Text`, `CDATA`) is appended
/// verbatim so a word split across entity references stays intact (`Q&amp;A` →
/// `Q&A`); an **element boundary** (start / end / empty tag) inserts a single
/// space so text from adjacent runs never fuses (`</w:t><w:t>` → a space). The
/// caller collapses the resulting whitespace. Entity references (`&amp;`,
/// `&#233;`) are resolved. Malformed XML ends *this* part gracefully — partial
/// text is still useful — rather than failing the whole document.
fn append_xml_text(xml: &[u8], out: &mut String) {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                if let Ok(t) = e.xml_content() {
                    out.push_str(&t);
                }
            }
            Ok(Event::CData(e)) => {
                if let Ok(t) = e.decode() {
                    out.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(e)) => {
                // Numeric char refs (`&#233;` / `&#xE9;`) resolve to a char;
                // the five predefined named entities map by name. Unknown named
                // entities are dropped (documents don't declare custom ones).
                if let Ok(Some(c)) = e.resolve_char_ref() {
                    out.push(c);
                } else if let Ok(name) = e.decode() {
                    if let Some(c) = named_entity(&name) {
                        out.push(c);
                    }
                }
            }
            Ok(Event::Start(_) | Event::End(_) | Event::Empty(_)) => out.push(' '),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
        if out.len() >= MAX_TEXT_BYTES {
            break;
        }
    }
}

/// The five predefined XML entities. Everything else is a char ref (handled by
/// `resolve_char_ref`) or an undeclared entity we drop.
fn named_entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    }
}

/// Collapse every run of whitespace to a single space and trim the ends.
fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = true; // start true so leading whitespace is trimmed
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Truncate `s` to at most `max` bytes, cutting on a UTF-8 char boundary.
fn truncate_on_char_boundary(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// Build a minimal zip in memory from (name, contents) parts.
    fn zip_of(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for (name, body) in parts {
                w.start_file(*name, opts).unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn plain_text_kinds_pass_through() {
        assert_eq!(
            extract_text(DocKind::Md, b"# Title\nbody text").unwrap(),
            "# Title\nbody text"
        );
        assert_eq!(extract_text(DocKind::Csv, b"a,b\n1,2").unwrap(), "a,b\n1,2");
    }

    #[test]
    fn docx_extracts_run_text() {
        let doc = r#"<?xml version="1.0"?>
            <w:document xmlns:w="x"><w:body>
              <w:p><w:r><w:t>Quarterly</w:t></w:r><w:r><w:t xml:space="preserve"> revenue</w:t></w:r></w:p>
              <w:p><w:r><w:t>exceeded expectations</w:t></w:r></w:p>
            </w:body></w:document>"#;
        let bytes = zip_of(&[("word/document.xml", doc), ("[Content_Types].xml", "<x/>")]);
        let text = extract_text(DocKind::Docx, &bytes).unwrap();
        assert!(text.contains("Quarterly"));
        assert!(text.contains("revenue"));
        assert!(text.contains("exceeded expectations"));
    }

    #[test]
    fn xlsx_extracts_shared_strings() {
        let shared = r#"<?xml version="1.0"?>
            <sst xmlns="x" count="2" uniqueCount="2">
              <si><t>Budget</t></si>
              <si><t>Marketing spend</t></si>
            </sst>"#;
        let bytes = zip_of(&[
            ("xl/sharedStrings.xml", shared),
            ("[Content_Types].xml", "<x/>"),
        ]);
        let text = extract_text(DocKind::Xlsx, &bytes).unwrap();
        assert!(text.contains("Budget"));
        assert!(text.contains("Marketing spend"));
    }

    #[test]
    fn xlsx_extracts_inline_strings_without_numeric_noise() {
        // A1 references shared string #0 (t="s"); B1 is an inline string; C1 is
        // a plain number. Both string kinds must be found; the shared-string
        // index and the number (both `<v>`, not `<t>`) must NOT leak in.
        let shared = r#"<?xml version="1.0"?>
            <sst xmlns="x" count="1"><si><t>SharedBudget</t></si></sst>"#;
        let sheet = r#"<?xml version="1.0"?>
            <worksheet xmlns="x"><sheetData>
              <row r="1">
                <c r="A1" t="s"><v>0</v></c>
                <c r="B1" t="inlineStr"><is><t>InlineNote</t></is></c>
                <c r="C1"><v>4242</v></c>
              </row>
            </sheetData></worksheet>"#;
        let bytes = zip_of(&[
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/sheet1.xml", sheet),
            ("[Content_Types].xml", "<x/>"),
        ]);
        let text = extract_text(DocKind::Xlsx, &bytes).unwrap();
        assert!(
            text.contains("SharedBudget"),
            "shared string missing: {text:?}"
        );
        assert!(
            text.contains("InlineNote"),
            "inline string missing: {text:?}"
        );
        assert!(!text.contains("4242"), "numeric cell leaked: {text:?}");
    }

    #[test]
    fn pptx_extracts_all_slides_in_order() {
        let slide =
            |t: &str| format!(r#"<?xml version="1.0"?><p:sld xmlns:a="x"><a:t>{t}</a:t></p:sld>"#);
        // slide10 present to prove numeric (not lexical) ordering.
        let s1 = slide("alpha");
        let s2 = slide("beta");
        let s10 = slide("omega");
        let bytes = zip_of(&[
            ("ppt/slides/slide1.xml", s1.as_str()),
            ("ppt/slides/slide2.xml", s2.as_str()),
            ("ppt/slides/slide10.xml", s10.as_str()),
            ("ppt/slides/_rels/slide1.xml.rels", "<Relationships/>"),
        ]);
        let text = extract_text(DocKind::Pptx, &bytes).unwrap();
        assert!(text.contains("alpha"));
        assert!(text.contains("beta"));
        assert!(text.contains("omega"));
        // Numeric order: slide2 (beta) comes before slide10 (omega).
        let beta = text.find("beta").unwrap();
        let omega = text.find("omega").unwrap();
        assert!(beta < omega, "slides must be in numeric order: {text:?}");
    }

    #[test]
    fn xml_entities_are_unescaped() {
        let doc = r#"<w:document xmlns:w="x"><w:t>Q&amp;A &lt;draft&gt;</w:t></w:document>"#;
        let bytes = zip_of(&[("word/document.xml", doc)]);
        let text = extract_text(DocKind::Docx, &bytes).unwrap();
        assert!(text.contains("Q&A"));
        assert!(text.contains("<draft>"));
    }

    #[test]
    fn xlsm_is_unsupported_but_pdf_is_supported() {
        assert!(matches!(
            extract_text(DocKind::Xlsm, b"anything"),
            Err(ExtractError::Unsupported(DocKind::Xlsm))
        ));
        assert!(!supports(DocKind::Xlsm));
        assert!(supports(DocKind::Pdf));
        assert!(supports(DocKind::Docx));
    }

    /// A one-page PDF whose text layer reads "Encrypted document registry".
    /// Generated once with `lopdf` (see git history) and checked in as a fixture
    /// so the test needs no PDF-authoring dev-dependency (which dragged in an
    /// unmaintained proc-macro sub-tree).
    const HELLO_PDF: &[u8] = include_bytes!("testdata/hello.pdf");

    #[test]
    fn pdf_extracts_text_layer() {
        let text = extract_text(DocKind::Pdf, HELLO_PDF).unwrap();
        assert!(
            text.contains("Encrypted document registry"),
            "extracted: {text:?}"
        );
    }

    #[test]
    fn malformed_pdf_is_an_error_not_a_panic() {
        // A PDF header with junk after it — extraction must return a Pdf error
        // (caught, so the caller indexes title-only), never unwind the worker.
        let err = extract_text(DocKind::Pdf, b"%PDF-1.7\nnot a real pdf body").unwrap_err();
        assert!(matches!(err, ExtractError::Pdf(_)), "got: {err:?}");
    }

    #[test]
    fn corrupt_ooxml_is_a_container_error() {
        let err = extract_text(DocKind::Docx, b"not a zip at all").unwrap_err();
        assert!(matches!(err, ExtractError::Container(_)));
    }

    #[test]
    fn missing_part_yields_empty_not_error() {
        // A valid zip with no word/document.xml — extraction returns empty.
        let bytes = zip_of(&[("[Content_Types].xml", "<x/>")]);
        let text = extract_text(DocKind::Docx, &bytes).unwrap();
        assert!(text.is_empty());
    }
}
