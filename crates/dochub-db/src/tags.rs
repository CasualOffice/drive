//! Tags — workspace-scoped labels on documents, and the file↔tag join that
//! powers "search by tag".
//!
//! A [`Tag`] is unique by `(workspace_id, name)`. [`TagRepo::get_or_create`]
//! returns the existing tag when the name is already present, so callers can
//! tag freely without pre-checking. [`TagRepo::assign`] / [`TagRepo::unassign`]
//! manage the many-to-many `file_tags` join; [`TagRepo::tags_for_file`] and
//! [`TagRepo::file_ids_for_tag`] are the read sides the detail panel and the
//! search-by-tag surface consume. Deletes/unassigns remove the join rows
//! explicitly rather than relying on FK cascade (SQLite leaves FKs off).

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// A stored tag row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: time::OffsetDateTime,
    pub created_by: String,
}

/// The fields a caller supplies to create (or look up) a tag.
#[derive(Debug, Clone)]
pub struct NewTag {
    pub workspace_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_by: String,
}

#[derive(Debug, Clone)]
pub struct TagRepo<'a> {
    db: &'a Db,
}

impl<'a> TagRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Get the tag named `new.name` in the workspace, creating it if absent.
    /// Idempotent — repeated calls with the same name return the same row (the
    /// original `color` is kept; this never renames or recolors).
    pub async fn get_or_create(&self, new: &NewTag) -> Result<Tag, DbError> {
        if let Some(existing) = self.find_by_name(&new.workspace_id, &new.name).await? {
            return Ok(existing);
        }
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        let created_s = ts(created_at);
        let res = sqlx::query(&self.db.sql(
            "INSERT INTO tags (id, workspace_id, name, color, created_at, created_by) \
             VALUES (?, ?, ?, ?, ?, ?)",
        ))
        .bind(&id)
        .bind(&new.workspace_id)
        .bind(&new.name)
        .bind(&new.color)
        .bind(&created_s)
        .bind(&new.created_by)
        .execute(self.db.pool())
        .await;
        match res {
            Ok(_) => Ok(Tag {
                id,
                workspace_id: new.workspace_id.clone(),
                name: new.name.clone(),
                color: new.color.clone(),
                created_at,
                created_by: new.created_by.clone(),
            }),
            // Lost a race to a concurrent create — return the winning row.
            Err(_) => self
                .find_by_name(&new.workspace_id, &new.name)
                .await?
                .ok_or(DbError::NotFound),
        }
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<Tag>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, name, color, created_at, created_by \
             FROM tags WHERE id = ?",
        ))
        .bind(id)
        .fetch_optional(self.db.pool())
        .await?;
        row.as_ref().map(row_to_tag).transpose()
    }

    pub async fn find_by_name(
        &self,
        workspace_id: &str,
        name: &str,
    ) -> Result<Option<Tag>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, name, color, created_at, created_by \
             FROM tags WHERE workspace_id = ? AND name = ?",
        ))
        .bind(workspace_id)
        .bind(name)
        .fetch_optional(self.db.pool())
        .await?;
        row.as_ref().map(row_to_tag).transpose()
    }

    /// All tags in a workspace, name-ordered.
    pub async fn list_for_workspace(&self, workspace_id: &str) -> Result<Vec<Tag>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, name, color, created_at, created_by \
             FROM tags WHERE workspace_id = ? ORDER BY name ASC, id ASC",
        ))
        .bind(workspace_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_tag).collect()
    }

    /// Delete a tag and detach it from every file.
    pub async fn delete(&self, id: &str) -> Result<(), DbError> {
        sqlx::query(&self.db.sql("DELETE FROM file_tags WHERE tag_id = ?"))
            .bind(id)
            .execute(self.db.pool())
            .await?;
        sqlx::query(&self.db.sql("DELETE FROM tags WHERE id = ?"))
            .bind(id)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }

    /// Attach `tag_id` to `file_id`. Idempotent — re-attaching is a no-op.
    pub async fn assign(&self, file_id: &str, tag_id: &str, by: &str) -> Result<(), DbError> {
        if self.is_assigned(file_id, tag_id).await? {
            return Ok(());
        }
        let created_s = ts(time::OffsetDateTime::now_utc());
        let res = sqlx::query(&self.db.sql(
            "INSERT INTO file_tags (file_id, tag_id, created_at, created_by) \
             VALUES (?, ?, ?, ?)",
        ))
        .bind(file_id)
        .bind(tag_id)
        .bind(&created_s)
        .bind(by)
        .execute(self.db.pool())
        .await;
        match res {
            Ok(_) => Ok(()),
            Err(e) => {
                // Race: another writer attached it first — the desired state holds.
                if self.is_assigned(file_id, tag_id).await? {
                    Ok(())
                } else {
                    Err(e.into())
                }
            }
        }
    }

    /// Detach `tag_id` from `file_id`. Idempotent.
    pub async fn unassign(&self, file_id: &str, tag_id: &str) -> Result<(), DbError> {
        sqlx::query(
            &self
                .db
                .sql("DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?"),
        )
        .bind(file_id)
        .bind(tag_id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    async fn is_assigned(&self, file_id: &str, tag_id: &str) -> Result<bool, DbError> {
        let row = sqlx::query(
            &self
                .db
                .sql("SELECT 1 AS one FROM file_tags WHERE file_id = ? AND tag_id = ?"),
        )
        .bind(file_id)
        .bind(tag_id)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(row.is_some())
    }

    /// Tags attached to a file, name-ordered.
    pub async fn tags_for_file(&self, file_id: &str) -> Result<Vec<Tag>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT t.id, t.workspace_id, t.name, t.color, t.created_at, t.created_by \
             FROM tags t JOIN file_tags ft ON ft.tag_id = t.id \
             WHERE ft.file_id = ? ORDER BY t.name ASC, t.id ASC",
        ))
        .bind(file_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_tag).collect()
    }

    /// File ids carrying `tag_id` — the search-by-tag read side.
    pub async fn file_ids_for_tag(&self, tag_id: &str) -> Result<Vec<String>, DbError> {
        let rows = sqlx::query(
            &self
                .db
                .sql("SELECT file_id FROM file_tags WHERE tag_id = ? ORDER BY file_id"),
        )
        .bind(tag_id)
        .fetch_all(self.db.pool())
        .await?;
        Ok(rows.iter().map(|r| r.get::<String, _>("file_id")).collect())
    }
}

fn row_to_tag(row: &sqlx::any::AnyRow) -> Result<Tag, DbError> {
    Ok(Tag {
        id: row.get("id"),
        workspace_id: row.get("workspace_id"),
        name: row.get("name"),
        color: row.try_get::<Option<String>, _>("color").ok().flatten(),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        created_by: row.get("created_by"),
    })
}
