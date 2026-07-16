//! Security header constants per origin. See ARCHITECTURE.md §"Two-origin
//! security model". Layers are constructed inline in `lib.rs` for type
//! ergonomics (tower's Stack types are unwieldy as return types).

use axum::http::header::HeaderName;

/// SHA-256 (base64) of the inline theme-bootstrap script in `web/index.html`.
///
/// That script runs pre-paint to set `data-theme` from `localStorage`, so the
/// page never flashes light→dark on load (see the `<script>` comment in
/// `web/index.html`). Under our strict CSP, `script-src 'self'` blocks *all*
/// inline scripts — which silently killed the bootstrap in production (dev has
/// no CSP), bringing the flash back. Allow-listing exactly this one script by
/// hash keeps the CSP strict (no `'unsafe-inline'`) while letting the bootstrap
/// run. `headers::tests::csp_hash_matches_index_html` recomputes this from the
/// actual file so an edit to the script that forgets to update the hash fails
/// CI instead of silently reintroducing the flash.
pub const THEME_BOOTSTRAP_SHA256: &str = "sha256-IZxsG6bsnjcOrK1Ca6RCFDuGerN2nf1d1k3fsKV24EA=";

/// App-origin Content-Security-Policy. `script-src` allows same-origin bundles
/// plus the one hashed inline bootstrap (above). Inline *styles* need no
/// allowance: React applies `style={{…}}` via the CSSOM (`el.style.x = y`),
/// which CSP does not gate — only parsed `style="…"` attributes and `<style>`
/// elements are, and we ship neither from user-authored HTML.
pub const APP_CSP: &str = "default-src 'self'; \
                            script-src 'self' 'sha256-IZxsG6bsnjcOrK1Ca6RCFDuGerN2nf1d1k3fsKV24EA='; \
                            object-src 'none'; \
                            base-uri 'none'; \
                            frame-ancestors 'none'";

pub const UCN_CSP: &str = "sandbox; default-src 'none'";

pub const REFERRER_POLICY: &str = "strict-origin-when-cross-origin";
pub const PERMISSIONS_POLICY: &str = "camera=(), microphone=(), geolocation=(), interest-cohort=()";

/// HSTS for the app origin — two years, subdomains, preload-eligible (docs/
/// research/06-security.md §11). Emitted **only in production**: it pins HTTPS,
/// so sending it in a local http dev session would wedge the browser onto a
/// non-existent localhost TLS endpoint.
pub const HSTS: &str = "max-age=63072000; includeSubDomains; preload";

pub const H_CSP: HeaderName = HeaderName::from_static("content-security-policy");
pub const H_XCTO: HeaderName = HeaderName::from_static("x-content-type-options");
pub const H_REF: HeaderName = HeaderName::from_static("referrer-policy");
pub const H_PP: HeaderName = HeaderName::from_static("permissions-policy");
pub const H_CORP: HeaderName = HeaderName::from_static("cross-origin-resource-policy");
pub const H_COOP: HeaderName = HeaderName::from_static("cross-origin-opener-policy");
pub const H_HSTS: HeaderName = HeaderName::from_static("strict-transport-security");

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use sha2::{Digest, Sha256};

    /// The CSP hash must match the inline theme-bootstrap script that
    /// `web/index.html` actually ships. If the script is edited without
    /// updating [`THEME_BOOTSTRAP_SHA256`] (and the copy inside [`APP_CSP`]),
    /// the browser blocks the bootstrap and the light↔dark flash returns in
    /// production — silently, since dev serves no CSP. This test turns that
    /// silent regression into a CI failure.
    #[test]
    fn csp_hash_matches_index_html() {
        // headers.rs lives in crates/dochub-http/src; index.html is at web/.
        let index =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/index.html"))
                .expect("read web/index.html");

        // The bootstrap is the first bare `<script>` (no attributes). The
        // browser hashes the exact text between the tags.
        let open = "<script>";
        let start = index.find(open).expect("inline <script> present") + open.len();
        let end = index[start..].find("</script>").expect("closing </script>") + start;
        let content = &index[start..end];

        let digest = Sha256::digest(content.as_bytes());
        let expected = format!(
            "sha256-{}",
            base64::engine::general_purpose::STANDARD.encode(digest)
        );

        assert_eq!(
            THEME_BOOTSTRAP_SHA256, expected,
            "web/index.html bootstrap changed — update THEME_BOOTSTRAP_SHA256 (and the copy in APP_CSP) to {expected}"
        );
        assert!(
            APP_CSP.contains(THEME_BOOTSTRAP_SHA256),
            "APP_CSP script-src must allow the bootstrap hash"
        );
    }
}
