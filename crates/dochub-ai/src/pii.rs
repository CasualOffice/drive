//! PII detection — find personal data (emails, payment card numbers, US SSNs,
//! IP addresses) in extracted document text, behind a pluggable [`PiiDetector`]
//! trait.
//!
//! Phase 5 compliance primitive (CLAUDE.md AI layer: "entity + PII detection
//! (suggestions, human-approved)"). Like the rest of this crate it ships an
//! **offline baseline** — [`PatternPiiDetector`] — that needs no network and is
//! fully deterministic, so detection is self-hostable and test-drivable. A
//! hosted NER model slots in behind the same trait later.
//!
//! Two deliberate choices make this safe to run and safe to surface:
//! - **Precision over recall.** The scanners are high-signal: card numbers must
//!   pass the Luhn check, SSNs must fall in valid administrative ranges, IPv4
//!   octets must be ≤ 255. We would rather miss an oddly-formatted value than
//!   flood a reviewer with false positives. (Phone numbers are deferred — they
//!   can't be matched precisely without a lot of noise.)
//! - **A finding never carries the raw value.** Each [`PiiFinding`] exposes only
//!   a masked [`preview`](PiiFinding::preview) (`j•••@•••.com`, `•••• 1234`), so
//!   a scan result — logged, returned over the API, or cached — is not itself a
//!   PII leak. The byte span is enough for a caller to locate/redact the source.
//!
//! Detection is read-only: it flags spans for a human to act on and never
//! mutates the document (CLAUDE.md: "AI never auto-mutates documents").

use async_trait::async_trait;
use serde::Serialize;

/// A class of detected personal data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PiiKind {
    Email,
    CreditCard,
    UsSsn,
    IpAddress,
}

impl PiiKind {
    /// Stable machine-readable slug — matches the serde representation.
    pub fn as_str(self) -> &'static str {
        match self {
            PiiKind::Email => "email",
            PiiKind::CreditCard => "credit_card",
            PiiKind::UsSsn => "us_ssn",
            PiiKind::IpAddress => "ip_address",
        }
    }
}

/// One detected span of personal data. The raw value is intentionally absent —
/// only [`preview`](Self::preview), a masked rendering safe to surface/log, and
/// the byte span in the scanned text (so a caller can locate or redact it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PiiFinding {
    pub kind: PiiKind,
    /// Byte offset of the match start in the scanned text (a char boundary —
    /// every scanner matches ASCII only).
    pub start: usize,
    /// Byte offset one past the match end.
    pub end: usize,
    /// A masked preview of the value — never the value itself.
    pub preview: String,
}

/// Finds personal data in text. The offline [`PatternPiiDetector`] is the
/// default; a hosted NER detector can implement the same trait.
#[async_trait]
pub trait PiiDetector: Send + Sync {
    /// Return every finding, ordered by start offset, non-overlapping.
    async fn detect(&self, text: &str) -> Vec<PiiFinding>;
}

/// The offline, deterministic detector. Dependency-free pattern scanners with
/// value-level validation (Luhn, SSN ranges, octet bounds).
#[derive(Debug, Default, Clone, Copy)]
pub struct PatternPiiDetector;

#[async_trait]
impl PiiDetector for PatternPiiDetector {
    async fn detect(&self, text: &str) -> Vec<PiiFinding> {
        detect_all(text)
    }
}

/// Run every scanner, then drop overlapping spans (keep the earlier-starting,
/// then the longer). The scan itself is pure and synchronous — exposed for
/// direct use and unit tests without an async runtime.
pub fn detect_all(text: &str) -> Vec<PiiFinding> {
    let mut found = Vec::new();
    scan_emails(text, &mut found);
    scan_credit_cards(text, &mut found);
    scan_ssns(text, &mut found);
    scan_ipv4(text, &mut found);

    // Prefer earlier start, then the longer span, so the survivor of an overlap
    // is the most specific match at that position.
    found.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut out: Vec<PiiFinding> = Vec::with_capacity(found.len());
    for f in found {
        if out.last().is_some_and(|prev| f.start < prev.end) {
            continue; // overlaps an already-accepted finding
        }
        out.push(f);
    }
    out
}

// ── Email ──────────────────────────────────────────────────────────────────

