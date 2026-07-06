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

#![forbid(unsafe_code)]

mod envelope;
mod error;
mod kek;

pub use envelope::{generate_dek, open, seal, Dek, SealedBlob};
pub use error::CryptoError;
pub use kek::{EnvKek, KeyProvider, WrappedDek};

#[cfg(test)]
mod tests;
