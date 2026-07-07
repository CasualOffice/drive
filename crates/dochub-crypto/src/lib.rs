//! Envelope encryption for Doc-Hub (Phase 0 build §3).
//!
//! Two-level key hierarchy: a master **KEK** wraps a per-workspace **DEK**; the
//! DEK encrypts document blobs. One AEAD everywhere — AES-256-GCM via
//! `aws-lc-rs` (audited, FIPS-track), fresh 96-bit random nonce per seal, no
//! homebrew primitives.
//!
//! Wire format (documents and wrapped DEKs share it):
//! `0x01 ‖ nonce(12) ‖ ciphertext ‖ tag(16)` — a version byte, then the nonce,
//! then AES-256-GCM output. Version lets the layout change without ambiguity.
//!
//! Invariants: keys never appear in logs, errors, or `Debug`; [`Dek`] and
//! [`EnvKek`] zeroize on drop; every parse path returns [`CryptoError`] instead
//! of panicking on malformed input.
//!
//! The [`chain`] module adds the tamper-evidence primitive — a [`Sha256Hex`]
//! digest with constant-time equality, plus [`hash_content`]/[`entry_hash`] and
//! an append-only [`verify_chain`] — shared by the version engine and the audit
//! log. SHA-256 reuses the same `aws-lc-rs` digest, no new crypto crate.
//!
//! The [`sign`] primitive ([`generate_signing_key`]/[`sign`]/[`verify`]) adds
//! Ed25519 detached signatures via `ed25519-dalek`, and [`provenance`] builds on
//! it: the canonical serialization + offline verification of a signed
//! provenance manifest for a file's hash chain (Phase 1 build §2.1).

#![forbid(unsafe_code)]

mod chain;
mod envelope;
mod error;
mod kek;
pub mod provenance;
mod sign;

pub use chain::{
    entry_hash, hash_content, verify_chain, BreakReason, ChainLink, ChainStatus, Sha256Hex,
};
pub use envelope::{generate_dek, open, seal, Dek, SealedBlob};
pub use error::CryptoError;
pub use kek::{EnvKek, KeyProvider, WrappedDek};
pub use sign::{generate_signing_key, sign, verify, Sig, SigningKeyBytes, VerifyingKeyBytes};

#[cfg(test)]
mod tests;
