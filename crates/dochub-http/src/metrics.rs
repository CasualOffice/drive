//! Process-wide HTTP metrics in Prometheus exposition format.
//!
//! A tiny hand-rolled counter set (no new dependency) that complements the
//! per-request [`crate::access_log`] events: logs give per-request detail;
//! these give the aggregates a dashboard or alert rule needs. The access-log
//! middleware records every response here; [`render`] serves it at `/metrics`.
//!
//! Only non-sensitive aggregates are exposed (response counts by status class,
//! in-flight gauge, uptime). `/metrics` is unauthenticated on the app origin
//! (the Prometheus norm); restrict it by network policy if that matters.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

#[derive(Debug, Default)]
pub(crate) struct Metrics {
    class_2xx: AtomicU64,
    class_3xx: AtomicU64,
    class_4xx: AtomicU64,
    class_5xx: AtomicU64,
    in_flight: AtomicU64,
}

impl Metrics {
    /// A request entered the stack.
    fn start(&self) {
        self.in_flight.fetch_add(1, Ordering::Relaxed);
    }

    /// A request left the stack with `status`.
    fn end(&self, status: u16) {
        // saturating_sub semantics: never wrap below zero if start/end drift.
        let _ = self
            .in_flight
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                Some(n.saturating_sub(1))
            });
        let bucket = match status / 100 {
            2 => &self.class_2xx,
            3 => &self.class_3xx,
            4 => &self.class_4xx,
            5 => &self.class_5xx,
            _ => return,
        };
        bucket.fetch_add(1, Ordering::Relaxed);
    }

    fn expose(&self, uptime_seconds: u64) -> String {
        let load = |a: &AtomicU64| a.load(Ordering::Relaxed);
        format!(
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
        )
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

/// Record a completed request with its response status (in-flight -1, class +1).
pub(crate) fn record_end(status: u16) {
    metrics().end(status);
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
        m.end(200);
        m.end(404);
        m.end(503);
        let text = m.expose(42);
        assert!(text.contains("dochub_http_requests_total{class=\"2xx\"} 1"));
        assert!(text.contains("dochub_http_requests_total{class=\"4xx\"} 1"));
        assert!(text.contains("dochub_http_requests_total{class=\"5xx\"} 1"));
        // one start, three ends → in-flight underflow is clamped at 0.
        assert!(text.contains("dochub_http_requests_in_flight 0"));
        assert!(text.contains("dochub_uptime_seconds 42"));
        // Every series carries a HELP + TYPE line.
        assert_eq!(text.matches("# TYPE").count(), 3);
    }
}
