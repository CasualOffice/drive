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

    /// Cheap connectivity check for readiness probes: run `SELECT 1` against the
    /// pool. `Ok(())` means the database is reachable and accepting queries.
    pub async fn ping(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    #[must_use]
    pub(crate) fn pool(&self) -> &AnyPool {
        &self.pool
    }

    /// Rewrite a query's placeholders for the active backend.
    ///
    /// The repos are written with SQLite-style positional `?` placeholders.
    /// sqlx's `Any` driver does **not** translate them, and Postgres requires
    /// `$1, $2, …`. So on Postgres we rewrite the Nth `?` to `$N`; on SQLite the
    /// string is returned untouched (zero-cost borrow). Every repo query passes
    /// its SQL through here — `sqlx::query(&self.db.sql("… WHERE id = ?"))` — so
    /// the exact same query source runs on both engines.
    ///
    /// Only `?` outside string literals is a placeholder; our queries never
    /// contain `?` inside string literals, so a plain scan is correct. `?` is
    /// not used as a Postgres operator anywhere in this crate.
    #[must_use]
    pub(crate) fn sql<'a>(&self, query: &'a str) -> std::borrow::Cow<'a, str> {
        match self.backend {
            DbBackend::Sqlite => std::borrow::Cow::Borrowed(query),
            DbBackend::Postgres => {
                let mut out = String::with_capacity(query.len() + 8);
                let mut n = 0u32;
                for ch in query.chars() {
                    if ch == '?' {
                        n += 1;
                        out.push('$');
                        out.push_str(&n.to_string());
                    } else {
                        out.push(ch);
                    }
                }
                std::borrow::Cow::Owned(out)
            }
        }
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
