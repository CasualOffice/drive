//! Signed provenance manifest for a file's hash chain (Phase 1 build §2.1).
//!
//! A provenance manifest is a portable, offline-verifiable attestation of a
//! file's immutable version history: the ordered chain of `(seq, content_hash,
//! prev_hash, created_at, author_id)` links, the head hash, and the time the
//! export was generated. The server signs the manifest with the workspace's
//! Ed25519 key ([`crate::sign`]); a recipient re-verifies the signature **and**
//! re-walks the chain, entirely offline, with no DB or network.
//!
//! This module is the single source of truth for the **canonical bytes** that
//! get signed, so the HTTP signer and the `verify-provenance` CLI agree
//! byte-for-byte. The manifest JSON on the wire is *not* what is signed —
//! JSON key order and whitespace are not stable — so verification reconstructs
//! the canonical bytes from the parsed manifest.
//!
//! # Canonical serialization (exact bytes)
//!
//! [`canonical_bytes`] emits, with `US = 0x1f` (field separator) and
//! `RS = 0x1e` (record terminator):
//!
//! ```text
//! "dochub-provenance-manifest-v1\n"
//! "file_id"      US <file_id>      RS
//! "head"         US <head|"">      RS
//! "generated_at" US <generated_at> RS
//! "chain"        US <len(chain)>   RS          // len as ASCII decimal
//! for each link in chain order (seq ascending):
//!     <seq> US <content_hash> US <prev_hash|""> US <created_at> US <author_id> RS
//! ```
//!
//! An absent `head` or `prev_hash` (`None`) is written as the empty string.
//! `seq` and the chain length are ASCII decimal. The domain-string prefix, the
//! length-prefixed chain, and the `US`/`RS` control-byte framing make the
//! encoding unambiguous: `content_hash` is lowercase hex, `file_id`/`author_id`
//! are ULIDs, and the timestamps are RFC-3339 — none contain a `0x1e`/`0x1f`
//! byte, so no field value can forge a separator.

use serde::{Deserialize, Serialize};

use crate::error::CryptoError;
use crate::sign::{verify, Sig, VerifyingKeyBytes};

/// US (unit separator) — between fields within a record.
const US: u8 = 0x1f;
/// RS (record separator) — terminates each record.
const RS: u8 = 0x1e;
/// Domain string, versioned, prefixing every canonical serialization.
const DOMAIN: &[u8] = b"dochub-provenance-manifest-v1\n";

/// One link in a file's hash chain, as attested by the manifest. Mirrors a
/// `file_versions` row minus the internal storage key. `content_hash` and
/// `prev_hash` are lowercase-hex SHA-256; `created_at` is RFC-3339 UTC.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceLink {
    /// 1-based, monotone version sequence number.
    pub seq: i64,
    /// Lowercase-hex SHA-256 of this version's sealed bytes.
    pub content_hash: String,
    /// Predecessor's `content_hash`; `None` at the head of the chain (seq=1).
    pub prev_hash: Option<String>,
    /// RFC-3339 UTC commit time.
    pub created_at: String,
    /// The committing user's id.
    pub author_id: String,
}

/// The manifest body that gets signed. `head` is the current head version's
/// `content_hash` (`None` for a file with no committed versions);
/// `generated_at` is stamped by the HTTP handler at export time (never derived
/// inside the crypto layer).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceManifest {
    pub file_id: String,
    /// Chain in `seq`-ascending order (seq=1 first) — the order the canonical
    /// serialization and the offline chain walk both consume.
    pub chain: Vec<ProvenanceLink>,
    pub head: Option<String>,
    pub generated_at: String,
}

/// A manifest plus its detached Ed25519 signature and the public key that
/// verifies it. This is the exact JSON shape `GET /api/files/{id}/provenance`
/// returns and `verify-provenance` consumes; `signature` and `public_key` are
/// standard base64.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignedProvenance {
    pub manifest: ProvenanceManifest,
    /// Standard-base64 of the 64-byte detached signature over
    /// [`canonical_bytes`] of `manifest`.
    pub signature: String,
    /// Standard-base64 of the 32-byte Ed25519 public key.
    pub public_key: String,
}

