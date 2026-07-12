//! Durable background-job queue — the shared substrate for content indexing,
//! AI embeds, and later agentic pipelines.
//!
//! A worker calls [`JobsRepo::claim_next`] to atomically take the next runnable
//! job (queued and due by `run_after`), runs the handler for its `kind`, then
//! calls [`JobsRepo::mark_done`] on success or [`JobsRepo::mark_failed`] on
//! error. `mark_failed` reschedules with a caller-supplied backoff until
//! `attempts` reaches `max_attempts`, after which the job is parked in
//! `failed`. All state lives in the DB, so an interrupted worker resumes
//! cleanly and a claim is safe under concurrent workers (an optimistic
//! `WHERE state='queued'` guard makes the claim single-winner).

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// Job lifecycle states.
pub mod state {
    pub const QUEUED: &str = "queued";
    pub const RUNNING: &str = "running";
    pub const DONE: &str = "done";
    pub const FAILED: &str = "failed";
}

/// Job-kind discriminator for "(re)index this file's content". The producer
/// ([`crate::Registry::commit_version`]) and the consumer (the `dochub-worker`
/// handler in `dochub-http`) share this constant so the string is defined once.
/// Payload is the bare `file_id`.
pub const KIND_INDEX_FILE: &str = "index_file";

/// Job-kind discriminator for "(re)embed this file's content" — the RAG layer's
/// chunk + embed + store step. Enqueued alongside [`KIND_INDEX_FILE`] on commit;
/// consumed by the embed handler in `dochub-http`. Payload is the bare
/// `file_id`.
pub const KIND_EMBED_FILE: &str = "embed_file";

/// A stored job row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub payload: String,
    pub state: String,
    pub attempts: i64,
    pub max_attempts: i64,
    pub run_after: time::OffsetDateTime,
    pub last_error: Option<String>,
    pub created_at: time::OffsetDateTime,
    pub updated_at: time::OffsetDateTime,
}

/// Fields a caller supplies to enqueue a job.
#[derive(Debug, Clone)]
pub struct NewJob {
    pub kind: String,
    pub payload: String,
    /// Retry ceiling; defaults to 5 when `None`.
    pub max_attempts: Option<i64>,
    /// Earliest run time; defaults to now (immediately runnable) when `None`.
    pub run_after: Option<time::OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct JobsRepo<'a> {
    db: &'a Db,
}

