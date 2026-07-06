//! Unit tests: known-answer vectors, round-trips, and tamper/malformed-input
//! property tests. Kept in-crate so they can reach the `#[cfg(test)]`
//! `seal_with_nonce` seam and the crate-internal key accessors.

use proptest::prelude::*;

use crate::envelope::{seal_with_nonce, Dek};
use crate::error::CryptoError;
use crate::{generate_dek, open, seal, EnvKek, KeyProvider, WrappedDek};

fn dek_from(bytes: [u8; 32]) -> Dek {
    Dek::from_array(bytes)
}

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd-length hex");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
        .collect()
}

// --- Known-answer vectors ------------------------------------------------
//
// McGrew & Viega GCM spec, AES-256 test cases 13 and 14: key = 0^256,
// IV = 0^96, empty AAD. These are implementation-independent, so they pin our
// wire format (`0x01 ‖ nonce ‖ ct ‖ tag`) to the real cipher, not to whatever
// our own code happens to emit.

#[test]
fn kat_empty_plaintext() {
    let dek = dek_from([0u8; 32]);
    let nonce = [0u8; 12];
    // Test case 13: empty plaintext -> tag only.
    let tag = "530f8afbc74536b9a963b4f1c4cb738b";
    let mut expected = vec![0x01];
    expected.extend_from_slice(&nonce);
    expected.extend_from_slice(&unhex(tag));

    let sealed = seal_with_nonce(&dek, nonce, b"");
    assert_eq!(sealed.0, expected, "KAT ciphertext mismatch (empty)");
    assert_eq!(open(&dek, &sealed.0).unwrap(), b"");
}

#[test]
fn kat_16_zero_bytes() {
    let dek = dek_from([0u8; 32]);
    let nonce = [0u8; 12];
    let plaintext = [0u8; 16];
    // Test case 14: ciphertext + tag.
    let ct = "cea7403d4d606b6e074ec5d3baf39d18";
    let tag = "d0d1c8a799996bf0265b98b5d48ab919";
    let mut expected = vec![0x01];
    expected.extend_from_slice(&nonce);
    expected.extend_from_slice(&unhex(ct));
    expected.extend_from_slice(&unhex(tag));

    let sealed = seal_with_nonce(&dek, nonce, &plaintext);
    assert_eq!(sealed.0, expected, "KAT ciphertext mismatch (16 zeros)");
    assert_eq!(open(&dek, &sealed.0).unwrap(), plaintext);
}

// --- Basic behaviour -----------------------------------------------------

#[test]
fn seal_is_randomized() {
    let dek = generate_dek();
    let a = seal(&dek, b"same plaintext");
    let b = seal(&dek, b"same plaintext");
    assert_ne!(a.0, b.0, "fresh nonce should make seals differ");
    assert_eq!(open(&dek, &a.0).unwrap(), open(&dek, &b.0).unwrap());
}

#[test]
fn open_rejects_short_and_wrong_version() {
    let dek = generate_dek();
    assert!(matches!(open(&dek, b""), Err(CryptoError::BadFormat)));
    assert!(matches!(
        open(&dek, &[0u8; 10]),
        Err(CryptoError::BadFormat)
    ));

    let mut blob = seal(&dek, b"hello").0;
    blob[0] = 0x02;
    assert!(matches!(
        open(&dek, &blob),
        Err(CryptoError::UnsupportedVersion(0x02))
    ));
}

#[test]
fn wrong_dek_fails() {
    let dek = generate_dek();
    let other = generate_dek();
    let sealed = seal(&dek, b"secret");
    assert!(matches!(open(&other, &sealed.0), Err(CryptoError::Decrypt)));
}

// --- KEK wrap/unwrap -----------------------------------------------------

#[test]
fn kek_wrap_unwrap_roundtrip() {
    let kek = EnvKek::from_bytes([7u8; 32], 3);
    let dek = generate_dek();
    let original = *dek.as_bytes();

    let wrapped = kek.wrap(&dek).unwrap();
    assert_eq!(wrapped.key_version, 3);
    assert_eq!(kek.key_version(), 3);

    let recovered = kek.unwrap(&wrapped).unwrap();
    assert_eq!(
        recovered.as_bytes(),
        &original,
        "unwrap must yield equal DEK"
    );
}

#[test]
fn kek_wrong_key_fails() {
    let kek = EnvKek::from_bytes([1u8; 32], 1);
    let wrong = EnvKek::from_bytes([2u8; 32], 1);
    let wrapped = kek.wrap(&generate_dek()).unwrap();
    assert!(matches!(wrong.unwrap(&wrapped), Err(CryptoError::Decrypt)));
}

#[test]
fn kek_from_base64_roundtrips_and_validates() {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let raw = [9u8; 32];
    let encoded = STANDARD.encode(raw);
    let kek = EnvKek::from_base64(&encoded, 5).unwrap();
    assert_eq!(kek.key_version(), 5);

    let dek = generate_dek();
    let want = *dek.as_bytes();
    let wrapped = kek.wrap(&dek).unwrap();
    assert_eq!(kek.unwrap(&wrapped).unwrap().as_bytes(), &want);

    // Wrong length and non-base64 both error, never panic.
    assert!(matches!(
        EnvKek::from_base64(&STANDARD.encode([0u8; 16]), 0),
        Err(CryptoError::BadKeyLength)
    ));
    assert!(matches!(
        EnvKek::from_base64("not base64!!!", 0),
        Err(CryptoError::BadFormat)
    ));
}

// --- Property tests ------------------------------------------------------

proptest! {
    #[test]
    fn roundtrip_arbitrary(data in proptest::collection::vec(any::<u8>(), 0..4096)) {
        let dek = generate_dek();
        let sealed = seal(&dek, &data);
        prop_assert_eq!(open(&dek, &sealed.0).unwrap(), data);
    }

    #[test]
    fn roundtrip_large(data in proptest::collection::vec(any::<u8>(), 60_000..70_000)) {
        let dek = generate_dek();
        let sealed = seal(&dek, &data);
        prop_assert_eq!(open(&dek, &sealed.0).unwrap(), data);
    }

    /// Flipping any single byte of a sealed blob must error, never panic.
    #[test]
    fn tamper_sealed_blob(
        data in proptest::collection::vec(any::<u8>(), 0..512),
        mask in 1u8..=255,
        idx in any::<prop::sample::Index>(),
    ) {
        let dek = generate_dek();
        let mut blob = seal(&dek, &data).0;
        let i = idx.index(blob.len());
        blob[i] ^= mask;
        prop_assert!(open(&dek, &blob).is_err());
    }

    /// Flipping any single byte of a wrapped DEK must error, never panic.
    #[test]
    fn tamper_wrapped_dek(
        mask in 1u8..=255,
        idx in any::<prop::sample::Index>(),
    ) {
        let kek = EnvKek::from_bytes([4u8; 32], 1);
        let wrapped = kek.wrap(&generate_dek()).unwrap();
        let i = idx.index(wrapped.ct.len());
        let mut ct = wrapped.ct.clone();
        ct[i] ^= mask;
        let tampered = WrappedDek { ct, key_version: wrapped.key_version };
        prop_assert!(kek.unwrap(&tampered).is_err());
    }

    /// key_version is carried verbatim through wrap.
    #[test]
    fn key_version_carried(v in any::<u32>()) {
        let kek = EnvKek::from_bytes([0u8; 32], v);
        let wrapped = kek.wrap(&generate_dek()).unwrap();
        prop_assert_eq!(wrapped.key_version, v);
    }
}
