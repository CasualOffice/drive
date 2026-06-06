//! End-to-end repository tests against `sqlite::memory:`. Postgres support
//! comes online when CI gains a Postgres service.

use drive_db::{Db, DbError, NewSession, NewUser, SessionRepo, UserRepo};

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:").await.expect("connect")
}

#[tokio::test]
async fn migrate_then_users_roundtrip() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);

    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "$argon2id$dummy".into(),
            is_admin: true,
        })
        .await
        .expect("insert");
    assert!(u.is_admin);

    let by_username = users.find_by_username("admin").await.expect("find");
    assert_eq!(by_username.id, u.id);
    assert!(by_username.is_admin);

    let by_id = users.find_by_id(&u.id).await.expect("find by id");
    assert_eq!(by_id.username, "admin");

    let missing = users.find_by_username("nobody").await;
    assert!(matches!(missing, Err(DbError::NotFound)));
}

#[tokio::test]
async fn users_unique_username() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    users
        .insert(&NewUser {
            username: "dup".into(),
            password_hash: "h".into(),
            is_admin: false,
        })
        .await
        .expect("first insert");
    let err = users
        .insert(&NewUser {
            username: "dup".into(),
            password_hash: "h".into(),
            is_admin: false,
        })
        .await
        .expect_err("second must fail");
    assert!(matches!(err, DbError::UniqueViolation(_)));
}

#[tokio::test]
async fn sessions_create_get_delete() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    let sessions = SessionRepo::new(&db);

    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap();

    let s = sessions
        .insert(
            "session-id-1",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "csrf".into(),
                ttl: time::Duration::hours(24),
            },
        )
        .await
        .unwrap();
    assert_eq!(s.user_id, u.id);
    assert!(!s.is_expired());

    let fetched = sessions.get("session-id-1").await.unwrap();
    assert_eq!(fetched.csrf_token, "csrf");

    sessions.delete("session-id-1").await.unwrap();
    assert!(matches!(
        sessions.get("session-id-1").await,
        Err(DbError::NotFound)
    ));
}

#[tokio::test]
async fn sessions_janitor_clears_expired() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    let sessions = SessionRepo::new(&db);
    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap();
    sessions
        .insert(
            "live",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "c".into(),
                ttl: time::Duration::hours(1),
            },
        )
        .await
        .unwrap();
    sessions
        .insert(
            "dead",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "c".into(),
                ttl: time::Duration::seconds(-1),
            },
        )
        .await
        .unwrap();

    let cleaned = sessions.delete_expired().await.unwrap();
    assert_eq!(cleaned, 1);
    assert!(sessions.get("live").await.is_ok());
    assert!(matches!(sessions.get("dead").await, Err(DbError::NotFound)));
}