fn is_email_local(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_email_domain(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-')
}

fn scan_emails(text: &str, out: &mut Vec<PiiFinding>) {
    let b = text.as_bytes();
    for (i, &c) in b.iter().enumerate() {
        if c != b'@' {
            continue;
        }
        // Expand left over the local part, right over the domain.
        let mut start = i;
        while start > 0 && is_email_local(b[start - 1]) {
            start -= 1;
        }
        let mut end = i + 1;
        while end < b.len() && is_email_domain(b[end]) {
            end += 1;
        }
        // Trim trailing punctuation the greedy scan may have eaten ("a@b.com.").
        while end > i + 1 && !b[end - 1].is_ascii_alphanumeric() {
            end -= 1;
        }
        let local = &b[start..i];
        let domain = &b[i + 1..end];
        if local.is_empty() || !valid_email_domain(domain) {
            continue;
        }
        let preview = format!(
            "{}•••@•••.{}",
            local[0] as char,
            last_label(domain).unwrap_or("")
        );
        out.push(PiiFinding {
            kind: PiiKind::Email,
            start,
            end,
            preview,
        });
    }
}

/// A domain is valid enough to flag if it has a dotted TLD of ≥ 2 letters.
fn valid_email_domain(domain: &[u8]) -> bool {
    match last_label(domain) {
        Some(tld) => tld.len() >= 2 && tld.bytes().all(|c| c.is_ascii_alphabetic()),
        None => false,
    }
}

/// The substring after the last `.`, if any (`"mail.example.com"` → `"com"`).
fn last_label(domain: &[u8]) -> Option<&str> {
    let s = std::str::from_utf8(domain).ok()?;
    let (idx, _) = s.char_indices().rfind(|(_, c)| *c == '.')?;
    Some(&s[idx + 1..])
}

// ── Payment card (Luhn) ──────────────────────────────────────────────────────

fn scan_credit_cards(text: &str, out: &mut Vec<PiiFinding>) {
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        // Consume a run of digits with single space/hyphen separators between
        // them ("4111 1111 1111 1111", "4111-1111-1111-1111").
        let start = i;
        let mut digits = String::new();
        let mut j = i;
        while j < b.len() {
            if b[j].is_ascii_digit() {
                digits.push(b[j] as char);
                j += 1;
            } else if matches!(b[j], b' ' | b'-') && j + 1 < b.len() && b[j + 1].is_ascii_digit() {
                j += 1;
            } else {
                break;
            }
        }
        if (13..=19).contains(&digits.len()) && luhn_valid(&digits) {
            let last4 = &digits[digits.len() - 4..];
            out.push(PiiFinding {
                kind: PiiKind::CreditCard,
                start,
                end: j,
                preview: format!("•••• {last4}"),
            });
        }
        i = j.max(i + 1);
    }
}

/// The Luhn checksum used by every major payment card network.
fn luhn_valid(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut double = false;
    for c in digits.bytes().rev() {
        let mut d = (c - b'0') as u32;
        if double {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    sum % 10 == 0
}

// ── US SSN ───────────────────────────────────────────────────────────────────

/// `ddd-dd-dddd`, hyphenated (bare 9-digit runs are too false-positive-prone),
/// with the area/group/serial ranges the SSA never issues excluded.
fn scan_ssns(text: &str, out: &mut Vec<PiiFinding>) {
    let b = text.as_bytes();
    if b.len() < 11 {
        return;
    }
    for start in 0..=b.len() - 11 {
        // Boundaries: not part of a longer digit run.
        if start > 0 && b[start - 1].is_ascii_digit() {
            continue;
        }
        let w = &b[start..start + 11];
        let shape = w[3] == b'-'
            && w[6] == b'-'
            && w[..3].iter().all(u8::is_ascii_digit)
            && w[4..6].iter().all(u8::is_ascii_digit)
            && w[7..].iter().all(u8::is_ascii_digit);
        if !shape {
            continue;
        }
        let end = start + 11;
        if end < b.len() && b[end].is_ascii_digit() {
            continue;
        }
        let area = &w[..3];
        let group = &w[4..6];
        let serial = &w[7..];
        let area_n: u16 = std::str::from_utf8(area).unwrap().parse().unwrap();
        // Never-issued: area 000 / 666 / 900-999; group 00; serial 0000.
        if area_n == 0 || area_n == 666 || area_n >= 900 || group == b"00" || serial == b"0000" {
            continue;
        }
        out.push(PiiFinding {
            kind: PiiKind::UsSsn,
            start,
            end,
            preview: format!("•••-••-{}", std::str::from_utf8(serial).unwrap()),
        });
    }
}

// ── IPv4 ─────────────────────────────────────────────────────────────────────

fn scan_ipv4(text: &str, out: &mut Vec<PiiFinding>) {
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() || (i > 0 && (b[i - 1].is_ascii_digit() || b[i - 1] == b'.')) {
            i += 1;
            continue;
        }
        // Consume a maximal run of digits and dots, then validate it as 4 octets.
        let start = i;
        let mut j = i;
        while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
            j += 1;
        }
        let run = &text[start..j];
        if let Some(octet_end) = valid_ipv4_prefix(run) {
            let end = start + octet_end;
            // Reject if a digit/dot immediately follows (e.g. a version string).
            if !(end < b.len() && (b[end].is_ascii_digit() || b[end] == b'.')) {
                let first = run[..octet_end].split('.').next().unwrap_or("");
                out.push(PiiFinding {
                    kind: PiiKind::IpAddress,
                    start,
                    end,
                    preview: format!("{first}.•••.•••.•••"),
                });
            }
        }
        i = j.max(i + 1);
    }
}

