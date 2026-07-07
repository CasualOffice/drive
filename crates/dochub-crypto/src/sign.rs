//! Ed25519 detached signatures (Phase 1 build §2.1 — provenance).
//!
//! The signing primitive for provenance manifests: a workspace holds an Ed25519
//! keypair (secret sealed under the master KEK; see `dochub-db`), signs the
//! canonical serialization of a manifest, and any recipient verifies the
//! detached signature offline against the public key. Pure EdDSA via the
//! audited `ed25519-dalek` (BSD-3-Clause); no homebrew primitives.
//!
//! Keys are handled as raw 32-byte arrays at this boundary so the caller (the
//! DB layer that unwraps the sealed secret) never has to name a dalek type. The
//! secret is a 32-byte Ed25519 *seed*: [`SigningKeyBytes`]. Every path returns
//! [`CryptoError`] rather than panicking — [`verify`] rejects a non-canonical
//! public key or any bad signature; [`sign`] and [`generate_signing_key`] are
//! infallible for a valid seed (any 32 bytes is a valid seed).

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::RngCore;

use crate::error::CryptoError;

/// A 32-byte Ed25519 secret seed. The signing key is derived from it; it is
/// sealed under the master KEK at rest and lives in memory only when signing.
pub type SigningKeyBytes = [u8; 32];
/// A 32-byte Ed25519 public (verifying) key. Not secret — shipped in the
/// provenance response so recipients can verify offline.
pub type VerifyingKeyBytes = [u8; 32];
/// A 64-byte detached Ed25519 signature (`R ‖ s`).
pub type Sig = [u8; 64];

/// Generate a fresh Ed25519 keypair. The 32-byte seed comes from the OS CSPRNG
/// (`rand::rng()`); the verifying key is derived from it. Returns
/// `(secret_seed, public_key)` as raw bytes.
#[must_use]
pub fn generate_signing_key() -> (SigningKeyBytes, VerifyingKeyBytes) {
    let mut seed = [0u8; 32];
    rand::rng().fill_bytes(&mut seed);
    let sk = SigningKey::from_bytes(&seed);
    let vk = sk.verifying_key().to_bytes();
    (seed, vk)
}

/// Sign `msg` with the secret seed `sk`, returning a 64-byte detached
/// signature. Any 32-byte seed is a valid Ed25519 key, so this cannot fail.
#[must_use]
pub fn sign(sk: &SigningKeyBytes, msg: &[u8]) -> Sig {
    let signing_key = SigningKey::from_bytes(sk);
    signing_key.sign(msg).to_bytes()
}

/// Verify a detached signature. Returns `Ok(())` only when `sig` is a valid,
/// canonical Ed25519 signature of `msg` under `vk`. Never panics:
///
/// - [`CryptoError::BadPublicKey`] if `vk` is not a valid curve point;
/// - [`CryptoError::SignatureInvalid`] if the signature (or its encoding) does
///   not verify — including the malleable / non-canonical forms `verify_strict`
///   rejects.
pub fn verify(vk: &VerifyingKeyBytes, msg: &[u8], sig: &Sig) -> Result<(), CryptoError> {
    let verifying_key = VerifyingKey::from_bytes(vk).map_err(|_| CryptoError::BadPublicKey)?;
    let signature = Signature::from_bytes(sig);
    verifying_key
        .verify_strict(msg, &signature)
        .map_err(|_| CryptoError::SignatureInvalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn sign_verify_roundtrip() {
        let (sk, vk) = generate_signing_key();
        let msg = b"provenance manifest bytes";
        let sig = sign(&sk, msg);
        assert!(verify(&vk, msg, &sig).is_ok());
    }

    #[test]
    fn wrong_key_fails() {
        let (sk, _vk) = generate_signing_key();
        let (_sk2, vk2) = generate_signing_key();
        let sig = sign(&sk, b"hello");
        assert!(matches!(
            verify(&vk2, b"hello", &sig),
            Err(CryptoError::SignatureInvalid)
        ));
    }

    #[test]
    fn tampered_message_fails() {
        let (sk, vk) = generate_signing_key();
        let sig = sign(&sk, b"hello");
        assert!(matches!(
            verify(&vk, b"hell0", &sig),
            Err(CryptoError::SignatureInvalid)
        ));
    }

    #[test]
    fn tampered_signature_fails() {
        let (sk, vk) = generate_signing_key();
        let mut sig = sign(&sk, b"hello");
        sig[0] ^= 0xff;
        assert!(verify(&vk, b"hello", &sig).is_err());
    }

    #[test]
    fn all_zero_public_key_is_rejected_not_panicked() {
        // The all-zero point is a small-order / non-canonical key; verify must
        // return an error, never panic.
        let (sk, _vk) = generate_signing_key();
        let sig = sign(&sk, b"x");
        let _ = verify(&[0u8; 32], b"x", &sig);
    }

    #[test]
    fn generated_keys_are_distinct() {
        let (sk1, vk1) = generate_signing_key();
        let (sk2, vk2) = generate_signing_key();
        assert_ne!(sk1, sk2);
        assert_ne!(vk1, vk2);
    }

    proptest! {
        /// For any message, a genuine signature verifies and any single-bit
        /// flip of the message breaks verification.
        #[test]
        fn roundtrip_then_tamper(msg in prop::collection::vec(any::<u8>(), 0..256),
                                 bit in any::<prop::sample::Index>()) {
            let (sk, vk) = generate_signing_key();
            let sig = sign(&sk, &msg);
            prop_assert!(verify(&vk, &msg, &sig).is_ok());

            if !msg.is_empty() {
                let mut tampered = msg.clone();
                let i = bit.index(tampered.len());
                tampered[i] ^= 1;
                prop_assert!(verify(&vk, &tampered, &sig).is_err());
            }
        }

        /// A signature never verifies under an independently generated key.
        #[test]
        fn wrong_key_never_verifies(msg in prop::collection::vec(any::<u8>(), 0..128)) {
            let (sk, _vk) = generate_signing_key();
            let (_sk2, vk2) = generate_signing_key();
            let sig = sign(&sk, &msg);
            prop_assert!(verify(&vk2, &msg, &sig).is_err());
        }
    }
}
