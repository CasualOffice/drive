use thiserror::Error;

/// Failure modes for envelope operations. No variant carries key or plaintext
/// bytes — errors are safe to log and to surface to callers.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum CryptoError {
    /// AEAD authentication failed: wrong key, wrong nonce, or tampered bytes.
    #[error("decryption failed: authentication tag mismatch or wrong key")]
    Decrypt,
    /// Blob is shorter than `version ‖ nonce ‖ tag`, or otherwise unparseable.
    #[error("malformed sealed blob")]
    BadFormat,
    /// Key material is not exactly 32 bytes.
    #[error("key material is not 32 bytes")]
    BadKeyLength,
    /// Version prefix is not one this build understands.
    #[error("unsupported envelope version: {0:#04x}")]
    UnsupportedVersion(u8),
}
