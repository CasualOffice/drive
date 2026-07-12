//! Projects + project memberships. Spec:
//! docs/design/foundation-access-rag-mcp.md §3.
//!
//! A project is an access container inside a workspace. Folders and files live
//! under a project (or the per-workspace default project for back-compat).
//! `project_members` carries project-scoped roles; absence of a row means the
//! user inherits their workspace role for that project.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    /// "team" | "personal" — mirrors the owning workspace's kind.
    pub kind: String,
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewProject {
    pub workspace_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct ProjectRepo<'a> {
    db: &'a Db,
}

impl<'a> ProjectRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub async fn insert(&self, new: &NewProject) -> Result<Project, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        sqlx::query(&self.db.sql(
            "INSERT INTO projects (id, workspace_id, name, kind, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        ))
        .bind(&id)
        .bind(&new.workspace_id)
        .bind(&new.name)
        .bind(&new.kind)
        .bind(ts(created_at))
        .execute(self.db.pool())
        .await?;
        Ok(Project {
            id,
            workspace_id: new.workspace_id.clone(),
            name: new.name.clone(),
            kind: new.kind.clone(),
            created_at,
        })
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Project, DbError> {
        let row = sqlx::query(
            &self
                .db
                .sql("SELECT id, workspace_id, name, kind, created_at FROM projects WHERE id = ?"),
        )
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        row_to_project(&row)
    }

    /// Projects in a workspace, oldest first (ULID ids sort chronologically).
    pub async fn list_for_workspace(&self, workspace_id: &str) -> Result<Vec<Project>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, name, kind, created_at \
             FROM projects WHERE workspace_id = ? ORDER BY id ASC",
        ))
        .bind(workspace_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_project).collect()
    }

    /// The default project id for a workspace, creating it on first use. The
    /// oldest project (lowest ULID id) is the default; the 0023 backfill seeds
    /// exactly one per pre-existing workspace, and this creates one lazily for
    /// workspaces born after the migration ran (e.g. the seeded admin's
    /// Personal workspace, created after migrations at boot).
    pub async fn ensure_default(&self, workspace_id: &str) -> Result<String, DbError> {
        if let Some(id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM projects WHERE workspace_id = ? ORDER BY id ASC LIMIT 1",
        )
        .bind(workspace_id)
        .fetch_optional(self.db.pool())
        .await?
        {
            return Ok(id);
        }
        // Mirror the workspace kind onto the project (defaulting to team).
        let kind = sqlx::query_scalar::<_, String>("SELECT kind FROM workspaces WHERE id = ?")
            .bind(workspace_id)
            .fetch_optional(self.db.pool())
            .await?
            .unwrap_or_else(|| "team".to_string());
        let project = self
            .insert(&NewProject {
                workspace_id: workspace_id.to_string(),
                name: "General".to_string(),
                kind,
            })
            .await?;
        Ok(project.id)
    }
}

