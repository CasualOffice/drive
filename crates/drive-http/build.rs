// Emits build-time metadata read at runtime by `GET /api/about`.
//
//   DRIVE_GIT_SHA   — short git SHA, or "unknown" if not in a git tree
//   DRIVE_BUILT_AT  — RFC-3339 build timestamp (seconds precision)
//
// Falls back to "unknown" rather than failing — the Docker builder context
// may not contain a `.git` directory.

use std::process::Command;

fn main() {
    println!("cargo:rustc-env=DRIVE_GIT_SHA={}", git_short_sha());
    println!("cargo:rustc-env=DRIVE_BUILT_AT={}", built_at());
    println!("cargo:rerun-if-changed=build.rs");
    // Re-run when HEAD moves so the SHA stays fresh.
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs");
}

fn git_short_sha() -> String {
    let Ok(out) = Command::new("git")
        .args(["rev-parse", "--short=10", "HEAD"])
        .output()
    else {
        return "unknown".into();
    };
    if !out.status.success() {
        return "unknown".into();
    }
    let Ok(s) = String::from_utf8(out.stdout) else {
        return "unknown".into();
    };
    let trimmed = s.trim();
    if trimmed.is_empty() {
        "unknown".into()
    } else {
        trimmed.to_string()
    }
}

fn built_at() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format_unix_secs_utc(d.as_secs() as i64),
        Err(_) => "unknown".into(),
    }
}

// Days from civil → ymd. Lifted from Howard Hinnant's date algorithms.
// Public domain. Avoids pulling `time` into the build script for one call.
// Keeps the original short variable names for direct cross-reference.
#[allow(
    clippy::many_single_char_names,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap
)]
fn format_unix_secs_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (h, ms) = (secs_of_day / 3600, secs_of_day % 3600);
    let (m, s) = (ms / 60, ms % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m_ = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m_ <= 2 { y + 1 } else { y };

    format!("{y:04}-{m_:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
