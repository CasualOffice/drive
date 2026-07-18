//! Integration tests for F2a access-management endpoints: ACL grants
//! (user-to-user sharing), member-role changes, and project list/create.
//! Spec: docs/design/foundation-access-rag-mcp.md §2–§3.
//!
//! All access decisions flow through F1's `dochub_authz::require`/`can`; these
//! tests assert the endpoints wire grants + roles into that resolver correctly,
//! plus the authz/audit side effects.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_authz::{can, Permission, ResourceRef};
use dochub_core::{Backend, Config};
use dochub_db::{
    AuditRepo, Db, FileRepo, NewFile, NewUser, ProjectRepo, UserRepo, WorkspaceKind,
    WorkspaceMemberRepo, WorkspaceRepo,
};
use dochub_http::{router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;
use url::Url;

const APP: &str = "drive.test";
const UCN: &str = "usercontent-drive.test";

async fn fixture() -> HttpState {
    let storage = Storage::memory([1u8; 32]).unwrap();
    let db = Db::connect("sqlite::memory:").await.unwrap();
    let cfg = Config {
        app_origin: Url::parse(&format!("http://{APP}")).unwrap(),
        usercontent_origin: Url::parse(&format!("http://{UCN}")).unwrap(),
        bind: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
        backend: Backend::Memory,
        fs_root: None,
        s3_bucket: None,
        s3_region: None,
        s3_endpoint: None,
        aws_access_key_id: None,
        aws_secret_access_key: None,
        db_url: "sqlite::memory:".into(),
        body_limit_mb: 100,
        signed_url_ttl_secs: 300,
        oidc: None,
        allow_password_auth: true,
        session_secret: vec![0u8; 32],
        wopi_hmac_secret: [2u8; 32],
        signed_url_hmac_secret: [1u8; 32],
        admin_user: "admin".into(),
        admin_password_hash: "$argon2id$test".into(),
        recipient_footer: true,
        is_prod: false,
        sheet_origin: None,
        document_origin: None,
        collab_url: None,
        master_kek: dochub_core::dev_master_kek(),
        master_kek_next: None,
    };
    let auth = AuthState::new(db.clone(), false, time::Duration::hours(1));
    let registry = HttpState::default_registry(storage.clone(), [0u8; 32]);
    HttpState {
        storage,
        wopi: WopiState::new(),
        db,
        auth,
        jwt_secret: Arc::new([2u8; 32]),
        config: Arc::new(cfg),
        upload_limiter: HttpState::default_upload_limiter(),
        registry,
        storage_secret_key: None,
        presence: dochub_http::presence::PresenceHub::new(),
    }
}

/// Create a non-admin user (so authz gates apply — a superadmin bypasses).
async fn mk_user(db: &Db, username: &str) -> String {
    UserRepo::new(db)
        .insert(&NewUser {
            username: username.into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: false,
        })
        .await
        .unwrap()
        .id
}

async fn sign_in(app: &axum::Router, username: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{username}","password":"hunter2hunter2"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "sign-in for {username}");
    r.headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

/// Owner's Personal workspace + default project + one file owned by them.
async fn seed_file(db: &Db, owner_id: &str, name: &str) -> (String, String) {
    let ws = WorkspaceRepo::new(db)
        .list_for_user(owner_id)
        .await
        .unwrap()
        .into_iter()
        .next()
        .unwrap()
        .id;
    let project = ProjectRepo::new(db).ensure_default(&ws).await.unwrap();
    let file_id = ulid::Ulid::new().to_string();
    FileRepo::new(db)
        .insert(&NewFile {
            id: file_id.clone(),
            name: name.into(),
            owner_id: owner_id.into(),
            workspace_id: ws.clone(),
            project_id: Some(project),
            ..Default::default()
        })
        .await
        .unwrap();
    (ws, file_id)
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: &str,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("host", APP)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(if body.is_empty() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .unwrap();
    let r = app.clone().oneshot(req).await.unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    let v: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

/// Poll the audit log briefly — `AuditRepo::emit` inserts on a spawned task.
async fn audit_has(db: &Db, action: &str) -> bool {
    for _ in 0..50 {
        let rows = AuditRepo::new(db).list(None, 200).await.unwrap();
        if rows.iter().any(|e| e.action == action) {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    false
}

// ── ACL grants ──────────────────────────────────────────────────────────

#[tokio::test]
async fn grant_lets_outsider_view_exactly_one_file() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let outsider = mk_user(&db, "outsider").await;
    let (_ws, file_a) = seed_file(&db, &owner, "a.txt").await;
    let (_ws2, file_b) = seed_file(&db, &owner, "b.txt").await;

    let app = router(state);
    let owner_cookie = sign_in(&app, "owner").await;

    // Outsider can't view either file yet (deny-by-default).
    assert!(
        !can(
            &db,
            &outsider,
            &ResourceRef::File(file_a.clone()),
            Permission::View
        )
        .await
    );

    // Owner grants the outsider viewer on file A (by username).
    let (status, grant) = send(
        &app,
        "POST",
        &format!("/api/files/{file_a}/grants"),
        &owner_cookie,
        r#"{"user":"outsider","role":"viewer"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(grant["role"], "viewer");
    assert_eq!(grant["subject_username"], "outsider");
    let grant_id = grant["id"].as_str().unwrap().to_string();
    assert!(audit_has(&db, "acl.grant").await);

    // Now the outsider can view file A via F1's resolver — and ONLY file A.
    assert!(
        can(
            &db,
            &outsider,
            &ResourceRef::File(file_a.clone()),
            Permission::View
        )
        .await
    );
    assert!(
        !can(
            &db,
            &outsider,
            &ResourceRef::File(file_b.clone()),
            Permission::View
        )
        .await
    );
    // Viewer grant is view-only: no edit.
    assert!(
        !can(
            &db,
            &outsider,
            &ResourceRef::File(file_a.clone()),
            Permission::Edit
        )
        .await
    );

    // Listing shows the grant.
    let (status, list) = send(
        &app,
        "GET",
        &format!("/api/files/{file_a}/grants"),
        &owner_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let grants = list["grants"].as_array().unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0]["id"], grant_id);

    // Revoke removes the access.
    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/api/grants/{grant_id}"),
        &owner_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(audit_has(&db, "acl.revoke").await);
    assert!(
        !can(
            &db,
            &outsider,
            &ResourceRef::File(file_a.clone()),
            Permission::View
        )
        .await
    );
}

#[tokio::test]
async fn only_a_user_with_share_can_grant() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let viewer = mk_user(&db, "viewer").await;
    let outsider = mk_user(&db, "outsider").await;
    let (ws, file_a) = seed_file(&db, &owner, "a.txt").await;

    // Add `viewer` to the workspace as a Viewer (no `share` permission).
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &viewer, "viewer")
        .await
        .unwrap();

    let app = router(state);
    let viewer_cookie = sign_in(&app, "viewer").await;

    // Viewer tries to grant → 403; authz.deny audited.
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/files/{file_a}/grants"),
        &viewer_cookie,
        r#"{"user":"outsider","role":"viewer"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(audit_has(&db, "authz.deny").await);
    // No grant was created.
    assert!(
        !can(
            &db,
            &outsider,
            &ResourceRef::File(file_a.clone()),
            Permission::View
        )
        .await
    );
}

#[tokio::test]
async fn editor_cannot_grant_a_role_above_their_own() {
    // Regression for the grant-ceiling escalation: `share` (which an Editor
    // holds) lets a user reach the grant endpoint, but the granted role's
    // permissions must be a subset of the granter's own — an Editor must not be
    // able to mint an `admin` grant.
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let editor = mk_user(&db, "editor").await;
    let alice = mk_user(&db, "alice").await;
    let bob = mk_user(&db, "bob").await;
    let (ws, file_a) = seed_file(&db, &owner, "a.txt").await;

    // `editor` is a workspace Editor: holds `share`, but none of the admin-only
    // perms (ManageMembers, ManageSettings, …).
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &editor, "editor")
        .await
        .unwrap();

    let app = router(state);
    let editor_cookie = sign_in(&app, "editor").await;

    // Within their own access, an Editor may grant viewer/editor.
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/files/{file_a}/grants"),
        &editor_cookie,
        r#"{"user":"alice","role":"editor"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let _ = alice;

    // Escalation blocked: an Editor may NOT grant admin.
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/files/{file_a}/grants"),
        &editor_cookie,
        r#"{"user":"bob","role":"admin"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        !can(
            &db,
            &bob,
            &ResourceRef::File(file_a.clone()),
            Permission::ManageMembers
        )
        .await
    );

    // The owner (full access) CAN grant admin.
    let owner_cookie = sign_in(&app, "owner").await;
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/files/{file_a}/grants"),
        &owner_cookie,
        r#"{"user":"bob","role":"admin"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

// ── Member roles ────────────────────────────────────────────────────────

#[tokio::test]
async fn changing_member_role_changes_effective_permissions() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let member = mk_user(&db, "member").await;
    // Team workspace owned by `owner`, `member` starts as Viewer.
    let ws = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;
    let project = ProjectRepo::new(&db).ensure_default(&ws).await.unwrap();
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &member, "viewer")
        .await
        .unwrap();
    // A file in the workspace's default project.
    let file_id = ulid::Ulid::new().to_string();
    FileRepo::new(&db)
        .insert(&NewFile {
            id: file_id.clone(),
            name: "doc.txt".into(),
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
            project_id: Some(project),
            ..Default::default()
        })
        .await
        .unwrap();

    // Viewer can view but not edit.
    assert!(
        can(
            &db,
            &member,
            &ResourceRef::File(file_id.clone()),
            Permission::View
        )
        .await
    );
    assert!(
        !can(
            &db,
            &member,
            &ResourceRef::File(file_id.clone()),
            Permission::Edit
        )
        .await
    );

    let app = router(state);
    let owner_cookie = sign_in(&app, "owner").await;

    // Promote Viewer → Editor.
    let (status, _) = send(
        &app,
        "PUT",
        &format!("/api/workspaces/{ws}/members/{member}/role"),
        &owner_cookie,
        r#"{"role":"editor"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(audit_has(&db, "workspace.member_role_changed").await);
    assert!(
        can(
            &db,
            &member,
            &ResourceRef::File(file_id.clone()),
            Permission::Edit
        )
        .await
    );

    // Demote back to Viewer → edit blocked again.
    let (status, _) = send(
        &app,
        "PUT",
        &format!("/api/workspaces/{ws}/members/{member}/role"),
        &owner_cookie,
        r#"{"role":"viewer"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        !can(
            &db,
            &member,
            &ResourceRef::File(file_id.clone()),
            Permission::Edit
        )
        .await
    );
}

