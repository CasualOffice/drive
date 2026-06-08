//! Phase 3 §15 — sandboxed PDF + video thumbnail worker.
//!
//! The wire protocol lives here (in the library half) so the parent
//! process in `drive-storage` can `serde_json::to_writer` exactly the
//! same struct the worker `serde_json::from_reader`s. The worker binary
//! itself is in `src/main.rs`.
//!
//! Spec: docs/research/15-sandboxed-thumb-worker.md.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

/// What the parent sends on stdin. One request per worker invocation.
/// Bytes pass by path — keeps the JSON small + means the worker can
/// `open(O_NOFOLLOW)` the input without any pipe choreography.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub kind: Kind,
    /// Absolute path to a temp file the parent already wrote the input
    /// bytes to. The worker is responsible for opening it with NOFOLLOW.
    pub input_path: String,
    /// Absolute path the worker should write the resulting PNG to.
    pub output_path: String,
    /// Target dimension. The worker interprets this together with `fit`
    /// — see `drive_storage::ThumbSize::fit_mode`.
    pub size_px: u32,
    pub fit: FitMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Pdf,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FitMode {
    Cover,
    Contain,
}

/// What the parent reads from stdout. Mirror of `Result<(), Error>` —
/// `serde_json` would happily round-trip a `Result` but the explicit
/// shape is easier to debug from log lines.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Response {
    Ok(OkResp),
    Err(ErrResp),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkResp {
    pub ok: bool, // always true; redundant but makes JSON greppable
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrResp {
    pub ok: bool, // always false
    pub error: String,
    /// Coarse failure category so the parent can decide whether to flip
    /// `thumbs_state` to `failed` (decoder broken — retry on regenerate)
    /// or `unsupported` (we don't know how — stop trying).
    pub kind: ErrorKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The worker doesn't have a decoder for this kind on this host.
    /// Examples: `ffmpeg` not on PATH for video; pdfium not linked for
    /// PDF. Parent flips `thumbs_state = 'unsupported'`.
    Unsupported,
    /// Decoder loaded but returned an error (corrupt input, blown
    /// resource limit, etc.). Parent flips `thumbs_state = 'failed'`.
    Decode,
    /// The worker itself blew up — bad JSON, missing file, IO error.
    /// Parent treats as `failed`, surfaces in tracing.
    Internal,
}

impl Response {
    #[must_use]
    pub fn ok(output_path: String) -> Self {
        Self::Ok(OkResp {
            ok: true,
            output_path,
        })
    }
    #[must_use]
    pub fn err(kind: ErrorKind, error: impl Into<String>) -> Self {
        Self::Err(ErrResp {
            ok: false,
            error: error.into(),
            kind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_json() {
        let req = Request {
            kind: Kind::Video,
            input_path: "/tmp/in.mp4".into(),
            output_path: "/tmp/out.png".into(),
            size_px: 256,
            fit: FitMode::Cover,
        };
        let s = serde_json::to_string(&req).unwrap();
        let back: Request = serde_json::from_str(&s).unwrap();
        assert_eq!(back.kind, Kind::Video);
        assert_eq!(back.size_px, 256);
        assert_eq!(back.fit, FitMode::Cover);
    }

    #[test]
    fn ok_response_has_ok_true() {
        let r = Response::ok("/tmp/out.png".into());
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains(r#""ok":true"#));
        assert!(s.contains(r#""output_path":"/tmp/out.png""#));
    }

    #[test]
    fn err_response_has_kind_tag() {
        let r = Response::err(ErrorKind::Unsupported, "ffmpeg not on PATH");
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains(r#""ok":false"#));
        assert!(s.contains(r#""kind":"unsupported""#));
    }

    #[test]
    fn response_round_trips_both_arms() {
        let ok = serde_json::to_string(&Response::ok("/x".into())).unwrap();
        let parsed: Response = serde_json::from_str(&ok).unwrap();
        assert!(matches!(parsed, Response::Ok(_)));
        let err = serde_json::to_string(&Response::err(ErrorKind::Decode, "boom")).unwrap();
        let parsed: Response = serde_json::from_str(&err).unwrap();
        assert!(matches!(parsed, Response::Err(_)));
    }
}