impl<'a> JobsRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Enqueue a new job (state `queued`, `attempts` 0).
    pub async fn enqueue(&self, new: &NewJob) -> Result<Job, DbError> {
        let id = ulid::Ulid::new().to_string();
        let now = time::OffsetDateTime::now_utc();
        let run_after = new.run_after.unwrap_or(now);
        let max_attempts = new.max_attempts.unwrap_or(5);
        let now_s = ts(now);
        let run_after_s = ts(run_after);
        sqlx::query(&self.db.sql(
            "INSERT INTO jobs \
             (id, kind, payload, state, attempts, max_attempts, run_after, last_error, created_at, updated_at) \
             VALUES (?, ?, ?, 'queued', 0, ?, ?, NULL, ?, ?)",
        ))
        .bind(&id)
        .bind(&new.kind)
        .bind(&new.payload)
        .bind(max_attempts)
        .bind(&run_after_s)
        .bind(&now_s)
        .bind(&now_s)
        .execute(self.db.pool())
        .await?;
        Ok(Job {
            id,
            kind: new.kind.clone(),
            payload: new.payload.clone(),
            state: state::QUEUED.to_string(),
            attempts: 0,
            max_attempts,
            run_after,
            last_error: None,
            created_at: now,
            updated_at: now,
        })
    }

    /// Atomically claim the next runnable job: the oldest `queued` job due by
    /// `now`. Marks it `running` and bumps `attempts`. Returns `None` when the
    /// queue has nothing due. Safe under concurrent workers — the optimistic
    /// `WHERE state='queued'` update ensures a single winner per job.
    pub async fn claim_next(&self, now: time::OffsetDateTime) -> Result<Option<Job>, DbError> {
        let now_s = ts(now);
        // A handful of attempts tolerates races where another worker claims the
        // candidate between our SELECT and UPDATE.
        for _ in 0..8 {
            let Some(id) = self.next_candidate_id(&now_s).await? else {
                return Ok(None);
            };
            let updated_s = ts(time::OffsetDateTime::now_utc());
            let res = sqlx::query(&self.db.sql(
                "UPDATE jobs SET state='running', attempts = attempts + 1, updated_at = ? \
                 WHERE id = ? AND state='queued'",
            ))
            .bind(&updated_s)
            .bind(&id)
            .execute(self.db.pool())
            .await?;
            if res.rows_affected() == 1 {
                return self.find_by_id(&id).await;
            }
            // Lost the race — try the next candidate.
        }
        Ok(None)
    }

    async fn next_candidate_id(&self, now_s: &str) -> Result<Option<String>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id FROM jobs WHERE state='queued' AND run_after <= ? \
             ORDER BY run_after ASC, id ASC LIMIT 1",
        ))
        .bind(now_s)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(row.map(|r| r.get::<String, _>("id")))
    }

    /// Mark a claimed job complete.
    pub async fn mark_done(&self, id: &str) -> Result<(), DbError> {
        sqlx::query(
            &self
                .db
                .sql("UPDATE jobs SET state='done', updated_at = ? WHERE id = ?"),
        )
        .bind(ts(time::OffsetDateTime::now_utc()))
        .bind(id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    /// Record a failure. If `attempts` has reached `max_attempts` the job is
    /// parked in `failed`; otherwise it is requeued to run again after
    /// `retry_delay`. Returns the updated row.
    pub async fn mark_failed(
        &self,
        id: &str,
        error: &str,
        retry_delay: time::Duration,
    ) -> Result<Job, DbError> {
        let job = self.find_by_id(id).await?.ok_or(DbError::NotFound)?;
        let now = time::OffsetDateTime::now_utc();
        let now_s = ts(now);
        if job.attempts >= job.max_attempts {
            sqlx::query(&self.db.sql(
                "UPDATE jobs SET state='failed', last_error = ?, updated_at = ? WHERE id = ?",
            ))
            .bind(error)
            .bind(&now_s)
            .bind(id)
            .execute(self.db.pool())
            .await?;
        } else {
            let run_after_s = ts(now + retry_delay);
            sqlx::query(&self.db.sql(
                "UPDATE jobs SET state='queued', run_after = ?, last_error = ?, updated_at = ? \
                 WHERE id = ?",
            ))
            .bind(&run_after_s)
            .bind(error)
            .bind(&now_s)
            .bind(id)
            .execute(self.db.pool())
            .await?;
        }
        self.find_by_id(id).await?.ok_or(DbError::NotFound)
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<Job>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, kind, payload, state, attempts, max_attempts, run_after, last_error, \
             created_at, updated_at FROM jobs WHERE id = ?",
        ))
        .bind(id)
        .fetch_optional(self.db.pool())
        .await?;
        row.as_ref().map(row_to_job).transpose()
    }

    /// Count of jobs in a given state — for observability / tests.
    pub async fn count_in_state(&self, state: &str) -> Result<i64, DbError> {
        let row = sqlx::query(
            &self
                .db
                .sql("SELECT COUNT(*) AS n FROM jobs WHERE state = ?"),
        )
        .bind(state)
        .fetch_one(self.db.pool())
        .await?;
        Ok(row.get::<i64, _>("n"))
    }
}

fn row_to_job(row: &sqlx::any::AnyRow) -> Result<Job, DbError> {
    Ok(Job {
        id: row.get("id"),
        kind: row.get("kind"),
        payload: row.get("payload"),
        state: row.get("state"),
        attempts: row.get::<i64, _>("attempts"),
        max_attempts: row.get::<i64, _>("max_attempts"),
        run_after: parse_ts(row.get::<String, _>("run_after"))?,
        last_error: row
            .try_get::<Option<String>, _>("last_error")
            .ok()
            .flatten(),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        updated_at: parse_ts(row.get::<String, _>("updated_at"))?,
    })
}