#[tokio::test]
async fn cannot_demote_the_last_owner() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let ws = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;

    let app = router(state);
    let owner_cookie = sign_in(&app, "owner").await;

    let (status, _) = send(
        &app,
        "PUT",
        &format!("/api/workspaces/{ws}/members/{owner}/role"),
        &owner_cookie,
        r#"{"role":"editor"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Still an owner.
    assert_eq!(
        WorkspaceMemberRepo::new(&db)
            .role_name(&ws, &owner)
            .await
            .unwrap()
            .as_deref(),
        Some("owner")
    );
}

#[tokio::test]
async fn non_manage_members_caller_cannot_change_roles() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let editor = mk_user(&db, "editor").await;
    let target = mk_user(&db, "target").await;
    let ws = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;
    // Editor has `share` but not `manage_members`.
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &editor, "editor")
        .await
        .unwrap();
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &target, "viewer")
        .await
        .unwrap();

    let app = router(state);
    let editor_cookie = sign_in(&app, "editor").await;
    let (status, _) = send(
        &app,
        "PUT",
        &format!("/api/workspaces/{ws}/members/{target}/role"),
        &editor_cookie,
        r#"{"role":"admin"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Unchanged.
    assert_eq!(
        WorkspaceMemberRepo::new(&db)
            .role_name(&ws, &target)
            .await
            .unwrap()
            .as_deref(),
        Some("viewer")
    );
}

