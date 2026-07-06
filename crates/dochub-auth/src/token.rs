//! Session-id and CSRF-token generators. Both 256 bits from `OsRng`,
//! base64url-encoded.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::Engine;

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
