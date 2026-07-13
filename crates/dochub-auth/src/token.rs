//! Session-id, CSRF-token, and API-token generators. All draw 256 bits from
//! `OsRng` and base64url-encode them. API tokens additionally carry a stored
//! SHA-256 hash so the plaintext never touches the database.

use std::fmt::Write as _;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::Engine;
use sha2::{Digest, Sha256};

/// Prefix identifying a Doc-Hub personal access token. A stable, greppable
/// marker so the tokens are recognizable in logs/config and to secret scanners.
pub const API_TOKEN_PREFIX: &str = "dh_pat_";

fn random_bytes() -> [u8; 32] {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    buf
}

#[must_use]
pub fn generate_session_id() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes())
}

#[must_use]
pub fn generate_csrf_token() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes())
}

/// Mint a personal access token. Returns `(plaintext, hash)`: the plaintext is
/// shown to the user exactly once and never persisted; only the hash is stored.
#[must_use]
pub fn generate_api_token() -> (String, String) {
    let body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes());
    let plaintext = format!("{API_TOKEN_PREFIX}{body}");
    let hash = hash_api_token(&plaintext);
    (plaintext, hash)
}

/// SHA-256 (lowercase hex) of a token — the value stored at rest and used for
/// exact-match lookup of a presented bearer. The token's 256 bits of entropy
/// make a preimage/enumeration attack on the hash infeasible.
#[must_use]
pub fn hash_api_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for b in digest {
        let _ = write!(hex, "{b:02x}");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_token_is_prefixed_and_hash_is_stable() {
        let (plaintext, hash) = generate_api_token();
        assert!(plaintext.starts_with(API_TOKEN_PREFIX));
        // Hash is SHA-256 hex (64 chars) and reproducible from the plaintext.
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(hash, hash_api_token(&plaintext));
    }

    #[test]
    fn distinct_tokens_have_distinct_hashes() {
        let (p1, h1) = generate_api_token();
        let (p2, h2) = generate_api_token();
        assert_ne!(p1, p2);
        assert_ne!(h1, h2);
    }
}
