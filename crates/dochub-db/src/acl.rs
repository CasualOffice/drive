//! Per-resource ACL grants. Spec: docs/design/foundation-access-rag-mcp.md §3.
//!
//! An `acl_grants` row is an explicit grant of a role to a subject (a specific
//! user, or every holder of a role) on a resource (a workspace, project,
//! folder, or file). User-to-user document sharing is a grant with
//! `subject_kind = 'user'`. Grants are read by `dochub-authz` when resolving a
//! user's effective permissions on a resource and its ancestors.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// Resource-kind string constants for `acl_grants.resource_kind`.
pub mod resource_kind {
    pub const WORKSPACE: &str = "workspace";
    pub const PROJECT: &str = "project";
    pub const FOLDER: &str = "folder";
    pub const FILE: &str = "file";
}

/// Subject-kind string constants for `acl_grants.subject_kind`.
pub mod subject_kind {
    pub const USER: &str = "user";
    pub const ROLE: &str = "role";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclGrant {
    pub id: String,
    pub resource_kind: String,
    pub resource_id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub role: String,
    pub created_at: time::OffsetDateTime,
    pub created_by: String,
}

#[derive(Debug, Clone)]
pub struct NewAclGrant {
    pub resource_kind: String,
    pub resource_id: String,
    pub subject_kind: String,
    pub subject_id: String,
    pub role: String,
    pub created_by: String,
}

#[derive(Debug, Clone)]
pub struct AclRepo<'a> {
    db: &'a Db,
}

impl<'a> AclRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Create a grant. Re-granting the same (resource, subject) replaces the
    /// prior role so a share can be upgraded/downgraded without stacking rows.
    pub async fn grant(&self, new: &NewAclGrant) -> Result<AclGrant, DbError> {
        sqlx::query(&self.db.sql(
            "DELETE FROM acl_grants \
             WHERE resource_kind = ? AND resource_id = ? \
               AND subject_kind = ? AND subject_id = ?",
        ))
        .bind(&new.resource_kind)
        .bind(&new.resource_id)
        .bind(&new.subject_kind)
        .bind(&new.subject_id)
        .execute(self.db.pool())
        .await?;

        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        sqlx::query(&self.db.sql(
            "INSERT INTO acl_grants \
                (id, resource_kind, resource_id, subject_kind, subject_id, role, created_at, created_by) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ))
        .bind(&id)
        .bind(&new.resource_kind)
        .bind(&new.resource_id)
        .bind(&new.subject_kind)
        .bind(&new.subject_id)
        .bind(&new.role)
        .bind(ts(created_at))
        .bind(&new.created_by)
        .execute(self.db.pool())
        .await?;
        Ok(AclGrant {
            id,
            resource_kind: new.resource_kind.clone(),
            resource_id: new.resource_id.clone(),
            subject_kind: new.subject_kind.clone(),
            subject_id: new.subject_id.clone(),
            role: new.role.clone(),
            created_at,
            created_by: new.created_by.clone(),
        })
    }

    pub async fn find_by_id(&self, id: &str) -> Result<AclGrant, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, resource_kind, resource_id, subject_kind, subject_id, role, \
                    created_at, created_by \
             FROM acl_grants WHERE id = ?",
        ))
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        row_to_grant(&row)
    }

    pub async fn revoke(&self, id: &str) -> Result<(), DbError> {
        sqlx::query(&self.db.sql("DELETE FROM acl_grants WHERE id = ?"))
            .bind(id)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }

    /// All grants attached to one resource.
    pub async fn list_for_resource(
        &self,
        resource_kind: &str,
        resource_id: &str,
    ) -> Result<Vec<AclGrant>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, resource_kind, resource_id, subject_kind, subject_id, role, \
                    created_at, created_by \
             FROM acl_grants WHERE resource_kind = ? AND resource_id = ? \
             ORDER BY created_at ASC",
        ))
        .bind(resource_kind)
        .bind(resource_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_grant).collect()
    }

    /// All grants made directly to a specific user (`subject_kind = 'user'`).
    /// Backs `dochub-authz`'s readable-scope computation for list/search.
    pub async fn list_for_user_subject(&self, user_id: &str) -> Result<Vec<AclGrant>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, resource_kind, resource_id, subject_kind, subject_id, role, \
                    created_at, created_by \
             FROM acl_grants WHERE subject_kind = 'user' AND subject_id = ? \
             ORDER BY created_at ASC",
        ))
        .bind(user_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_grant).collect()
    }
}

fn row_to_grant(row: &sqlx::any::AnyRow) -> Result<AclGrant, DbError> {
    Ok(AclGrant {
        id: row.get("id"),
        resource_kind: row.get("resource_kind"),
        resource_id: row.get("resource_id"),
        subject_kind: row.get("subject_kind"),
        subject_id: row.get("subject_id"),
        role: row.get("role"),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        created_by: row.get("created_by"),
    })
}
