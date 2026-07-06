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
}
