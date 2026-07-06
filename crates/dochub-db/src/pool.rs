//! Backend-erased sqlx pool. Uses `sqlx::Any` to abstract over `SQLite`
//! (default) and Postgres (production); migrations are portable across both.

use sqlx::{
    any::{install_default_drivers, AnyPoolOptions},
    migrate::{MigrateDatabase, Migrator},
    AnyPool, Postgres, Sqlite,
};

use crate::DbError;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbBackend {
    Sqlite,
    Postgres,
}

/// Backend-erased database handle. Holds an `AnyPool` internally.
#[derive(Debug, Clone)]
pub struct Db {
    pool: AnyPool,
    backend: DbBackend,
}

impl Db {
    /// Connect using a URL like `sqlite::memory:`, `sqlite:///path/to.db`, or
    /// `postgres://...`. Creates the database file/instance if missing and
    /// runs all migrations on startup.
    pub async fn connect(url: &str) -> Result<Self, DbError> {
        install_default_drivers();
        let backend = url_backend(url)?;

        match backend {
            DbBackend::Sqlite => {
                if !Sqlite::database_exists(url).await.unwrap_or(false) {
                    Sqlite::create_database(url).await?;
                }
            }
            DbBackend::Postgres => {
                if !Postgres::database_exists(url).await.unwrap_or(true) {
                    Postgres::create_database(url).await?;
                }
            }
        }

        // SQLite is single-writer at the file level, and `sqlite::memory:`
        // is per-connection — so a pool of N gives you N disjoint in-memory
        // DBs. Cap at 1 for SQLite; Postgres gets the standard 10.
        let max = match backend {
            DbBackend::Sqlite => 1,
            DbBackend::Postgres => 10,
        };
        let pool = AnyPoolOptions::new()
            .max_connections(max)
            .connect(url)
            .await?;
        MIGRATOR.run(&pool).await?;

        Ok(Self { pool, backend })
    }

    #[must_use]
    pub fn backend(&self) -> DbBackend {
        self.backend
    }

    #[must_use]
    pub(crate) fn pool(&self) -> &AnyPool {
        &self.pool
    }
}

fn url_backend(url: &str) -> Result<DbBackend, DbError> {
    if url.starts_with("sqlite:") {
        Ok(DbBackend::Sqlite)
    } else if url.starts_with("postgres:") || url.starts_with("postgresql:") {
        Ok(DbBackend::Postgres)
    } else {
        Err(DbError::InvalidUrl(url.to_string()))
    }
}
