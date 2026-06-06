//! Folders — hierarchical tree. `parent_id = NULL` ≡ root.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub owner_id: String,
    pub trashed_at: Option<time::OffsetDateTime>,
    pub original_parent_id: Option<String>,
    pub created_at: time::OffsetDateTime,
    pub modified_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewFolder {
    pub parent_id: Option<String>,
    pub name: String,
    pub owner_id: String,
}

#[derive(Debug, Clone)]
pub struct FolderRepo<'a> {
    db: &'a Db,
}

impl<'a> FolderRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Create a new folder under `parent_id` (None = root).
    pub async fn insert(&self, new: &NewFolder) -> Result<Folder, DbError> {
        let id = ulid::Ulid::new().to_string();
        let now = time::OffsetDateTime::now_utc();
        let now_s = ts(now);
        sqlx::query(
            "INSERT INTO folders (id, parent_id, name, owner_id, created_at, modified_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&new.parent_id)
        .bind(&new.name)
        .bind(&new.owner_id)
        .bind(&now_s)
        .bind(&now_s)
        .execute(self.db.pool())
        .await?;
        Ok(Folder {
            id,
            parent_id: new.parent_id.clone(),
            name: new.name.clone(),
            owner_id: new.owner_id.clone(),
            trashed_at: None,
            original_parent_id: None,
            created_at: now,
            modified_at: now,
        })
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Folder, DbError> {
        let row = sqlx::query(
            "SELECT id, parent_id, name, owner_id, trashed_at, original_parent_id, \
                    created_at, modified_at \
             FROM folders WHERE id = ?",
        )
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        row_to_folder(&row)
    }

    /// List non-trashed folders directly under `parent_id` (None = root) for
    /// an owner. Sorted by name ascending.
    pub async fn list_children(
        &self,
        parent_id: Option<&str>,
        owner_id: &str,
    ) -> Result<Vec<Folder>, DbError> {
        let rows = match parent_id {
            Some(pid) => sqlx::query(
                "SELECT id, parent_id, name, owner_id, trashed_at, original_parent_id, \
                            created_at, modified_at \
                     FROM folders \
                     WHERE parent_id = ? AND owner_id = ? AND trashed_at IS NULL \
                     ORDER BY name ASC",
            )
            .bind(pid)
            .bind(owner_id),
            None => sqlx::query(
                "SELECT id, parent_id, name, owner_id, trashed_at, original_parent_id, \
                        created_at, modified_at \
                 FROM folders \
                 WHERE parent_id IS NULL AND owner_id = ? AND trashed_at IS NULL \
                 ORDER BY name ASC",
            )
            .bind(owner_id),
        }
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_folder).collect()
    }

    pub async fn rename(&self, id: &str, new_name: &str) -> Result<(), DbError> {
        let now_s = ts(time::OffsetDateTime::now_utc());
        sqlx::query("UPDATE folders SET name = ?, modified_at = ? WHERE id = ?")
            .bind(new_name)
            .bind(&now_s)
            .bind(id)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }

    pub async fn move_to(&self, id: &str, new_parent_id: Option<&str>) -> Result<(), DbError> {
        let now_s = ts(time::OffsetDateTime::now_utc());
        sqlx::query("UPDATE folders SET parent_id = ?, modified_at = ? WHERE id = ?")
            .bind(new_parent_id)
            .bind(&now_s)
            .bind(id)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }

    pub async fn trash(&self, id: &str) -> Result<(), DbError> {
        let now = time::OffsetDateTime::now_utc();
        let now_s = ts(now);
        sqlx::query(
            "UPDATE folders \
             SET trashed_at = ?, original_parent_id = parent_id, parent_id = NULL, modified_at = ? \
             WHERE id = ?",
        )
        .bind(&now_s)
        .bind(&now_s)
        .bind(id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    pub async fn restore(&self, id: &str) -> Result<(), DbError> {
        let now_s = ts(time::OffsetDateTime::now_utc());
        sqlx::query(
            "UPDATE folders \
             SET parent_id = original_parent_id, trashed_at = NULL, original_parent_id = NULL, modified_at = ? \
             WHERE id = ?",
        )
        .bind(&now_s)
        .bind(id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }
}

fn row_to_folder(row: &sqlx::any::AnyRow) -> Result<Folder, DbError> {
    Ok(Folder {
        id: row.get("id"),
        parent_id: row.get("parent_id"),
        name: row.get("name"),
        owner_id: row.get("owner_id"),
        trashed_at: row
            .try_get::<Option<String>, _>("trashed_at")?
            .map(parse_ts)
            .transpose()?,
        original_parent_id: row.get("original_parent_id"),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        modified_at: parse_ts(row.get::<String, _>("modified_at"))?,
    })
}