#[tokio::test]
async fn remove_member_drops_access_but_not_the_owner() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let member = mk_user(&db, "member").await;
    let ws = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &member, "editor")
        .await
        .unwrap();

    let app = router(state);
    let owner_cookie = sign_in(&app, "owner").await;

    // Can't remove the workspace owner.
    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/api/workspaces/{ws}/members/{owner}"),
        &owner_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Removing the member works and drops their view.
    assert!(
        can(
            &db,
            &member,
            &ResourceRef::Workspace(ws.clone()),
            Permission::View
        )
        .await
    );
    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/api/workspaces/{ws}/members/{member}"),
        &owner_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(audit_has(&db, "workspace.member_removed").await);
    assert!(
        !can(
            &db,
            &member,
            &ResourceRef::Workspace(ws.clone()),
            Permission::View
        )
        .await
    );
}

// ── Projects ────────────────────────────────────────────────────────────

#[tokio::test]
async fn project_create_requires_admin_and_list_is_scoped() {
    let state = fixture().await;
    let db = state.db.clone();
    let owner = mk_user(&db, "owner").await;
    let editor = mk_user(&db, "editor").await;
    let outsider = mk_user(&db, "outsider").await;
    let ws = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;
    ProjectRepo::new(&db).ensure_default(&ws).await.unwrap();
    WorkspaceMemberRepo::new(&db)
        .add(&ws, &editor, "editor")
        .await
        .unwrap();

    let app = router(state);

    // Editor lacks manage_settings → create is 403.
    let editor_cookie = sign_in(&app, "editor").await;
    let (status, _) = send(
        &app,
        "POST",
        &format!("/api/workspaces/{ws}/projects"),
        &editor_cookie,
        r#"{"name":"Roadmap"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Owner (admin-equivalent) can create.
    let owner_cookie = sign_in(&app, "owner").await;
    let (status, project) = send(
        &app,
        "POST",
        &format!("/api/workspaces/{ws}/projects"),
        &owner_cookie,
        r#"{"name":"Roadmap"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(project["name"], "Roadmap");
    assert_eq!(project["kind"], "team");
    assert!(audit_has(&db, "project.create").await);

    // List (readable-scoped): a member sees the default + new project.
    let (status, list) = send(
        &app,
        "GET",
        &format!("/api/workspaces/{ws}/projects"),
        &editor_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["projects"].as_array().unwrap().len(), 2);

    // A non-member is denied the list.
    let _ = outsider;
    let outsider_cookie = sign_in(&app, "outsider").await;
    let (status, _) = send(
        &app,
        "GET",
        &format!("/api/workspaces/{ws}/projects"),
        &outsider_cookie,
        "",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
