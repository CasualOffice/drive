//! `dochub-worker` — the background job runner that drains the durable job
//! queue (`dochub-db` `JobsRepo`, migration 0025).
//!
//! A [`Worker`] owns a [`Db`] handle and a registry of [`JobHandler`]s keyed by
//! job `kind`. Its poll loop claims the next runnable job, dispatches it to the
//! matching handler, and records the result:
//!
//! - handler returns `Ok(())`  → [`JobsRepo::mark_done`].
//! - handler returns `Err(..)` → [`JobsRepo::mark_failed`] with exponential
//!   backoff; the queue requeues it until `attempts` reaches `max_attempts`,
//!   then parks it in `failed`.
//! - no handler registered for the `kind` → treated as a failure (so a stray
//!   job can't wedge the loop); it backs off and eventually parks.
//!
//! All durable state lives in the DB, so an interrupted process resumes cleanly
//! and the claim is single-winner under concurrent workers (the queue's
//! optimistic `WHERE state='queued'` guard). This crate is deliberately ignorant
//! of storage, encryption, and the content index — a concrete handler (e.g.
//! `index_file`) is registered by the layer that owns those (`dochub-http` /
//! `dochub-bin`), keeping the runtime a small, unit-testable primitive.
//!
//! Replaces the lazy, on-request reindex documented as a follow-up in
//! `dochub-http::content_search` ("a real bounded worker is the scale
//! follow-up").

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use dochub_db::{job_state, Db, DbError, Job, JobsRepo};

/// Error a handler returns. Boxed so handlers can surface any error type
/// without this crate depending on their error crates.
pub type HandlerError = Box<dyn std::error::Error + Send + Sync>;

/// Result a [`JobHandler`] returns for one job.
pub type HandlerResult = Result<(), HandlerError>;

/// Processes one job of a given `kind`. Registered on a [`Worker`] under that
/// kind. Implementations do the real work (decrypt + extract + index, embed,
/// …); a handler must be idempotent because a job can be retried after a crash
/// between the work completing and `mark_done` landing.
#[async_trait]
pub trait JobHandler: Send + Sync {
    /// Run the job. `Ok(())` marks it done; `Err(..)` schedules a retry (or
    /// parks it once attempts are exhausted).
    async fn handle(&self, job: &Job) -> HandlerResult;
}

/// Outcome of a single [`Worker::run_once`] step — surfaced for tests and
/// observability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Nothing was runnable (queue empty or nothing due yet).
    Idle,
    /// A job completed successfully. Carries its id.
    Completed(String),
    /// A job failed and was requeued for a later retry. Carries its id.
    Retried(String),
    /// A job failed and hit its attempt ceiling — parked in `failed`.
    Parked(String),
}

/// Background job runner. Cheap to build; the poll loop is started with
/// [`Worker::spawn`].
pub struct Worker {
    db: Db,
    handlers: HashMap<String, Arc<dyn JobHandler>>,
    poll_interval: Duration,
    base_backoff: time::Duration,
    max_backoff: time::Duration,
}

impl std::fmt::Debug for Worker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Worker")
            .field("kinds", &self.handlers.keys().collect::<Vec<_>>())
            .field("poll_interval", &self.poll_interval)
            .finish_non_exhaustive()
    }
}

impl Worker {
    /// New worker over `db` with default cadence: poll every 2 s, retry backoff
    /// from 5 s doubling up to 5 min.
    #[must_use]
    pub fn new(db: Db) -> Self {
        Self {
            db,
            handlers: HashMap::new(),
            poll_interval: Duration::from_secs(2),
            base_backoff: time::Duration::seconds(5),
            max_backoff: time::Duration::minutes(5),
        }
    }

