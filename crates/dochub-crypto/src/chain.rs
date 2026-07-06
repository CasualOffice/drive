//! Hash-chain integrity primitive (Phase 0 build §"History is append-only").
//!
//! The tamper-evidence core shared by the version engine and the audit log. A
//! chain is an ordered sequence of links; each link stores the SHA-256 of its
//! own (cipher)bytes as `content_hash` and a `prev_hash` pointer to the prior
//! link's `content_hash` (`None` at the head). Verification recomputes every
//! content hash from the stored bytes and walks the pointers; the first
//! disagreement is a tamper alarm — surfaced, never silently repaired.
//!
//! All hashes are SHA-256 via `aws-lc-rs` (audited, FIPS-track — the one digest
//! this crate already links), rendered as lowercase hex. [`Sha256Hex`] compares
//! in constant time, and every parse path returns [`CryptoError`] instead of
//! panicking on malformed input.
//!
//! # Preimages (exact, so a third party can reproduce them)
//!
//! - **Content hash** — [`hash_content`]: `SHA-256(bytes)` over the raw
//!   (cipher)bytes, no framing.
//! - **Entry hash** — [`entry_hash`], for the audit chain, domain-separates the
//!   parent pointer from the payload:
//!   `SHA-256( prev_hex ‖ 0x00 ‖ canonical )`, where `prev_hex` is the 64-byte
//!   lowercase-ASCII hex of `prev` when present and the empty string (a `""`
//!   sentinel) when `prev` is `None`. The `0x00` byte is an unambiguous
//!   separator: hex is `[0-9a-f]` only, so a `0x00` can never appear inside
//!   `prev_hex`, and the fixed 64-byte (or 0-byte) length of `prev_hex` keeps
//!   the `prev`/`canonical` boundary unforgeable.

use std::fmt;
use std::hash::{Hash, Hasher};
use std::str::FromStr;

use aws_lc_rs::digest::{Context, SHA256};
use subtle::ConstantTimeEq;

use crate::error::CryptoError;

/// Lowercase-hex SHA-256 digest: a 32-byte hash with tabular/serializable
/// rendering and **constant-time** equality (so comparing a claimed hash to a
/// recomputed one leaks no timing signal).
///
/// The canonical string form is exactly 64 lowercase hex digits; [`FromStr`]
/// and the `serde` deserializer reject anything else.
#[derive(Clone, Copy)]
pub struct Sha256Hex([u8; 32]);

impl Sha256Hex {
    /// Wrap raw digest bytes.
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// The raw 32 digest bytes.
    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Render as 64 lowercase hex digits.
    #[must_use]
    pub fn to_hex(&self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut s = String::with_capacity(64);
        for &b in &self.0 {
            s.push(HEX[(b >> 4) as usize] as char);
            s.push(HEX[(b & 0x0f) as usize] as char);
        }
        s
    }
}

/// Lowercase-hex nibble → value, rejecting uppercase and non-hex so the
/// canonical form stays unique.
const fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

impl FromStr for Sha256Hex {
    type Err = CryptoError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = s.as_bytes();
        if bytes.len() != 64 {
            return Err(CryptoError::BadHash);
        }
        let mut out = [0u8; 32];
        for (i, pair) in bytes.chunks_exact(2).enumerate() {
            let hi = hex_val(pair[0]).ok_or(CryptoError::BadHash)?;
            let lo = hex_val(pair[1]).ok_or(CryptoError::BadHash)?;
            out[i] = (hi << 4) | lo;
        }
        Ok(Self(out))
    }
}

impl fmt::Display for Sha256Hex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for Sha256Hex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // A hash is not secret; show it, but as the canonical hex, not a byte array.
        write!(f, "Sha256Hex({})", self.to_hex())
    }
}

