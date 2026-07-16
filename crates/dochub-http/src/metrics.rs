//! Process-wide HTTP metrics in Prometheus exposition format.
//!
//! A tiny hand-rolled counter set (no new dependency) that complements the
//! per-request [`crate::access_log`] events: logs give per-request detail;
//! these give the aggregates a dashboard or alert rule needs. The access-log
//! middleware records every response here; [`render`] serves it at `/metrics`.
//!
//! Only non-sensitive aggregates are exposed (response counts by status class,
//! in-flight gauge, uptime, and a request-latency histogram). `/metrics` is
//! unauthenticated on the app origin (the Prometheus norm); restrict it by
//! network policy if that matters.

use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

/// Upper bounds (inclusive, in microseconds) of the latency histogram buckets.
/// Prometheus default-ish spread from 5ms to 10s — enough resolution to watch a
/// p95/p99 SLO without the cardinality of per-endpoint series. A sample lands in
/// the first bucket whose bound it doesn't exceed; anything slower is `+Inf`.
const LATENCY_BUCKETS_US: [u64; 11] = [
    5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000,
    10_000_000,
];
/// The same bounds as `le` label strings (seconds), pre-formatted so rendering
/// stays integer-only — no float casts. Kept in lockstep with `LATENCY_BUCKETS_US`.
const LATENCY_BUCKET_LE: [&str; 11] = [
    "0.005", "0.01", "0.025", "0.05", "0.1", "0.25", "0.5", "1", "2.5", "5", "10",
];
/// One counter per bucket plus a trailing `+Inf` overflow slot.
const N_BUCKETS: usize = LATENCY_BUCKETS_US.len() + 1;

#[derive(Debug, Default)]
pub(crate) struct Metrics {
    class_2xx: AtomicU64,
    class_3xx: AtomicU64,
    class_4xx: AtomicU64,
    class_5xx: AtomicU64,
    in_flight: AtomicU64,
    /// Non-cumulative per-bucket sample counts; index `LATENCY_BUCKETS_US.len()`
    /// is the `+Inf` overflow. Rendered cumulatively per the histogram spec.
    latency_buckets: [AtomicU64; N_BUCKETS],
    /// Sum of all observed latencies, in microseconds (rendered as seconds).
    latency_sum_us: AtomicU64,
}

impl Metrics {
    /// A request entered the stack.
    fn start(&self) {
        self.in_flight.fetch_add(1, Ordering::Relaxed);
    }

    /// A request left the stack with `status` after `elapsed`.
    fn end(&self, status: u16, elapsed: Duration) {
        // saturating_sub semantics: never wrap below zero if start/end drift.
        let _ = self
            .in_flight
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                Some(n.saturating_sub(1))
            });
        if let Some(bucket) = match status / 100 {
            2 => Some(&self.class_2xx),
            3 => Some(&self.class_3xx),
            4 => Some(&self.class_4xx),
            5 => Some(&self.class_5xx),
            _ => None,
        } {
            bucket.fetch_add(1, Ordering::Relaxed);
        }
        // Record latency regardless of status class (a 1xx still consumed time).
        let us = elapsed.as_micros().min(u64::MAX as u128) as u64;
        self.latency_sum_us.fetch_add(us, Ordering::Relaxed);
        let idx = LATENCY_BUCKETS_US
            .iter()
            .position(|&bound| us <= bound)
            .unwrap_or(LATENCY_BUCKETS_US.len());
        self.latency_buckets[idx].fetch_add(1, Ordering::Relaxed);
    }

    fn expose(&self, uptime_seconds: u64) -> String {
        let load = |a: &AtomicU64| a.load(Ordering::Relaxed);
        let mut out = format!(
            "# HELP dochub_http_requests_total Total HTTP responses by status class.\n\
             # TYPE dochub_http_requests_total counter\n\
             dochub_http_requests_total{{class=\"2xx\"}} {}\n\
             dochub_http_requests_total{{class=\"3xx\"}} {}\n\
             dochub_http_requests_total{{class=\"4xx\"}} {}\n\
             dochub_http_requests_total{{class=\"5xx\"}} {}\n\
             # HELP dochub_http_requests_in_flight HTTP requests currently being served.\n\
             # TYPE dochub_http_requests_in_flight gauge\n\
             dochub_http_requests_in_flight {}\n\
             # HELP dochub_uptime_seconds Process uptime in seconds.\n\
             # TYPE dochub_uptime_seconds gauge\n\
             dochub_uptime_seconds {}\n",
            load(&self.class_2xx),
            load(&self.class_3xx),
            load(&self.class_4xx),
            load(&self.class_5xx),
            load(&self.in_flight),
            uptime_seconds,
        );

        // Latency histogram. Buckets are cumulative (`le` = "less than or equal"),
        // so each line sums all samples up to and including its bound.
        out.push_str(
            "# HELP dochub_http_request_duration_seconds HTTP request latency.\n\
             # TYPE dochub_http_request_duration_seconds histogram\n",
        );
        let mut cumulative = 0u64;
        for (i, le) in LATENCY_BUCKET_LE.iter().enumerate() {
            cumulative += load(&self.latency_buckets[i]);
            let _ = writeln!(
                out,
                "dochub_http_request_duration_seconds_bucket{{le=\"{le}\"}} {cumulative}"
            );
        }
        // `+Inf` bucket = every sample, and equals `_count`.
        cumulative += load(&self.latency_buckets[LATENCY_BUCKETS_US.len()]);
        // Seconds with 6-decimal precision from the microsecond sum — integer
        // math only, so no float-cast precision lint.
        let sum_us = load(&self.latency_sum_us);
        let _ = writeln!(
            out,
            "dochub_http_request_duration_seconds_bucket{{le=\"+Inf\"}} {cumulative}\n\
             dochub_http_request_duration_seconds_sum {}.{:06}\n\
             dochub_http_request_duration_seconds_count {cumulative}",
            sum_us / 1_000_000,
            sum_us % 1_000_000,
        );
        out
    }
}

