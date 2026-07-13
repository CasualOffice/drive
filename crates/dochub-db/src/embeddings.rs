//! Chunk-embedding storage for the RAG layer (Phase 5, migration 0026).
//!
//! Each row is one chunk of a file's head content plus its embedding vector.
//! The `embed_file` job writes them (chunk + embed via `dochub-ai`); semantic
//! search reads a workspace's vectors and ranks them by cosine similarity in
//! Rust (`dochub_ai::top_k`).
//!
//! Portability: the vector is stored as base64 of its little-endian `f32` bytes
//! in a TEXT column — the same convention `workspace_keys.wrapped_dek` uses —
//! so there is no BLOB-vs-BYTEA divergence and no vector extension. Retrieval is
//! a brute-force scan over one workspace's rows, which is linear but trivial at
//! per-workspace scale (an ANN index is a scale follow-up).

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sqlx::Row;

use crate::{users::ts, Db, DbError};

/// A chunk embedding to persist. `content_hash` + `dims` are carried on the
/// batch (see [`EmbeddingRepo::replace_for_file`]), not per row.
#[derive(Debug, Clone)]
pub struct NewEmbedding {
    pub chunk_index: i64,
    pub vector: Vec<f32>,
    pub chunk_text: String,
    pub char_start: i64,
    pub char_end: i64,
}

/// A stored chunk embedding with its decoded vector.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredEmbedding {
    pub id: String,
    pub file_id: String,
    pub workspace_id: String,
    pub chunk_index: i64,
    pub content_hash: String,
    pub vector: Vec<f32>,
    pub chunk_text: String,
    pub char_start: i64,
    pub char_end: i64,
}

#[derive(Debug, Clone)]
pub struct EmbeddingRepo<'a> {
    db: &'a Db,
}

impl<'a> EmbeddingRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Replace every embedding for `file_id` with `chunks`, atomically. This is
    /// the idempotent re-embed path: a file's prior vectors are deleted and the
    /// fresh set inserted in one transaction, so a reader never sees a mix of
    /// old and new. `content_hash` is the head hash the vectors were built from
    /// (staleness key); `dims` is each vector's length.
    ///
    /// Vectors whose length disagrees with `dims` are a programming error and
    /// yield [`DbError::Corrupt`] before any write.
    pub async fn replace_for_file(
        &self,
        file_id: &str,
        workspace_id: &str,
        content_hash: &str,
        dims: i64,
        chunks: &[NewEmbedding],
    ) -> Result<(), DbError> {
        for c in chunks {
            if c.vector.len() as i64 != dims {
                return Err(DbError::Corrupt("embedding vector length != dims"));
            }
        }
        let now_s = ts(time::OffsetDateTime::now_utc());

        let mut tx = self.db.pool().begin().await?;
        sqlx::query(&self.db.sql("DELETE FROM embeddings WHERE file_id = ?"))
            .bind(file_id)
            .execute(&mut *tx)
            .await?;
        for c in chunks {
            let id = ulid::Ulid::new().to_string();
            let encoded = encode_vector(&c.vector);
            sqlx::query(&self.db.sql(
                "INSERT INTO embeddings \
                 (id, file_id, workspace_id, chunk_index, content_hash, dims, \
                  vector, chunk_text, char_start, char_end, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ))
            .bind(&id)
            .bind(file_id)
            .bind(workspace_id)
            .bind(c.chunk_index)
            .bind(content_hash)
            .bind(dims)
            .bind(&encoded)
            .bind(&c.chunk_text)
            .bind(c.char_start)
            .bind(c.char_end)
            .bind(&now_s)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Remove every embedding for a file (trash / delete). Returns the number of
    /// rows removed.
    pub async fn delete_for_file(&self, file_id: &str) -> Result<u64, DbError> {
        let res = sqlx::query(&self.db.sql("DELETE FROM embeddings WHERE file_id = ?"))
            .bind(file_id)
            .execute(self.db.pool())
            .await?;
        Ok(res.rows_affected())
    }

    /// All embeddings in a workspace, oldest first — the candidate set semantic
    /// search ranks by cosine similarity.
    pub async fn list_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<StoredEmbedding>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, file_id, workspace_id, chunk_index, content_hash, dims, \
             vector, chunk_text, char_start, char_end \
             FROM embeddings WHERE workspace_id = ? \
             ORDER BY file_id ASC, chunk_index ASC",
        ))
        .bind(workspace_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_embedding).collect()
    }

    /// The `content_hash` the file's embeddings were built from, if any. Lets
    /// the embed job skip a file whose head is already embedded at the current
    /// hash. Returns `None` when the file has no embeddings yet.
    pub async fn content_hash_for_file(&self, file_id: &str) -> Result<Option<String>, DbError> {
        let row = sqlx::query(
            &self
                .db
                .sql("SELECT content_hash FROM embeddings WHERE file_id = ? LIMIT 1"),
        )
        .bind(file_id)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(row.map(|r| r.get::<String, _>("content_hash")))
    }

    /// Count of chunk embeddings stored for a file — observability / tests.
    pub async fn count_for_file(&self, file_id: &str) -> Result<i64, DbError> {
        let row = sqlx::query(
            &self
                .db
                .sql("SELECT COUNT(*) AS n FROM embeddings WHERE file_id = ?"),
        )
        .bind(file_id)
        .fetch_one(self.db.pool())
        .await?;
        Ok(row.get::<i64, _>("n"))
    }
}

/// Encode a vector as base64 of its little-endian `f32` bytes.
fn encode_vector(v: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for &x in v {
        bytes.extend_from_slice(&x.to_le_bytes());
    }
    STANDARD.encode(&bytes)
}

/// Decode a base64 little-endian `f32` blob back into a vector.
fn decode_vector(b64: &str) -> Result<Vec<f32>, DbError> {
    let bytes = STANDARD
        .decode(b64.as_bytes())
        .map_err(|_| DbError::Corrupt("embeddings.vector is not valid base64"))?;
    if bytes.len() % 4 != 0 {
        return Err(DbError::Corrupt(
            "embeddings.vector byte length not a multiple of 4",
        ));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

fn row_to_embedding(row: &sqlx::any::AnyRow) -> Result<StoredEmbedding, DbError> {
    Ok(StoredEmbedding {
        id: row.get("id"),
        file_id: row.get("file_id"),
        workspace_id: row.get("workspace_id"),
        chunk_index: row.get::<i64, _>("chunk_index"),
        content_hash: row.get("content_hash"),
        vector: decode_vector(&row.get::<String, _>("vector"))?,
        chunk_text: row.get("chunk_text"),
        char_start: row.get::<i64, _>("char_start"),
        char_end: row.get::<i64, _>("char_end"),
    })
}