    /// How often the spawned loop wakes to drain due jobs.
    #[must_use]
    pub fn with_poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }

    /// Backoff schedule for failed jobs: the first retry waits `base`, each
    /// subsequent one doubles, capped at `max`.
    #[must_use]
    pub fn with_backoff(mut self, base: time::Duration, max: time::Duration) -> Self {
        self.base_backoff = base;
        self.max_backoff = max;
        self
    }

    /// Register `handler` for jobs of `kind`. Replaces any prior handler for the
    /// same kind. Chainable.
    #[must_use]
    pub fn register(mut self, kind: impl Into<String>, handler: Arc<dyn JobHandler>) -> Self {
        self.handlers.insert(kind.into(), handler);
        self
    }

    /// Claim and process at most one job due by `now`. Returns [`Step::Idle`]
    /// when nothing is runnable. This is the unit-testable core of the loop —
    /// [`Worker::spawn`] just calls it on a ticker until idle.
    pub async fn run_once(&self, now: time::OffsetDateTime) -> Result<Step, DbError> {
        let repo = JobsRepo::new(&self.db);
        let Some(job) = repo.claim_next(now).await? else {
            return Ok(Step::Idle);
        };

        let result = match self.handlers.get(&job.kind) {
            Some(handler) => handler.handle(&job).await,
            None => Err(format!("no handler registered for job kind '{}'", job.kind).into()),
        };

        match result {
            Ok(()) => {
                repo.mark_done(&job.id).await?;
                Ok(Step::Completed(job.id))
            }
            Err(e) => {
                let msg = e.to_string();
                tracing::warn!(job_id = %job.id, kind = %job.kind, attempt = job.attempts, error = %msg, "job failed");
                let delay = backoff_for(self.base_backoff, self.max_backoff, job.attempts);
                let updated = repo.mark_failed(&job.id, &msg, delay).await?;
                if updated.state == job_state::FAILED {
                    tracing::error!(job_id = %job.id, kind = %job.kind, attempts = updated.attempts, "job parked after exhausting retries");
                    Ok(Step::Parked(job.id))
                } else {
                    Ok(Step::Retried(job.id))
                }
            }
        }
    }

    /// Spawn the poll loop. Returns the `JoinHandle` so the caller can abort it
    /// on shutdown (mirrors `PresenceHub::spawn_sweep`). Each tick drains every
    /// job due at that instant, then sleeps until the next tick.
    #[must_use]
    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(self.poll_interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                self.drain().await;
            }
        })
    }

    /// Process due jobs until the queue is idle or a DB error interrupts the
    /// pass (logged; the next tick retries). Public so an operator/one-shot
    /// runner can drain without spawning a loop.
    pub async fn drain(&self) {
        loop {
            match self.run_once(time::OffsetDateTime::now_utc()).await {
                Ok(Step::Idle) => break,
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(error = %e, "worker: db error draining queue; will retry next tick");
                    break;
                }
            }
        }
    }
}