/// The exact bytes signed for `manifest`. See the module docs for the layout.
#[must_use]
pub fn canonical_bytes(manifest: &ProvenanceManifest) -> Vec<u8> {
    let mut out = Vec::with_capacity(DOMAIN.len() + 128 + manifest.chain.len() * 160);
    out.extend_from_slice(DOMAIN);

    field(&mut out, b"file_id", manifest.file_id.as_bytes());
    field(
        &mut out,
        b"head",
        manifest.head.as_deref().unwrap_or("").as_bytes(),
    );
    field(&mut out, b"generated_at", manifest.generated_at.as_bytes());
    field(
        &mut out,
        b"chain",
        manifest.chain.len().to_string().as_bytes(),
    );

    for link in &manifest.chain {
        out.extend_from_slice(link.seq.to_string().as_bytes());
        out.push(US);
        out.extend_from_slice(link.content_hash.as_bytes());
        out.push(US);
        out.extend_from_slice(link.prev_hash.as_deref().unwrap_or("").as_bytes());
        out.push(US);
        out.extend_from_slice(link.created_at.as_bytes());
        out.push(US);
        out.extend_from_slice(link.author_id.as_bytes());
        out.push(RS);
    }
    out
}

/// Write one `label US value RS` record.
fn field(out: &mut Vec<u8>, label: &[u8], value: &[u8]) {
    out.extend_from_slice(label);
    out.push(US);
    out.extend_from_slice(value);
    out.push(RS);
}