fn metrics() -> &'static Metrics {
    static M: OnceLock<Metrics> = OnceLock::new();
    M.get_or_init(Metrics::default)
}

/// Record that a request has entered the stack (in-flight +1).
pub(crate) fn record_start() {
    metrics().start();
}

/// Record a completed request with its response status and wall-clock duration
/// (in-flight -1, status-class +1, latency observed).
pub(crate) fn record_end(status: u16, elapsed: Duration) {
    metrics().end(status, elapsed);
}

/// Render the current metrics in Prometheus text exposition format.
pub(crate) fn render(uptime_seconds: u64) -> String {
    metrics().expose(uptime_seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposition_has_expected_series_and_counts() {
        let m = Metrics::default();
        m.start();
        m.end(200, Duration::from_millis(3)); // → le=0.005 bucket
        m.end(404, Duration::from_millis(30)); // → le=0.05 bucket
        m.end(503, Duration::from_secs(20)); // → +Inf overflow
        let text = m.expose(42);
        assert!(text.contains("dochub_http_requests_total{class=\"2xx\"} 1"));
        assert!(text.contains("dochub_http_requests_total{class=\"4xx\"} 1"));
        assert!(text.contains("dochub_http_requests_total{class=\"5xx\"} 1"));
        // one start, three ends → in-flight underflow is clamped at 0.
        assert!(text.contains("dochub_http_requests_in_flight 0"));
        assert!(text.contains("dochub_uptime_seconds 42"));
        // Every series carries a HELP + TYPE line (4 now, incl. the histogram).
        assert_eq!(text.matches("# TYPE").count(), 4);
    }

    #[test]
    fn latency_histogram_is_cumulative_and_totals_correctly() {
        let m = Metrics::default();
        m.end(200, Duration::from_millis(3)); // ≤ 5ms
        m.end(200, Duration::from_millis(30)); // ≤ 50ms
        m.end(200, Duration::from_secs(20)); // > 10s → +Inf only
        let text = m.expose(0);
        // 3ms is in the first bucket; buckets are cumulative.
        assert!(text.contains("dochub_http_request_duration_seconds_bucket{le=\"0.005\"} 1"));
        // By 50ms, both the 3ms and 30ms samples are included.
        assert!(text.contains("dochub_http_request_duration_seconds_bucket{le=\"0.05\"} 2"));
        // +Inf and _count include every sample.
        assert!(text.contains("dochub_http_request_duration_seconds_bucket{le=\"+Inf\"} 3"));
        assert!(text.contains("dochub_http_request_duration_seconds_count 3"));
        // Sum ≈ 0.003 + 0.030 + 20 = 20.033s.
        assert!(text.contains("dochub_http_request_duration_seconds_sum 20.033"));
    }
}
