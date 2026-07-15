//! Per-user in-memory token-bucket rate limiter. Pipeline §6.5.
//!
//! Designed for upload abuse — small surface, no Redis required. The
//! bucket holds `capacity` tokens, refills at `refill_per_sec`, costs 1
//! token per upload. Out of tokens → returns the seconds the caller
//! should wait, suitable for `Retry-After`.
//!
//! Keeps a HashMap<actor, Bucket> behind a Mutex. Plenty for a single
//! Drive instance; clusters get a Redis backend in v0.2.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy)]
pub struct RateLimitConfig {
    pub capacity: f64,
    pub refill_per_sec: f64,
}

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    last: Instant,
}

#[derive(Debug)]
pub struct RateLimiter {
    cfg: RateLimitConfig,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    pub fn new(cfg: RateLimitConfig) -> Self {
        Self {
            cfg,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Try to consume one token for `key`. Returns `Ok(())` when the
    /// caller may proceed, or `Err(retry_after_seconds)` when they're
    /// throttled.
    #[must_use = "callers should respect the retry-after instead of dropping it"]
    pub fn check(&self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate-limit mutex poisoned");
        let bucket = buckets.entry(key.to_string()).or_insert(Bucket {
            tokens: self.cfg.capacity,
            last: now,
        });
        // Refill since last check.
        let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.cfg.refill_per_sec).min(self.cfg.capacity);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            // Seconds until at least one token is available.
            let needed = 1.0 - bucket.tokens;
            let secs = (needed / self.cfg.refill_per_sec).ceil().max(1.0);
            Err(secs as u64)
        }
    }

    /// Cap the in-memory map so we don't leak in front of a long-running
    /// instance with many distinct keys. Driven by [`crate::spawn_limiter_reaper`].
    /// A bucket idle for `idle_for` has fully refilled, so evicting it is
    /// lossless: the next request for that key just recreates a full bucket.
    pub fn evict_idle(&self, idle_for: Duration) {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate-limit mutex poisoned");
        buckets.retain(|_, b| now.saturating_duration_since(b.last) < idle_for);
    }

    /// Number of live buckets — test-only, for asserting reaper behaviour.
    #[cfg(test)]
    pub(crate) fn bucket_count(&self) -> usize {
        self.buckets
            .lock()
            .expect("rate-limit mutex poisoned")
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evict_idle_drops_stale_buckets_keeps_fresh() {
        let rl = RateLimiter::new(RateLimitConfig {
            capacity: 5.0,
            refill_per_sec: 1.0,
        });
        let _ = rl.check("a");
        let _ = rl.check("b");
        assert_eq!(rl.bucket_count(), 2);
        // Both were just touched → nothing is older than an hour → all kept.
        rl.evict_idle(Duration::from_secs(3600));
        assert_eq!(rl.bucket_count(), 2);
        // A zero TTL makes every bucket count as stale → all evicted.
        rl.evict_idle(Duration::ZERO);
        assert_eq!(rl.bucket_count(), 0);
    }

    #[test]
    fn allows_up_to_capacity_then_throttles() {
        let rl = RateLimiter::new(RateLimitConfig {
            capacity: 3.0,
            refill_per_sec: 1.0,
        });
        for _ in 0..3 {
            assert!(rl.check("u").is_ok());
        }
        let r = rl.check("u");
        assert!(r.is_err());
        let secs = r.unwrap_err();
        assert!(secs >= 1, "retry-after should be at least 1s");
    }

    #[test]
    fn keys_are_independent() {
        let rl = RateLimiter::new(RateLimitConfig {
            capacity: 1.0,
            refill_per_sec: 1.0,
        });
        assert!(rl.check("a").is_ok());
        assert!(rl.check("b").is_ok());
        // Both buckets now empty.
        assert!(rl.check("a").is_err());
        assert!(rl.check("b").is_err());
    }

    #[test]
    fn refills_over_time() {
        let rl = RateLimiter::new(RateLimitConfig {
            capacity: 1.0,
            refill_per_sec: 1000.0, // fast for the test
        });
        assert!(rl.check("u").is_ok());
        assert!(rl.check("u").is_err());
        std::thread::sleep(Duration::from_millis(20));
        assert!(
            rl.check("u").is_ok(),
            "should refill within 20ms at 1000/sec"
        );
    }
}
