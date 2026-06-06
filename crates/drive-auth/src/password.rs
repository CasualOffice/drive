//! Argon2id password hashing — OWASP-recommended parameters.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};

use crate::AuthError;

/// OWASP-minimum profile per `docs/research/02-auth.md` §3:
/// `m=19 MiB, t=2, p=1`.
pub const OWASP_PARAMS: (u32, u32, u32) = (19_456, 2, 1);

fn argon2() -> Argon2<'static> {
    let (m, t, p) = OWASP_PARAMS;
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(m, t, p, None).expect("argon2 params"),
    )
}

/// Hash a password into a PHC-format string suitable for storage.
pub fn hash_password(password: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut OsRng);
    argon2()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AuthError::Internal(format!("hash failed: {e}")))
}

/// Verify a candidate password against a stored hash. Returns `Ok(true)` on
/// match, `Ok(false)` on mismatch, `Err(Internal)` if the stored hash is
/// unparseable.
pub fn verify_password(stored_hash: &str, candidate: &str) -> Result<bool, AuthError> {
    let parsed = PasswordHash::new(stored_hash)
        .map_err(|e| AuthError::Internal(format!("hash parse: {e}")))?;
    Ok(argon2()
        .verify_password(candidate.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let h = hash_password("hunter2").unwrap();
        assert!(verify_password(&h, "hunter2").unwrap());
        assert!(!verify_password(&h, "wrong").unwrap());
    }

    #[test]
    fn rejects_garbage_hash() {
        assert!(verify_password("not a phc string", "anything").is_err());
    }
}