impl PartialEq for Sha256Hex {
    /// Constant-time: independent of where the two digests first differ.
    fn eq(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl Eq for Sha256Hex {}

impl Hash for Sha256Hex {
    // Consistent with the byte-wise `PartialEq` above (equal hashes → equal
    // digests → equal `Hash`), so `Sha256Hex` is a sound map/set key.
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl serde::Serialize for Sha256Hex {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_hex())
    }
}

impl<'de> serde::Deserialize<'de> for Sha256Hex {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

/// Finish a SHA-256 context into raw digest bytes. The digest is always 32
/// bytes for SHA-256, so the copy is total.
fn finish(ctx: Context) -> Sha256Hex {
    let digest = ctx.finish();
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_ref());
    Sha256Hex(out)
}

/// `SHA-256(bytes)` — the content hash of a version's (cipher)bytes.
#[must_use]
pub fn hash_content(bytes: &[u8]) -> Sha256Hex {
    let mut ctx = Context::new(&SHA256);
    ctx.update(bytes);
    finish(ctx)
}

/// Audit-chain entry hash: `SHA-256( prev_hex ‖ 0x00 ‖ canonical )`.
///
/// `prev_hex` is `prev`'s 64-char lowercase hex when present, or the empty
/// string when `prev` is `None`. See the module docs for why the `0x00`
/// separator plus the fixed-length `prev_hex` make the preimage unambiguous.
#[must_use]
pub fn entry_hash(prev: Option<&Sha256Hex>, canonical: &[u8]) -> Sha256Hex {
    let mut ctx = Context::new(&SHA256);
    if let Some(p) = prev {
        ctx.update(p.to_hex().as_bytes());
    }
    ctx.update(&[0x00]);
    ctx.update(canonical);
    finish(ctx)
}

/// One link in an append-only chain: the hash of its own bytes and the parent
/// pointer it claims (`None` only at the head).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainLink {
    /// Claimed `SHA-256` of this link's (cipher)bytes.
    pub content_hash: Sha256Hex,
    /// Claimed pointer to the previous link's `content_hash`; `None` at index 0.
    pub prev_hash: Option<Sha256Hex>,
}

/// Why a chain failed verification.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BreakReason {
    /// The recomputed content hash disagrees with the link's `content_hash`:
    /// the stored bytes were altered.
    ContentMismatch,
    /// The link's `prev_hash` does not point at the previous link's
    /// `content_hash` (or is not `None` at the head): the ordering was altered.
    PrevMismatch,
}

/// Outcome of [`verify_chain`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChainStatus {
    /// Every link's content and parent pointer verified.
    Intact,
    /// The first failing link, by index, and why.
    Broken {
        /// Zero-based position of the first bad link.
        at_index: usize,
        /// What was wrong with it.
        reason: BreakReason,
    },
}