/// If `run` starts with exactly four dot-separated octets (each 0-255, no
/// leading zeros), return the byte length of that prefix; else `None`.
fn valid_ipv4_prefix(run: &str) -> Option<usize> {
    let mut parts = run.splitn(5, '.');
    let mut len = 0;
    for n in 0..4 {
        let octet = parts.next()?;
        if octet.is_empty() || octet.len() > 3 {
            return None;
        }
        if octet.len() > 1 && octet.starts_with('0') {
            return None; // leading zero → not a canonical octet
        }
        let v: u16 = octet.parse().ok()?;
        if v > 255 {
            return None;
        }
        if n > 0 {
            len += 1; // the '.'
        }
        len += octet.len();
    }
    Some(len)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<PiiKind> {
        detect_all(text).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn finds_a_valid_email_and_masks_it() {
        let text = "reach me at jane.doe@example.com for details";
        let f = detect_all(text);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, PiiKind::Email);
        assert_eq!(&text[f[0].start..f[0].end], "jane.doe@example.com");
        // The preview never contains the full address.
        assert!(!f[0].preview.contains("jane.doe"));
        assert_eq!(f[0].preview, "j•••@•••.com");
    }

    #[test]
    fn ignores_bare_at_sign_and_domainless_addresses() {
        assert!(detect_all("meet @ 5pm").is_empty());
        assert!(detect_all("user@localhost").is_empty()); // no dotted TLD
        assert!(detect_all("a@b").is_empty());
    }

    #[test]
    fn finds_luhn_valid_card_only() {
        // 4111 1111 1111 1111 is a well-known Luhn-valid test number.
        let good = detect_all("card 4111 1111 1111 1111 on file");
        assert_eq!(good.len(), 1);
        assert_eq!(good[0].kind, PiiKind::CreditCard);
        assert_eq!(good[0].preview, "•••• 1111");
        // One digit off → Luhn fails → not flagged.
        assert!(detect_all("card 4111 1111 1111 1112 on file").is_empty());
    }

    #[test]
    fn card_matches_hyphenated_and_unspaced() {
        assert_eq!(kinds("4111-1111-1111-1111"), vec![PiiKind::CreditCard]);
        assert_eq!(kinds("4111111111111111"), vec![PiiKind::CreditCard]);
    }

    #[test]
    fn finds_ssn_in_valid_range_masks_all_but_serial() {
        let f = detect_all("SSN 123-45-6789 on the form");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, PiiKind::UsSsn);
        assert_eq!(f[0].preview, "•••-••-6789");
    }

    #[test]
    fn rejects_never_issued_ssn_ranges() {
        assert!(detect_all("000-45-6789").is_empty()); // area 000
        assert!(detect_all("666-45-6789").is_empty()); // area 666
        assert!(detect_all("900-45-6789").is_empty()); // area 9xx
        assert!(detect_all("123-00-6789").is_empty()); // group 00
        assert!(detect_all("123-45-0000").is_empty()); // serial 0000
    }

    #[test]
    fn ssn_must_be_hyphenated_and_standalone() {
        assert!(detect_all("123456789").is_empty()); // bare digits
        assert!(detect_all("1123-45-6789").is_empty()); // longer digit run
    }

    #[test]
    fn finds_valid_ipv4_and_masks_tail() {
        let f = detect_all("client 192.168.1.42 connected");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, PiiKind::IpAddress);
        assert_eq!(
            &"client 192.168.1.42 connected"[f[0].start..f[0].end],
            "192.168.1.42"
        );
        assert_eq!(f[0].preview, "192.•••.•••.•••");
    }

    #[test]
    fn rejects_out_of_range_and_versiony_ipv4() {
        assert!(detect_all("build 1.2.3.4.5").is_empty()); // 5 groups
        assert!(detect_all("value 256.1.1.1").is_empty()); // octet > 255
        assert!(detect_all("v 01.2.3.4").is_empty()); // leading zero
    }

    #[test]
    fn clean_text_yields_nothing() {
        let text = "The quarterly report covers revenue recognition and deferred income.";
        assert!(detect_all(text).is_empty());
    }

    #[test]
    fn finds_multiple_kinds_ordered_by_offset() {
        let text = "email a@b.com then card 4111111111111111 then ip 10.0.0.1";
        let f = detect_all(text);
        assert_eq!(
            f.iter().map(|x| x.kind).collect::<Vec<_>>(),
            vec![PiiKind::Email, PiiKind::CreditCard, PiiKind::IpAddress]
        );
        // Offsets strictly increasing, non-overlapping.
        for w in f.windows(2) {
            assert!(w[0].end <= w[1].start);
        }
    }

    #[tokio::test]
    async fn detector_trait_delegates_to_scan() {
        let d = PatternPiiDetector;
        let f = d.detect("card 4111 1111 1111 1111").await;
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, PiiKind::CreditCard);
    }
}
