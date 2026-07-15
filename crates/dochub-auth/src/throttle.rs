//! Brute-force throttle for password sign-in.
//!
//! Password `sign-in` verifies an Argon2id hash — expensive by design — so an
//! unthrottled endpoint is both a credential-stuffing target and a CPU-DoS
//! (every guess burns a full hash). This adds an in-memory, per-username token
//! bucket: a handful of rapid failures are allowed, then further attempts are
//! refused with `429` until the bucket refills.
//!
//! Keyed by **username** (lowercased). This defends the common attack — many
//! guesses against one account — and throttles username-enumeration probes. It
//! does not stop an attacker spreading one guess across many usernames; that
//! needs per-IP limiting, which belongs at the proxy / a later Redis-backed
//! limiter (like the upload + AI limiters). The bucket **self-heals** (refills
//! over time) rather than hard-locking, so a legitimate user is never
//! permanently locked out — and a correct password [`record_success`] clears
//! the key immediately, so normal use never trips it.
//!
//! Process-global via `OnceLock` (single instance; the cluster story is the
//! shared limiter above). The check is done *before* the hash verify, so a
//! throttled guess costs no Argon2 work.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Rapid failures allowed before throttling kicks in.
const CAPACITY: f64 = 5.0;
/// One attempt is restored per minute.
const REFILL_PER_SEC: f64 = 1.0 / 60.0;

struct Bucket {
    tokens: f64,
    last: Instant,
}

/// Per-username failed-attempt buckets.
#[derive(Default)]
pub(crate) struct LoginThrottle {
    inner: Mutex<HashMap<String, Bucket>>,
}

impl LoginThrottle {
    fn refill(b: &mut Bucket, now: Instant) {
        let elapsed = now.duration_since(b.last).as_secs_f64();
        b.tokens = (b.tokens + elapsed * REFILL_PER_SEC).min(CAPACITY);
        b.last = now;
    }

    /// Whether a sign-in attempt for `key` is currently allowed. Does not
    /// consume — call [`record_failure`](Self::record_failure) only when an
    /// attempt actually fails. An unseen key (no recent failures) is allowed.
    pub(crate) fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match map.get_mut(key) {
            Some(b) => {
                Self::refill(b, now);
                b.tokens >= 1.0
            }
            None => true,
        }
    }

    /// Record a failed attempt for `key` (consume one token).
    pub(crate) fn record_failure(&self, key: &str) {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let b = map.entry(key.to_string()).or_insert(Bucket {
            tokens: CAPACITY,
            last: now,
        });
        Self::refill(b, now);
        b.tokens = (b.tokens - 1.0).max(0.0);
    }

    /// Clear `key` after a successful sign-in, so a legitimate user's earlier
    /// fat-fingered attempts don't count against them.
    pub(crate) fn record_success(&self, key: &str) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(key);
    }

    /// Drop buckets untouched for `idle_for`. Username-enumeration probing
    /// creates a bucket per attempted username; without eviction the map grows
    /// unbounded for the life of the process. A bucket idle this long has
    /// fully refilled to `CAPACITY`, so dropping it is lossless.
    fn evict_idle(&self, idle_for: Duration) {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, b| now.duration_since(b.last) < idle_for);
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

/// The process-global sign-in throttle.
pub(crate) fn login_throttle() -> &'static LoginThrottle {
    static T: OnceLock<LoginThrottle> = OnceLock::new();
    T.get_or_init(LoginThrottle::default)
}

/// Normalize a username into a throttle key (trim + lowercase), so case/spacing
/// variants of the same account share one bucket.
pub(crate) fn throttle_key(username: &str) -> String {
    username.trim().to_ascii_lowercase()
}

/// Evict sign-in throttle buckets idle for `idle_for`. Public reaper entry
/// point, driven by the HTTP layer's periodic limiter reaper so the map stays
/// bounded. See [`LoginThrottle::evict_idle`].
pub fn reap_idle_throttle(idle_for: Duration) {
    login_throttle().evict_idle(idle_for);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttles_after_capacity_failures_and_clears_on_success() {
        let t = LoginThrottle::default();
        let k = "victim";
        // The first CAPACITY attempts are allowed; each failure consumes a token.
        for _ in 0..CAPACITY as usize {
            assert!(t.allow(k));
            t.record_failure(k);
        }
        // Now the bucket is empty → further attempts are refused.
        assert!(!t.allow(k));
        // A successful sign-in clears the key → allowed again immediately.
        t.record_success(k);
        assert!(t.allow(k));
    }

    #[test]
    fn distinct_usernames_have_independent_buckets() {
        let t = LoginThrottle::default();
        for _ in 0..CAPACITY as usize {
            t.record_failure("alice");
        }
        assert!(!t.allow("alice"));
        // bob is untouched.
        assert!(t.allow("bob"));
    }

    #[test]
    fn key_is_normalized() {
        assert_eq!(throttle_key("  Alice "), "alice");
    }

    #[test]
    fn evict_idle_bounds_the_map() {
        let t = LoginThrottle::default();
        // Probing many distinct usernames leaves a bucket each.
        for u in ["a", "b", "c"] {
            t.record_failure(u);
        }
        assert_eq!(t.len(), 3);
        // Fresh buckets survive a generous TTL...
        t.evict_idle(Duration::from_secs(3600));
        assert_eq!(t.len(), 3);
        // ...but a zero TTL treats them all as idle and clears the map.
        t.evict_idle(Duration::ZERO);
        assert_eq!(t.len(), 0);
    }
}
