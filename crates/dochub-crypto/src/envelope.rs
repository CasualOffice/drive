//! AES-256-GCM sealing/opening over the wire format
//! `0x01 ‖ nonce(12) ‖ ciphertext ‖ tag(16)`.
//!
//! The version byte lets us change the layout later without ambiguity; the
//! 96-bit nonce is fresh-random per seal (GCM's safe nonce size). AAD is empty
//! — callers that need bound metadata get a dedicated API later, not a silent
//! overload of this one.

use aws_lc_rs::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use zeroize::ZeroizeOnDrop;

use crate::error::CryptoError;

/// Envelope version byte. Bump only for an incompatible layout change.
pub(crate) const VERSION: u8 = 0x01;
/// AES-256-GCM authentication tag length.
pub(crate) const TAG_LEN: usize = 16;
/// Shortest valid blob: version + nonce + tag, i.e. an empty plaintext.
const MIN_LEN: usize = 1 + NONCE_LEN + TAG_LEN;

/// A 256-bit data-encryption key. Zeroized on drop; never logged. `Debug` is
/// hand-rolled to redact the bytes so it cannot leak through a derived print.
#[derive(ZeroizeOnDrop)]
pub struct Dek([u8; 32]);

impl std::fmt::Debug for Dek {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dek").field("bytes", &"<redacted>").finish()
    }
}

impl Dek {
    pub(crate) fn from_array(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Crate-internal accessor for the wrap path. Not public: raw key bytes
    /// leave `dochub-crypto` only inside a sealed envelope.
    pub(crate) fn expose(&self) -> &[u8; 32] {
        &self.0
    }

    #[cfg(test)]
    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// A sealed document blob: `0x01 ‖ nonce ‖ ciphertext ‖ tag`. Opaque bytes,
/// safe to store or hash — it carries no key material.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SealedBlob(pub Vec<u8>);

/// Fresh 256-bit DEK from the system CSPRNG.
pub fn generate_dek() -> Dek {
    let mut bytes = [0u8; 32];
    fill(&mut bytes);
    Dek(bytes)
}

/// Seal `plaintext` under `dek` with a fresh random nonce.
pub fn seal(dek: &Dek, plaintext: &[u8]) -> SealedBlob {
    SealedBlob(seal_bytes(&dek.0, random_nonce(), plaintext))
}

/// Open a sealed blob under `dek`. Returns `Err` — never panics — on any
/// malformed, truncated, wrong-version, or tampered input.
pub fn open(dek: &Dek, blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
    open_bytes(&dek.0, blob)
}

/// Fill `buf` from the system CSPRNG. A failure here means the OS entropy
/// source is broken; there is no safe way to continue, so we abort.
pub(crate) fn fill(buf: &mut [u8]) {
    SystemRandom::new()
        .fill(buf)
        .expect("system CSPRNG failure");
}

pub(crate) fn random_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    fill(&mut nonce);
    nonce
}

fn aead_key(key: &[u8; 32]) -> LessSafeKey {
    // A 32-byte key is always valid for AES-256-GCM; `new` can only fail on a
    // length mismatch, which the type system rules out here.
    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).expect("AES-256 key is 32 bytes"))
}

/// Core seal: `0x01 ‖ nonce ‖ AES-256-GCM(key, nonce, plaintext) ‖ tag`.
pub(crate) fn seal_bytes(key: &[u8; 32], nonce: [u8; NONCE_LEN], plaintext: &[u8]) -> Vec<u8> {
    let mut in_out = plaintext.to_vec();
    aead_key(key)
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut in_out)
        .expect("AES-256-GCM sealing is infallible for a valid key");

    let mut out = Vec::with_capacity(1 + NONCE_LEN + in_out.len());
    out.push(VERSION);
    out.extend_from_slice(&nonce);
    out.append(&mut in_out);
    out
}

/// Core open. Validates length and version before touching the cipher.
pub(crate) fn open_bytes(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if blob.len() < MIN_LEN {
        return Err(CryptoError::BadFormat);
    }
    if blob[0] != VERSION {
        return Err(CryptoError::UnsupportedVersion(blob[0]));
    }

    let nonce: [u8; NONCE_LEN] = blob[1..=NONCE_LEN]
        .try_into()
        .expect("slice is exactly NONCE_LEN by the length check above");
    let mut in_out = blob[1 + NONCE_LEN..].to_vec();

    let plaintext = aead_key(key)
        .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::Decrypt)?;
    Ok(plaintext.to_vec())
}

/// Deterministic seal for known-answer tests. Test-only so production code
/// cannot accidentally reuse a nonce.
#[cfg(test)]
pub(crate) fn seal_with_nonce(dek: &Dek, nonce: [u8; NONCE_LEN], plaintext: &[u8]) -> SealedBlob {
    SealedBlob(seal_bytes(&dek.0, nonce, plaintext))
}