fn row_to_project(row: &sqlx::any::AnyRow) -> Result<Project, DbError> {
    Ok(Project {
        id: row.get("id"),
        workspace_id: row.get("workspace_id"),
        name: row.get("name"),
        kind: row.get("kind"),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMembership {
    pub project_id: String,
    pub user_id: String,
    pub role: String,
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct ProjectMemberRepo<'a> {
    db: &'a Db,
}

impl<'a> ProjectMemberRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Add or update a member's project role (upsert on the composite key).
    pub async fn set_role(
        &self,
        project_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), DbError> {
        let now = ts(time::OffsetDateTime::now_utc());
        // Portable upsert: delete-then-insert avoids dialect-specific
        // ON CONFLICT clauses across SQLite + Postgres.
        sqlx::query(
            &self
                .db
                .sql("DELETE FROM project_members WHERE project_id = ? AND user_id = ?"),
        )
        .bind(project_id)
        .bind(user_id)
        .execute(self.db.pool())
        .await?;
        sqlx::query(&self.db.sql(
            "INSERT INTO project_members (project_id, user_id, role, created_at) \
             VALUES (?, ?, ?, ?)",
        ))
        .bind(project_id)
        .bind(user_id)
        .bind(role)
        .bind(now)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    pub async fn remove(&self, project_id: &str, user_id: &str) -> Result<(), DbError> {
        sqlx::query(
            &self
                .db
                .sql("DELETE FROM project_members WHERE project_id = ? AND user_id = ?"),
        )
        .bind(project_id)
        .bind(user_id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    /// The user's role for one project, or `None` if they are not a member.
    pub async fn role_of(
        &self,
        project_id: &str,
        user_id: &str,
    ) -> Result<Option<String>, DbError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(self.db.pool())
        .await?)
    }

    /// Project ids the user is a direct member of.
    pub async fn projects_for_user(&self, user_id: &str) -> Result<Vec<String>, DbError> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT project_id FROM project_members WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_all(self.db.pool())
        .await?)
    }

    pub async fn list(&self, project_id: &str) -> Result<Vec<ProjectMembership>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT project_id, user_id, role, created_at \
             FROM project_members WHERE project_id = ? ORDER BY created_at ASC",
        ))
        .bind(project_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter()
            .map(|row| {
                Ok(ProjectMembership {
                    project_id: row.get("project_id"),
                    user_id: row.get("user_id"),
                    role: row.get("role"),
                    created_at: parse_ts(row.get::<String, _>("created_at"))?,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod backfill_tests {
    //! Verifies the 0023 backfill SQL: a default project per workspace, legacy
    //! folders/files pointed at it, and `member -> editor`. The `Migrator` runs
    //! every migration at connect (so on a fresh DB the backfill is a no-op);
    //! these tests seed legacy-shaped rows and replay the 0023 statements to
    //! prove they are correct **and idempotent** (safe to re-run on upgrade).

    use crate::Db;

    /// The three statements from migrations/0023_backfill_projects.sql.
    async fn run_backfill(db: &Db) {
        for stmt in [
            "INSERT INTO projects (id, workspace_id, name, kind, created_at) \
             SELECT w.id, w.id, 'General', w.kind, w.created_at FROM workspaces w \
             WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id)",
            "UPDATE folders SET project_id = workspace_id \
             WHERE project_id IS NULL AND workspace_id IS NOT NULL",
            "UPDATE files SET project_id = workspace_id \
             WHERE project_id IS NULL AND workspace_id IS NOT NULL",
            "UPDATE workspace_members SET role = 'editor' WHERE role = 'member'",
        ] {
            sqlx::query(&db.sql(stmt))
                .execute(db.pool())
                .await
                .expect("backfill");
        }
    }

    async fn seed_legacy(db: &Db) -> (String, String) {
        // A workspace, an owner + a legacy `member`, and a file/folder with a
        // NULL project_id — the pre-F1 shape.
        let ws = ulid::Ulid::new().to_string();
        let owner = ulid::Ulid::new().to_string();
        let member = ulid::Ulid::new().to_string();
        let now = "2024-01-01T00:00:00Z";
        for uid in [&owner, &member] {
            sqlx::query(&db.sql(
                "INSERT INTO users (id, username, password_hash, is_admin, created_at) \
                 VALUES (?, ?, 'h', 0, ?)",
            ))
            .bind(uid)
            .bind(format!("u{uid}"))
            .bind(now)
            .execute(db.pool())
            .await
            .unwrap();
        }
        sqlx::query(&db.sql(
            "INSERT INTO workspaces (id, name, kind, owner_id, created_at) \
             VALUES (?, 'Legacy', 'team', ?, ?)",
        ))
        .bind(&ws)
        .bind(&owner)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(&db.sql(
            "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) \
             VALUES (?, ?, 'owner', ?), (?, ?, 'member', ?)",
        ))
        .bind(&ws)
        .bind(&owner)
        .bind(now)
        .bind(&ws)
        .bind(&member)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        let file = ulid::Ulid::new().to_string();
        sqlx::query(&db.sql(
            "INSERT INTO files (id, name, size, owner_id, workspace_id, created_at, modified_at, version, status) \
             VALUES (?, 'legacy.txt', 3, ?, ?, ?, ?, 1, 'ready')",
        ))
        .bind(&file)
        .bind(&owner)
        .bind(&ws)
        .bind(now)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        (ws, member)
    }

    #[tokio::test]
    async fn backfill_creates_default_project_and_maps_roles() {
        let db = Db::connect("sqlite::memory:").await.unwrap();
        let (ws, member) = seed_legacy(&db).await;

        run_backfill(&db).await;

        // Default project exists, id == workspace id.
        let proj: Option<String> =
            sqlx::query_scalar(&db.sql("SELECT id FROM projects WHERE workspace_id = ?"))
                .bind(&ws)
                .fetch_optional(db.pool())
                .await
                .unwrap();
        assert_eq!(proj.as_deref(), Some(ws.as_str()));

        // The legacy file now carries the default project id.
        let file_project: Option<String> =
            sqlx::query_scalar(&db.sql("SELECT project_id FROM files WHERE workspace_id = ?"))
                .bind(&ws)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(file_project.as_deref(), Some(ws.as_str()));

        // member -> editor; owner untouched.
        let member_role: String =
            sqlx::query_scalar(&db.sql("SELECT role FROM workspace_members WHERE user_id = ?"))
                .bind(&member)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(member_role, "editor");
        let n_members: i64 = sqlx::query_scalar(
            &db.sql("SELECT COUNT(*) FROM workspace_members WHERE role = 'member'"),
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(n_members, 0);
    }

    #[tokio::test]
    async fn backfill_is_idempotent() {
        let db = Db::connect("sqlite::memory:").await.unwrap();
        let (ws, _member) = seed_legacy(&db).await;

        run_backfill(&db).await;
        run_backfill(&db).await; // second run must not duplicate anything

        let n_projects: i64 =
            sqlx::query_scalar(&db.sql("SELECT COUNT(*) FROM projects WHERE workspace_id = ?"))
                .bind(&ws)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(n_projects, 1, "exactly one default project after re-run");
    }
}
