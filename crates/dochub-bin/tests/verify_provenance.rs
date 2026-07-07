//! CLI integration tests for `dochub verify-provenance <manifest.json>` (P1.4).
//! Exercises the compiled binary end to end: a genuine manifest exits 0 with
//! `OK`, a tampered chain exits non-zero with `FAIL`. No DB or network.

use std::process::Command;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use dochub_crypto::generate_signing_key;
use dochub_crypto::provenance::{
    canonical_bytes, ProvenanceLink, ProvenanceManifest, SignedProvenance,
};

fn link(seq: i64, content: &str, prev: Option<&str>) -> ProvenanceLink {
    ProvenanceLink {
        seq,
        content_hash: content.into(),
        prev_hash: prev.map(Into::into),
        created_at: format!("2026-07-06T00:0{seq}:00Z"),
        author_id: "01AUTHOR".into(),
    }
}

fn signed_sample() -> SignedProvenance {
    let manifest = ProvenanceManifest {
        file_id: "01FILE".into(),
        chain: vec![
            link(1, "aaaa", None),
            link(2, "bbbb", Some("aaaa")),
            link(3, "cccc", Some("bbbb")),
        ],
        head: Some("cccc".into()),
        generated_at: "2026-07-06T12:00:00Z".into(),
    };
    let (sk, vk) = generate_signing_key();
    let sig = dochub_crypto::sign(&sk, &canonical_bytes(&manifest));
    SignedProvenance {
        manifest,
        signature: STANDARD.encode(sig),
        public_key: STANDARD.encode(vk),
    }
}

fn run(signed: &SignedProvenance) -> std::process::Output {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manifest.json");
    std::fs::write(&path, serde_json::to_vec_pretty(signed).unwrap()).unwrap();
    Command::new(env!("CARGO_BIN_EXE_dochub"))
        .arg("verify-provenance")
        .arg(&path)
        .output()
        .expect("run dochub verify-provenance")
}

#[test]
fn genuine_manifest_verifies_ok() {
    let out = run(&signed_sample());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "expected exit 0, got {:?}",
        out.status
    );
    assert!(stdout.contains("OK"), "stdout was: {stdout}");
}

#[test]
fn tampered_content_hash_fails_nonzero() {
    let mut signed = signed_sample();
    // Alter a content_hash: the signature no longer covers these bytes.
    signed.manifest.chain[1].content_hash = "0".repeat(64);
    let out = run(&signed);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "expected non-zero exit on tamper");
    assert!(stderr.contains("FAIL"), "stderr was: {stderr}");
}

#[test]
fn broken_chain_link_fails_nonzero() {
    // Re-sign a manifest whose chain linkage is broken: the signature is valid
    // but the offline chain walk must still reject it.
    let mut manifest = ProvenanceManifest {
        file_id: "01FILE".into(),
        chain: vec![link(1, "aaaa", None), link(2, "bbbb", Some("WRONG"))],
        head: Some("bbbb".into()),
        generated_at: "2026-07-06T12:00:00Z".into(),
    };
    let (sk, vk) = generate_signing_key();
    let sig = dochub_crypto::sign(&sk, &canonical_bytes(&manifest));
    // Keep the manifest as-is (signature covers the broken linkage).
    manifest.file_id = "01FILE".into();
    let signed = SignedProvenance {
        manifest,
        signature: STANDARD.encode(sig),
        public_key: STANDARD.encode(vk),
    };
    let out = run(&signed);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "expected non-zero exit on broken chain"
    );
    assert!(stderr.contains("FAIL"), "stderr was: {stderr}");
}

#[test]
fn missing_argument_errors() {
    let out = Command::new(env!("CARGO_BIN_EXE_dochub"))
        .arg("verify-provenance")
        .output()
        .unwrap();
    assert!(!out.status.success(), "missing path must be an error");
}