/// Verify an ordered append-only chain.
///
/// For each `(bytes, link)` in order, recompute `hash_content(bytes)` and check
/// it equals the claimed `content_hash` (else [`BreakReason::ContentMismatch`]),
/// then check the link's `prev_hash` equals the previous link's `content_hash`
/// — or is `None` at index 0 (else [`BreakReason::PrevMismatch`]). Returns
/// [`ChainStatus::Broken`] at the first failing index, or
/// [`ChainStatus::Intact`] for a fully consistent chain (including the empty
/// and single-element chains). Never panics.
pub fn verify_chain<'a, I>(items: I) -> ChainStatus
where
    I: IntoIterator<Item = (&'a [u8], &'a ChainLink)>,
{
    let mut prev: Option<&Sha256Hex> = None;
    for (i, (bytes, link)) in items.into_iter().enumerate() {
        if hash_content(bytes) != link.content_hash {
            return ChainStatus::Broken {
                at_index: i,
                reason: BreakReason::ContentMismatch,
            };
        }
        let prev_ok = match (prev, link.prev_hash.as_ref()) {
            (None, None) => true,
            (Some(expected), Some(claimed)) => expected == claimed,
            _ => false,
        };
        if !prev_ok {
            return ChainStatus::Broken {
                at_index: i,
                reason: BreakReason::PrevMismatch,
            };
        }
        prev = Some(&link.content_hash);
    }
    ChainStatus::Intact
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// Build a well-formed chain: `content_hash = SHA-256(content)`, `prev_hash`
    /// points at the prior link (`None` at the head).
    fn build_links(contents: &[Vec<u8>]) -> Vec<ChainLink> {
        let mut links = Vec::with_capacity(contents.len());
        let mut prev: Option<Sha256Hex> = None;
        for c in contents {
            let content_hash = hash_content(c);
            links.push(ChainLink {
                content_hash,
                prev_hash: prev,
            });
            prev = Some(content_hash);
        }
        links
    }

    fn zip<'a>(
        contents: &'a [Vec<u8>],
        links: &'a [ChainLink],
    ) -> impl Iterator<Item = (&'a [u8], &'a ChainLink)> {
        contents.iter().map(Vec::as_slice).zip(links.iter())
    }

    // --- Known-answer vectors (implementation-independent SHA-256) ----------

    #[test]
    fn hash_content_known_answers() {
        assert_eq!(
            hash_content(b"").to_hex(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hash_content(b"abc").to_hex(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hash_content(b"hello world").to_hex(),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    // --- Sha256Hex parsing / rendering --------------------------------------

    #[test]
    fn hex_roundtrips_and_validates() {
        let h = hash_content(b"abc");
        let s = h.to_hex();
        assert_eq!(s.len(), 64);
        assert_eq!(s, s.to_lowercase());
        let parsed: Sha256Hex = s.parse().unwrap();
        assert_eq!(parsed, h);

        // Wrong length, uppercase, and non-hex all error — never panic.
        assert!(matches!("".parse::<Sha256Hex>(), Err(CryptoError::BadHash)));
        assert!(matches!(
            "abcd".parse::<Sha256Hex>(),
            Err(CryptoError::BadHash)
        ));
        let upper = s.to_uppercase();
        assert!(matches!(
            upper.parse::<Sha256Hex>(),
            Err(CryptoError::BadHash)
        ));
        let mut bad = s.clone();
        bad.replace_range(0..1, "z");
        assert!(matches!(
            bad.parse::<Sha256Hex>(),
            Err(CryptoError::BadHash)
        ));
    }

    #[test]
    fn serde_roundtrips_as_hex_string() {
        let h = hash_content(b"payload");
        let json = serde_json::to_string(&h).unwrap();
        assert_eq!(json, format!("\"{}\"", h.to_hex()));
        let back: Sha256Hex = serde_json::from_str(&json).unwrap();
        assert_eq!(back, h);
        // Malformed input deserializes to an error, not a panic.
        assert!(serde_json::from_str::<Sha256Hex>("\"nope\"").is_err());
    }

    // --- entry_hash ---------------------------------------------------------

    #[test]
    fn entry_hash_preimage_is_exact() {
        // Reproduce the documented preimage by hand: prev_hex ‖ 0x00 ‖ canonical.
        let prev = hash_content(b"parent");
        let canonical = b"{\"event\":\"upload\"}";

        let mut expected_pre = prev.to_hex().into_bytes();
        expected_pre.push(0x00);
        expected_pre.extend_from_slice(canonical);
        assert_eq!(
            entry_hash(Some(&prev), canonical),
            hash_content(&expected_pre)
        );

        // None uses the empty "" sentinel: preimage is just 0x00 ‖ canonical.
        let mut root_pre = vec![0x00];
        root_pre.extend_from_slice(canonical);
        assert_eq!(entry_hash(None, canonical), hash_content(&root_pre));
    }

    #[test]
    fn entry_hash_is_deterministic() {
        let prev = hash_content(b"p");
        assert_eq!(entry_hash(Some(&prev), b"x"), entry_hash(Some(&prev), b"x"));
        assert_eq!(entry_hash(None, b"x"), entry_hash(None, b"x"));
    }

    #[test]
    fn entry_hash_changes_with_prev_or_payload() {
        let a = hash_content(b"prev-a");
        let b = hash_content(b"prev-b");
        // Changing prev changes the output.
        assert_ne!(entry_hash(Some(&a), b"same"), entry_hash(Some(&b), b"same"));
        // None vs Some(prev) differ.
        assert_ne!(entry_hash(None, b"same"), entry_hash(Some(&a), b"same"));
        // Changing payload changes the output.
        assert_ne!(entry_hash(Some(&a), b"one"), entry_hash(Some(&a), b"two"));
        assert_ne!(entry_hash(None, b"one"), entry_hash(None, b"two"));
    }

    #[test]
    fn entry_hash_domain_separation_resists_boundary_shift() {
        // The 0x00 separator + fixed-length prev_hex means moving the boundary
        // between prev and payload cannot collide. Empty prev with a payload
        // that starts with 0x00 must not equal any Some(prev) framing.
        let h = entry_hash(None, &[0x00, 0x01, 0x02]);
        let g = entry_hash(None, &[0x00, 0x00, 0x01, 0x02]);
        assert_ne!(h, g);
    }

    // --- verify_chain -------------------------------------------------------

    #[test]
    fn empty_and_single_chains_are_intact() {
        assert_eq!(verify_chain(std::iter::empty()), ChainStatus::Intact);

        let contents = vec![b"only".to_vec()];
        let links = build_links(&contents);
        assert_eq!(verify_chain(zip(&contents, &links)), ChainStatus::Intact);
    }

    proptest! {
        /// A well-formed chain of any length verifies Intact.
        #[test]
        fn wellformed_chain_is_intact(
            contents in prop::collection::vec(
                prop::collection::vec(any::<u8>(), 0..64), 0..12),
        ) {
            let links = build_links(&contents);
            prop_assert_eq!(verify_chain(zip(&contents, &links)), ChainStatus::Intact);
        }

        /// Flipping any byte of any element's content is caught as a
        /// ContentMismatch at exactly that index.
        #[test]
        fn flipped_content_breaks_at_index(
            contents in prop::collection::vec(
                prop::collection::vec(any::<u8>(), 1..64), 1..12),
            elem in any::<prop::sample::Index>(),
            byte in any::<prop::sample::Index>(),
            mask in 1u8..=255,
        ) {
            let links = build_links(&contents);
            let i = elem.index(contents.len());
            // Corrupt only the bytes fed to the verifier; links stay honest.
            let mut corrupted = contents.clone();
            let b = byte.index(corrupted[i].len());
            corrupted[i][b] ^= mask;

            prop_assert_eq!(
                verify_chain(zip(&corrupted, &links)),
                ChainStatus::Broken { at_index: i, reason: BreakReason::ContentMismatch }
            );
        }

        /// Corrupting any link's prev_hash is caught as a PrevMismatch at that
        /// index (content is untouched, so the content check passes first).
        #[test]
        fn corrupted_prev_breaks_at_index(
            contents in prop::collection::vec(
                prop::collection::vec(any::<u8>(), 0..64), 1..12),
            elem in any::<prop::sample::Index>(),
        ) {
            let mut links = build_links(&contents);
            let i = elem.index(contents.len());
            links[i].prev_hash = match links[i].prev_hash {
                Some(h) => {
                    let mut bytes = *h.as_bytes();
                    bytes[0] ^= 0xff;
                    Some(Sha256Hex::from_bytes(bytes))
                }
                None => Some(hash_content(b"non-null-sentinel")),
            };

            prop_assert_eq!(
                verify_chain(zip(&contents, &links)),
                ChainStatus::Broken { at_index: i, reason: BreakReason::PrevMismatch }
            );
        }
    }
}
