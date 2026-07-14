//! Client-IP extraction for audit records.
//!
//! We read proxy-set forwarding headers rather than the connection peer: the
//! SPA terminates at a reverse proxy in every realistic deployment, so the
//! socket peer is the proxy, not the user. Prefer the first `X-Forwarded-For`
//! hop, fall back to `X-Real-IP`.
//!
//! Trust model: these headers are only as trustworthy as the proxy that sets
//! them. A deployment that exposes the app directly (no proxy stripping
//! inbound XFF) lets a client spoof the recorded IP — an operator deployment
//! note, not a code defect. The audit chain still records *an* attributable
//! value, which beats the previous `None` on every auth event.

use axum::http::HeaderMap;

/// First non-empty `X-Forwarded-For` hop, else `X-Real-IP`, else `None`.
pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hm(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                v.parse().unwrap(),
            );
        }
        h
    }

    #[test]
    fn none_without_forwarding_headers() {
        assert_eq!(client_ip(&hm(&[])), None);
    }

    #[test]
    fn takes_first_forwarded_for_hop() {
        let h = hm(&[("x-forwarded-for", "203.0.113.7, 10.0.0.1, 10.0.0.2")]);
        assert_eq!(client_ip(&h).as_deref(), Some("203.0.113.7"));
    }

    #[test]
    fn trims_whitespace_around_the_hop() {
        let h = hm(&[("x-forwarded-for", "  198.51.100.9 , 10.0.0.1")]);
        assert_eq!(client_ip(&h).as_deref(), Some("198.51.100.9"));
    }

    #[test]
    fn falls_back_to_real_ip() {
        let h = hm(&[("x-real-ip", "192.0.2.44")]);
        assert_eq!(client_ip(&h).as_deref(), Some("192.0.2.44"));
    }

    #[test]
    fn forwarded_for_wins_over_real_ip() {
        let h = hm(&[
            ("x-forwarded-for", "203.0.113.7"),
            ("x-real-ip", "192.0.2.44"),
        ]);
        assert_eq!(client_ip(&h).as_deref(), Some("203.0.113.7"));
    }

    #[test]
    fn empty_forwarded_for_hop_falls_through_to_real_ip() {
        let h = hm(&[("x-forwarded-for", "   "), ("x-real-ip", "192.0.2.44")]);
        assert_eq!(client_ip(&h).as_deref(), Some("192.0.2.44"));
    }
}