/// Why a provenance verification failed. Distinguishes a signature failure from
/// a chain-linkage failure so the CLI can report precisely.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ProvenanceError {
    /// `signature` or `public_key` was not valid base64.
    #[error("field `{0}` is not valid base64")]
    BadBase64(&'static str),
    /// The public key was not exactly 32 bytes.
    #[error("public key is not 32 bytes")]
    BadPublicKeyLength,
    /// The signature was not exactly 64 bytes.
    #[error("signature is not 64 bytes")]
    BadSignatureLength,
    /// The Ed25519 signature did not verify against the manifest and key.
    #[error("signature does not verify: {0}")]
    Signature(#[from] CryptoError),
    /// A link's `prev_hash` does not point at the previous link's
    /// `content_hash` (or seq=1 is not the head). Carries the offending `seq`.
    #[error("chain broken at seq {0}: prev_hash does not match the previous link")]
    ChainBroken(i64),
    /// The manifest's `head` does not equal the last link's `content_hash`.
    #[error("head does not match the last link's content_hash")]
    HeadMismatch,
}

/// Re-walk the manifest's chain offline: each link's `prev_hash` must equal the
/// previous link's `content_hash` (and be absent at seq=1), and `head` must
/// equal the last link's `content_hash`. Does not touch the signature or any
/// bytes — this is the linkage check a recipient runs alongside [`verify`].
pub fn verify_manifest_chain(manifest: &ProvenanceManifest) -> Result<(), ProvenanceError> {
    let mut prev: Option<&str> = None;
    for link in &manifest.chain {
        let ok = match (prev, link.prev_hash.as_deref()) {
            (None, None) => true,
            (Some(expected), Some(claimed)) => expected == claimed,
            _ => false,
        };
        if !ok {
            return Err(ProvenanceError::ChainBroken(link.seq));
        }
        prev = Some(&link.content_hash);
    }

    let head_ok = match (manifest.head.as_deref(), manifest.chain.last()) {
        (None, None) => true,
        (Some(head), Some(last)) => head == last.content_hash,
        _ => false,
    };
    if !head_ok {
        return Err(ProvenanceError::HeadMismatch);
    }
    Ok(())
}

/// Full offline verification of a [`SignedProvenance`]: decode the key and
/// signature, verify the Ed25519 signature over [`canonical_bytes`], **and**
/// re-walk the chain. Returns `Ok(())` only if both pass. This is what the
/// `verify-provenance` CLI runs; it needs no DB or network.
pub fn verify_signed(signed: &SignedProvenance) -> Result<(), ProvenanceError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let pk = STANDARD
        .decode(signed.public_key.as_bytes())
        .map_err(|_| ProvenanceError::BadBase64("public_key"))?;
    let pk: VerifyingKeyBytes = pk
        .try_into()
        .map_err(|_| ProvenanceError::BadPublicKeyLength)?;

    let sig = STANDARD
        .decode(signed.signature.as_bytes())
        .map_err(|_| ProvenanceError::BadBase64("signature"))?;
    let sig: Sig = sig
        .try_into()
        .map_err(|_| ProvenanceError::BadSignatureLength)?;

    verify(&pk, &canonical_bytes(&signed.manifest), &sig)?;
    verify_manifest_chain(&signed.manifest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sign::{generate_signing_key, sign};
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    fn link(seq: i64, content: &str, prev: Option<&str>) -> ProvenanceLink {
        ProvenanceLink {
            seq,
            content_hash: content.into(),
            prev_hash: prev.map(Into::into),
            created_at: format!("2026-07-06T00:0{seq}:00Z"),
            author_id: "01AUTHOR".into(),
        }
    }

    fn sample() -> ProvenanceManifest {
        let chain = vec![
            link(1, "aaaa", None),
            link(2, "bbbb", Some("aaaa")),
            link(3, "cccc", Some("bbbb")),
        ];
        ProvenanceManifest {
            file_id: "01FILE".into(),
            head: Some("cccc".into()),
            chain,
            generated_at: "2026-07-06T12:00:00Z".into(),
        }
    }

    fn sign_manifest(manifest: ProvenanceManifest) -> SignedProvenance {
        let (sk, vk) = generate_signing_key();
        let sig = sign(&sk, &canonical_bytes(&manifest));
        SignedProvenance {
            manifest,
            signature: STANDARD.encode(sig),
            public_key: STANDARD.encode(vk),
        }
    }

    #[test]
    fn canonical_bytes_are_stable_and_documented() {
        let m = ProvenanceManifest {
            file_id: "F".into(),
            head: Some("aaaa".into()),
            chain: vec![link(1, "aaaa", None)],
            generated_at: "T".into(),
        };
        // Reproduce the documented layout by hand.
        let mut want = b"dochub-provenance-manifest-v1\n".to_vec();
        want.extend_from_slice(b"file_id\x1fF\x1e");
        want.extend_from_slice(b"head\x1faaaa\x1e");
        want.extend_from_slice(b"generated_at\x1fT\x1e");
        want.extend_from_slice(b"chain\x1f1\x1e");
        want.extend_from_slice(b"1\x1faaaa\x1f\x1f2026-07-06T00:01:00Z\x1f01AUTHOR\x1e");
        assert_eq!(canonical_bytes(&m), want);
    }

    #[test]
    fn signed_manifest_verifies() {
        let signed = sign_manifest(sample());
        assert!(verify_signed(&signed).is_ok());
    }

    #[test]
    fn altering_a_content_hash_breaks_verification() {
        let mut signed = sign_manifest(sample());
        // Change a content_hash: the signature no longer covers these bytes.
        signed.manifest.chain[1].content_hash = "dddd".into();
        assert!(matches!(
            verify_signed(&signed),
            Err(ProvenanceError::Signature(_))
        ));
    }

    #[test]
    fn broken_chain_link_is_detected() {
        let mut m = sample();
        m.chain[2].prev_hash = Some("wrong".into());
        assert!(matches!(
            verify_manifest_chain(&m),
            Err(ProvenanceError::ChainBroken(3))
        ));
    }

    #[test]
    fn head_mismatch_is_detected() {
        let mut m = sample();
        m.head = Some("aaaa".into());
        assert!(matches!(
            verify_manifest_chain(&m),
            Err(ProvenanceError::HeadMismatch)
        ));
    }

    #[test]
    fn empty_chain_with_null_head_is_intact() {
        let m = ProvenanceManifest {
            file_id: "F".into(),
            chain: vec![],
            head: None,
            generated_at: "T".into(),
        };
        assert!(verify_manifest_chain(&m).is_ok());
    }

    #[test]
    fn bad_base64_signature_is_reported() {
        let mut signed = sign_manifest(sample());
        signed.signature = "not base64!!!".into();
        assert!(matches!(
            verify_signed(&signed),
            Err(ProvenanceError::BadBase64("signature"))
        ));
    }

    #[test]
    fn wrong_length_key_is_reported() {
        let mut signed = sign_manifest(sample());
        signed.public_key = STANDARD.encode([0u8; 16]);
        assert!(matches!(
            verify_signed(&signed),
            Err(ProvenanceError::BadPublicKeyLength)
        ));
    }

    #[test]
    fn json_roundtrip_preserves_canonical_bytes() {
        let signed = sign_manifest(sample());
        let json = serde_json::to_string(&signed).unwrap();
        let back: SignedProvenance = serde_json::from_str(&json).unwrap();
        assert_eq!(
            canonical_bytes(&signed.manifest),
            canonical_bytes(&back.manifest)
        );
        assert!(verify_signed(&back).is_ok());
    }
}
