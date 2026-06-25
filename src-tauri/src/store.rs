use crate::models::{Snippet, SnippetInput};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::env;
use std::fs;
use std::path::PathBuf;
use time::OffsetDateTime;

pub fn default_db_path() -> Result<PathBuf> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))
        .context("could not find a data directory")?;
    let path = base.join("AbraTab").join("AbraTab.db");
    migrate_legacy_db_path(&base, &path);
    Ok(path)
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open_default() -> Result<Self> {
        let path = default_db_path()?;
        if let Some(parent) = path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                let fallback = fallback_db_path()?;
                if let Some(fallback_parent) = fallback.parent() {
                    fs::create_dir_all(fallback_parent)
                        .with_context(|| format!("creating {}", fallback_parent.display()))?;
                }
                eprintln!(
                    "warning: could not create {} ({error}); using {}",
                    parent.display(),
                    fallback.display()
                );
                return Self::open(fallback);
            }
        }
        Self::open(path)
    }

    pub fn open(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn list(&self, query: Option<&str>, include_deleted: bool) -> Result<Vec<Snippet>> {
        let snippets = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at
                FROM snippets
                WHERE (?2 = 1 OR deleted_at IS NULL)
                  AND (
                    lower(title) LIKE ?1
                    OR lower(body) LIKE ?1
                    OR lower(description) LIKE ?1
                    OR lower(category) LIKE ?1
                    OR lower(tags) LIKE ?1
                    OR lower(shortcut) LIKE ?1
                  )
                ORDER BY pinned DESC, updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![pattern, include_deleted], row_to_snippet)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at
                FROM snippets
                WHERE (?1 = 1 OR deleted_at IS NULL)
                ORDER BY pinned DESC, updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![include_deleted], row_to_snippet)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        Ok(snippets)
    }

    pub fn get(&self, id: &str) -> Result<Option<Snippet>> {
        self.conn
            .query_row(
                r#"
                SELECT id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at
                FROM snippets
                WHERE id = ?1
                "#,
                params![id],
                row_to_snippet,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn get_by_shortcut(&self, shortcut: &str, shell: Option<&str>) -> Result<Option<Snippet>> {
        let shortcut = shortcut.trim();
        if shortcut.is_empty() {
            return Ok(None);
        }

        let shell = shell.unwrap_or("any").trim();
        self.conn
            .query_row(
                r#"
                SELECT id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at
                FROM snippets
                WHERE shortcut = ?1
                  AND enabled = 1
                  AND deleted_at IS NULL
                  AND (shell = 'any' OR shell = ?2)
                ORDER BY CASE WHEN shell = ?2 THEN 0 ELSE 1 END, updated_at DESC
                LIMIT 1
                "#,
                params![shortcut, shell],
                row_to_snippet,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn save(&self, input: SnippetInput) -> Result<Snippet> {
        let now = now_string();
        let id = input.id.unwrap_or_else(new_id);
        let existing = self.get(&id)?;
        let created_at = existing
            .as_ref()
            .map(|snippet| snippet.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let tags = serde_json::to_string(&input.tags.unwrap_or_default())?;

        self.conn.execute(
            r#"
            INSERT INTO snippets (id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                description = excluded.description,
                category = excluded.category,
                tags = excluded.tags,
                shortcut = excluded.shortcut,
                shell = excluded.shell,
                enabled = excluded.enabled,
                favorite = excluded.favorite,
                pinned = excluded.pinned,
                deleted_at = NULL,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                input.title.trim(),
                input.body,
                input.description.unwrap_or_default(),
                input.category.unwrap_or_default(),
                tags,
                input.shortcut.unwrap_or_default(),
                input.shell.unwrap_or_else(|| "any".to_string()),
                input.enabled.unwrap_or(true),
                input.favorite.unwrap_or(false),
                input.pinned.or_else(|| existing.as_ref().map(|snippet| snippet.pinned)).unwrap_or(false),
                created_at,
                now,
            ],
        )?;

        self.get(&id)?.context("snippet was not saved")
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE snippets SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn restore(&self, id: &str) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE snippets SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn purge(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE snippets SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, favorite, now],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE snippets SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, pinned, now],
        )?;
        Ok(())
    }

    pub fn set_category(&self, id: &str, category: &str) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE snippets SET category = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, category.trim(), now],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn export_snapshot(&self) -> Result<SyncSnapshot> {
        Ok(SyncSnapshot {
            schema: 1,
            client: "AbraTab".to_string(),
            exported_at: now_string(),
            snippets: self.list(None, true)?,
        })
    }

    #[allow(dead_code)]
    pub fn import_snapshot(&self, snapshot: SyncSnapshot) -> Result<SyncImportResult> {
        if snapshot.schema != 1 {
            anyhow::bail!("unsupported sync schema {}", snapshot.schema);
        }

        let mut result = SyncImportResult::default();
        for snippet in snapshot.snippets {
            match self.get(&snippet.id)? {
                Some(existing) if existing.updated_at >= snippet.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_snippet(&snippet)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_snippet(&snippet)?;
                    result.inserted += 1;
                }
            }
        }
        Ok(result)
    }

    #[allow(dead_code)]
    fn upsert_snapshot_snippet(&self, snippet: &Snippet) -> Result<()> {
        let tags = serde_json::to_string(&snippet.tags)?;
        self.conn.execute(
            r#"
            INSERT INTO snippets (id, title, body, description, category, tags, shortcut, shell, enabled, favorite, pinned, deleted_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                description = excluded.description,
                category = excluded.category,
                tags = excluded.tags,
                shortcut = excluded.shortcut,
                shell = excluded.shell,
                enabled = excluded.enabled,
                favorite = excluded.favorite,
                pinned = excluded.pinned,
                deleted_at = excluded.deleted_at,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            "#,
            params![
                snippet.id,
                snippet.title,
                snippet.body,
                snippet.description,
                snippet.category,
                tags,
                snippet.shortcut,
                snippet.shell,
                snippet.enabled,
                snippet.favorite,
                snippet.pinned,
                snippet.deleted_at,
                snippet.created_at,
                snippet.updated_at,
            ],
        )?;
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS snippets (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                shortcut TEXT NOT NULL DEFAULT '',
                shell TEXT NOT NULL DEFAULT 'any',
                enabled INTEGER NOT NULL DEFAULT 1,
                favorite INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS snippets_updated_idx ON snippets(updated_at);
            CREATE INDEX IF NOT EXISTS snippets_shortcut_idx ON snippets(shortcut);
            "#,
        )?;
        self.add_column_if_missing("snippets", "favorite", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("snippets", "pinned", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("snippets", "deleted_at", "TEXT")?;

        Ok(())
    }

    fn add_column_if_missing(&self, table: &str, column: &str, definition: &str) -> Result<()> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if !columns.iter().any(|name| name == column) {
            self.conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                [],
            )?;
        }
        Ok(())
    }
}

fn fallback_db_path() -> Result<PathBuf> {
    Ok(env::current_dir()?.join(".abratab").join("abratab.db"))
}

fn migrate_legacy_db_path(base: &PathBuf, path: &PathBuf) {
    if path.exists() {
        return;
    }

    let legacy_path = base.join("abratab").join("abratab.db");
    if !legacy_path.exists() {
        return;
    }

    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }

    if fs::rename(&legacy_path, path).is_err() {
        let _ = fs::copy(&legacy_path, path);
    }
}

fn row_to_snippet(row: &rusqlite::Row<'_>) -> rusqlite::Result<Snippet> {
    let tags_json: String = row.get(5)?;
    let tags = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Snippet {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
        tags,
        shortcut: row.get(6)?,
        shell: row.get(7)?,
        enabled: row.get(8)?,
        favorite: row.get(9)?,
        pinned: row.get(10)?,
        deleted_at: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn now_string() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn new_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("snip_{nanos:x}")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[allow(dead_code)]
pub struct SyncSnapshot {
    pub schema: u16,
    pub client: String,
    pub exported_at: String,
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[allow(dead_code)]
pub struct SyncImportResult {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
}