/// Exponential backoff for the `attempts`-th failure (attempts is 1-based after
/// the claim bumps it): `base * 2^(attempts-1)`, capped at `max` and saturating
/// rather than overflowing on a large attempt count.
fn backoff_for(base: time::Duration, max: time::Duration, attempts: i64) -> time::Duration {
    // Cap the shift at 30 so `1_i32 << shift` stays positive (bit 31 is the
    // sign). base * 2^30 already saturates far past any sane `max`.
    let shift = attempts.clamp(1, 31) as u32 - 1;
    let factor = 1_i32 << shift;
    let scaled = base.saturating_mul(factor);
    if scaled > max {
        max
    } else {
        scaled
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use dochub_db::NewJob;

    async fn fresh_db() -> Db {
        Db::connect("sqlite::memory:").await.expect("connect")
    }

    /// Handler that records every payload it saw and can be told to fail.
    struct Recorder {
        seen: Mutex<Vec<String>>,
        calls: AtomicUsize,
        fail: bool,
    }
    impl Recorder {
        fn new(fail: bool) -> Arc<Self> {
            Arc::new(Self {
                seen: Mutex::new(Vec::new()),
                calls: AtomicUsize::new(0),
                fail,
            })
        }
    }
    #[async_trait]
    impl JobHandler for Recorder {
        async fn handle(&self, job: &Job) -> HandlerResult {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.seen.lock().unwrap().push(job.payload.clone());
            if self.fail {
                Err("boom".into())
            } else {
                Ok(())
            }
        }
    }

    #[tokio::test]
    async fn runs_registered_handler_then_marks_done() {
        let db = fresh_db().await;
        let rec = Recorder::new(false);
        let worker = Worker::new(db.clone()).register("echo", rec.clone());

        JobsRepo::new(&db)
            .enqueue(&NewJob {
                kind: "echo".into(),
                payload: "hello".into(),
                max_attempts: None,
                run_after: None,
            })
            .await
            .unwrap();

        let now = time::OffsetDateTime::now_utc();
        let step = worker.run_once(now).await.unwrap();
        assert!(matches!(step, Step::Completed(_)));
        assert_eq!(rec.seen.lock().unwrap().as_slice(), &["hello".to_string()]);
        assert_eq!(
            JobsRepo::new(&db)
                .count_in_state(job_state::DONE)
                .await
                .unwrap(),
            1
        );

        // Nothing left runnable.
        assert_eq!(worker.run_once(now).await.unwrap(), Step::Idle);
    }

    #[tokio::test]
    async fn failing_handler_retries_then_parks() {
        let db = fresh_db().await;
        let rec = Recorder::new(true);
        // Small backoff so we can jump past it; ceiling of 2 attempts.
        let worker = Worker::new(db.clone())
            .register("flaky", rec.clone())
            .with_backoff(time::Duration::seconds(1), time::Duration::seconds(10));

        JobsRepo::new(&db)
            .enqueue(&NewJob {
                kind: "flaky".into(),
                payload: "x".into(),
                max_attempts: Some(2),
                run_after: None,
            })
            .await
            .unwrap();

        // Attempt 1 → requeued.
        let t0 = time::OffsetDateTime::now_utc();
        assert!(matches!(
            worker.run_once(t0).await.unwrap(),
            Step::Retried(_)
        ));
        assert_eq!(
            JobsRepo::new(&db)
                .count_in_state(job_state::QUEUED)
                .await
                .unwrap(),
            1
        );

        // Attempt 2 (jump past backoff) → attempts hits the ceiling, parked.
        let t1 = t0 + time::Duration::hours(1);
        assert!(matches!(
            worker.run_once(t1).await.unwrap(),
            Step::Parked(_)
        ));
        assert_eq!(
            JobsRepo::new(&db)
                .count_in_state(job_state::FAILED)
                .await
                .unwrap(),
            1
        );
        assert_eq!(rec.calls.load(Ordering::SeqCst), 2);

        // Parked job is no longer claimable.
        assert_eq!(worker.run_once(t1).await.unwrap(), Step::Idle);
    }

    #[tokio::test]
    async fn unknown_kind_is_failed_not_wedged() {
        let db = fresh_db().await;
        let worker = Worker::new(db.clone()); // no handlers

        JobsRepo::new(&db)
            .enqueue(&NewJob {
                kind: "mystery".into(),
                payload: "{}".into(),
                max_attempts: Some(1),
                run_after: None,
            })
            .await
            .unwrap();

        // max_attempts=1: the first failure already hits the ceiling → parked.
        let step = worker
            .run_once(time::OffsetDateTime::now_utc())
            .await
            .unwrap();
        assert!(matches!(step, Step::Parked(_)));
        assert_eq!(
            JobsRepo::new(&db)
                .count_in_state(job_state::FAILED)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn idle_when_queue_empty() {
        let db = fresh_db().await;
        let worker = Worker::new(db);
        let step = worker
            .run_once(time::OffsetDateTime::now_utc())
            .await
            .unwrap();
        assert_eq!(step, Step::Idle);
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let base = time::Duration::seconds(5);
        let max = time::Duration::minutes(5);
        assert_eq!(backoff_for(base, max, 1), time::Duration::seconds(5));
        assert_eq!(backoff_for(base, max, 2), time::Duration::seconds(10));
        assert_eq!(backoff_for(base, max, 3), time::Duration::seconds(20));
        // Far out → capped at max, never overflowing.
        assert_eq!(backoff_for(base, max, 60), time::Duration::minutes(5));
    }
}
