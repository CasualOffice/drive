use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("not found")]
    NotFound,

    #[error("unique violation: {0}")]
    UniqueViolation(String),

    #[error("invalid database url: {0}")]
    InvalidUrl(String),

    #[error("corrupt stored data: {0}")]
    Corrupt(&'static str),

    #[error("write contention: exhausted retries")]
    Contention,
}

impl DbError {
    /// Map a `sqlx::Error` to `NotFound` for "0 rows", otherwise pass through.
    #[must_use]
    pub(crate) fn from_sqlx_no_rows(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => Self::NotFound,
            other => Self::Sqlx(other),
        }
    }

    /// True when this error is a unique-/primary-key-constraint violation.
    /// Portable across SQLite + Postgres via sqlx's `is_unique_violation`; lets
    /// callers retry an insert that raced a concurrent writer to the same key.
    #[must_use]
    pub fn is_unique_violation(&self) -> bool {
        match self {
            Self::UniqueViolation(_) => true,
            Self::Sqlx(e) => e
                .as_database_error()
                .is_some_and(sqlx::error::DatabaseError::is_unique_violation),
            _ => false,
        }
    }
}
