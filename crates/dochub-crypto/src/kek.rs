//! Key-encryption-key layer: a master KEK wraps per-workspace DEKs.
//!
//! `EnvKek` is the Phase 0 default provider — one 32-byte master key supplied
//! at boot (env/secret), wrapping DEKs with the same AES-256-GCM envelope used
//! for documents. External KMS providers implement the same [`KeyProvider`]
//! trait later without touching callers.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::envelope::{open_bytes, random_nonce, seal_bytes, Dek};
use crate::error::CryptoError;

/// A DEK wrapped under a KEK. `ct` is a full envelope
/// (`0x01 ‖ nonce ‖ ciphertext ‖ tag`); `key_version` records which KEK sealed
/// it, so rotation can re-wrap without rewriting document blobs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WrappedDek {
    pub ct: Vec<u8>,
    pub key_version: u32,
}

/// Wraps and unwraps DEKs. The only trust boundary crypto callers see.
pub trait KeyProvider {
    fn wrap(&self, dek: &Dek) -> Result<WrappedDek, CryptoError>;
    fn unwrap(&self, w: &WrappedDek) -> Result<Dek, CryptoError>;
    fn key_version(&self) -> u32;
}

/// Phase 0 provider: a single in-process master key. Zeroized on drop; `Debug`
/// is redacted so the key cannot leak through a print.
#[derive(ZeroizeOnDrop)]
pub struct EnvKek {
    kek: [u8; 32],
    #[zeroize(skip)]
    key_version: u32,
}

impl std::fmt::Debug for EnvKek {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnvKek")
            .field("kek", &"<redacted>")
            .field("key_version", &self.key_version)
            .finish()
    }
}

impl EnvKek {
    /// Construct from raw 32-byte key material.
    pub fn from_bytes(key: [u8; 32], key_version: u32) -> Self {
        Self {
            kek: key,
            key_version,
        }
    }

    /// Construct from a standard-base64 32-byte key (e.g. an env var). The
    /// decoded buffer is zeroized whether or not it validates.
    pub fn from_base64(encoded: &str, key_version: u32) -> Result<Self, CryptoError> {
        let mut decoded = STANDARD
            .decode(encoded.trim())
            .map_err(|_| CryptoError::BadFormat)?;
        if decoded.len() != 32 {
            decoded.zeroize();
            return Err(CryptoError::BadKeyLength);
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        decoded.zeroize();
        Ok(Self {
            kek: key,
            key_version,
        })
    }

    /// Seal arbitrary secret bytes under this master KEK, returning the envelope
    /// (`0x01 ‖ nonce ‖ ct ‖ tag`). Same AES-256-GCM primitive as DEK wrapping;
    /// used to seal a workspace's Ed25519 provenance signing seed (Phase 1
    /// §2.1). A fresh random nonce is drawn per call.
    #[must_use]
    pub fn seal_secret(&self, plaintext: &[u8]) -> Vec<u8> {
        seal_bytes(&self.kek, random_nonce(), plaintext)
    }

    /// Open a `seal_secret` envelope. Returns `Err` — never panics — on any
    /// malformed, truncated, wrong-version, or tampered input.
    pub fn open_secret(&self, envelope: &[u8]) -> Result<Vec<u8>, CryptoError> {
        open_bytes(&self.kek, envelope)
    }
}

impl KeyProvider for EnvKek {
    fn wrap(&self, dek: &Dek) -> Result<WrappedDek, CryptoError> {
        Ok(WrappedDek {
            ct: seal_bytes(&self.kek, random_nonce(), dek.expose()),
            key_version: self.key_version,
        })
    }

    fn unwrap(&self, w: &WrappedDek) -> Result<Dek, CryptoError> {
        let mut pt = open_bytes(&self.kek, &w.ct)?;
        if pt.len() != 32 {
            pt.zeroize();
            return Err(CryptoError::BadKeyLength);
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&pt);
        pt.zeroize();
        Ok(Dek::from_array(key))
    }

    fn key_version(&self) -> u32 {
        self.key_version
    }
}
