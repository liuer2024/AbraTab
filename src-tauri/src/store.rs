use crate::models::{Idea, IdeaInput, Snippet, SnippetInput, WeekLog, WeekLogInput};
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::env;
use std::fs;
use std::path::PathBuf;
use time::macros::format_description;
use time::{Date, Duration, OffsetDateTime, Weekday};

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

    pub fn list_week_logs(&self, query: Option<&str>) -> Result<Vec<WeekLog>> {
        let logs = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, created_at, updated_at
                FROM week_logs
                WHERE lower(title) LIKE ?1
                   OR lower(body) LIKE ?1
                   OR lower(tags) LIKE ?1
                   OR lower(week_key) LIKE ?1
                ORDER BY week_key DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![pattern], row_to_week_log)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, created_at, updated_at
                FROM week_logs
                ORDER BY week_key DESC
                "#,
            )?;
            let rows = stmt
                .query_map([], row_to_week_log)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        Ok(logs)
    }

    pub fn get_week_log(&self, id: &str) -> Result<Option<WeekLog>> {
        self.conn
            .query_row(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, created_at, updated_at
                FROM week_logs
                WHERE id = ?1
                "#,
                params![id],
                row_to_week_log,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn save_week_log(&self, input: WeekLogInput) -> Result<WeekLog> {
        let week_key = normalize_week_key(&input.week_key)?;
        let (week_start, week_end) = week_bounds(&week_key)?;
        let now = now_string();

        let existing = self.get_week_log_by_key(&week_key)?;
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .or_else(|| existing.as_ref().map(|log| log.id.clone()))
            .unwrap_or_else(new_week_log_id);
        let created_at = existing
            .as_ref()
            .map(|log| log.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let tags = serde_json::to_string(&input.tags.unwrap_or_default())?;

        self.conn.execute(
            r#"
            INSERT INTO week_logs (id, week_key, week_start, week_end, title, body, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(week_key) DO UPDATE SET
                week_start = excluded.week_start,
                week_end = excluded.week_end,
                title = excluded.title,
                body = excluded.body,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                week_key,
                week_start,
                week_end,
                input.title.unwrap_or_default(),
                input.body,
                tags,
                created_at,
                now,
            ],
        )?;

        self.get_week_log_by_key(&week_key)?
            .context("week log was not saved")
    }

    #[allow(dead_code)]
    pub fn delete_week_log(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM week_logs WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    fn get_week_log_by_key(&self, week_key: &str) -> Result<Option<WeekLog>> {
        self.conn
            .query_row(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, created_at, updated_at
                FROM week_logs
                WHERE week_key = ?1
                "#,
                params![week_key],
                row_to_week_log,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_ideas(&self, query: Option<&str>) -> Result<Vec<Idea>> {
        let ideas = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, title, body, pinned, created_at, updated_at
                FROM ideas
                WHERE lower(title) LIKE ?1 OR lower(body) LIKE ?1
                ORDER BY pinned DESC, updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![pattern], row_to_idea)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, title, body, pinned, created_at, updated_at
                FROM ideas
                ORDER BY pinned DESC, updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map([], row_to_idea)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        Ok(ideas)
    }

    pub fn get_idea(&self, id: &str) -> Result<Option<Idea>> {
        self.conn
            .query_row(
                r#"
                SELECT id, title, body, pinned, created_at, updated_at
                FROM ideas
                WHERE id = ?1
                "#,
                params![id],
                row_to_idea,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn save_idea(&self, input: IdeaInput) -> Result<Idea> {
        let now = now_string();
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_idea_id);
        let existing = self.get_idea(&id)?;
        let created_at = existing
            .as_ref()
            .map(|idea| idea.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let pinned = existing.as_ref().map(|idea| idea.pinned).unwrap_or(false);

        self.conn.execute(
            r#"
            INSERT INTO ideas (id, title, body, pinned, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                updated_at = excluded.updated_at
            "#,
            params![id, input.title.unwrap_or_default(), input.body, pinned, created_at, now],
        )?;

        self.get_idea(&id)?.context("idea was not saved")
    }

    #[allow(dead_code)]
    pub fn set_idea_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE ideas SET pinned = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, pinned, now],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_idea(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM ideas WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_idea(&self, idea: &Idea) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO ideas (id, title, body, pinned, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                pinned = excluded.pinned,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            "#,
            params![
                idea.id,
                idea.title,
                idea.body,
                idea.pinned,
                idea.created_at,
                idea.updated_at,
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn export_snapshot(&self) -> Result<SyncSnapshot> {
        Ok(SyncSnapshot {
            schema: 3,
            client: "AbraTab".to_string(),
            exported_at: now_string(),
            snippets: self.list(None, true)?,
            week_logs: self.list_week_logs(None)?,
            ideas: self.list_ideas(None)?,
        })
    }

    #[allow(dead_code)]
    pub fn import_snapshot(&self, snapshot: SyncSnapshot) -> Result<SyncImportResult> {
        if snapshot.schema == 0 || snapshot.schema > 3 {
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
        for log in snapshot.week_logs {
            match self.get_week_log(&log.id)? {
                Some(existing) if existing.updated_at >= log.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_week_log(&log)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_week_log(&log)?;
                    result.inserted += 1;
                }
            }
        }
        for idea in snapshot.ideas {
            match self.get_idea(&idea.id)? {
                Some(existing) if existing.updated_at >= idea.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_idea(&idea)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_idea(&idea)?;
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

    #[allow(dead_code)]
    fn upsert_snapshot_week_log(&self, log: &WeekLog) -> Result<()> {
        let tags = serde_json::to_string(&log.tags)?;
        // Keep week_key unique: drop any local row that owns this week under a different id.
        self.conn.execute(
            "DELETE FROM week_logs WHERE week_key = ?1 AND id != ?2",
            params![log.week_key, log.id],
        )?;
        self.conn.execute(
            r#"
            INSERT INTO week_logs (id, week_key, week_start, week_end, title, body, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                week_key = excluded.week_key,
                week_start = excluded.week_start,
                week_end = excluded.week_end,
                title = excluded.title,
                body = excluded.body,
                tags = excluded.tags,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            "#,
            params![
                log.id,
                log.week_key,
                log.week_start,
                log.week_end,
                log.title,
                log.body,
                tags,
                log.created_at,
                log.updated_at,
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

            CREATE TABLE IF NOT EXISTS week_logs (
                id TEXT PRIMARY KEY NOT NULL,
                week_key TEXT NOT NULL UNIQUE,
                week_start TEXT NOT NULL DEFAULT '',
                week_end TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS week_logs_week_idx ON week_logs(week_key);

            CREATE TABLE IF NOT EXISTS ideas (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ideas_updated_idx ON ideas(updated_at);
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

#[allow(dead_code)]
fn new_week_log_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("wlog_{nanos:x}")
}

#[allow(dead_code)]
fn new_idea_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("idea_{nanos:x}")
}

fn row_to_idea(row: &rusqlite::Row<'_>) -> rusqlite::Result<Idea> {
    Ok(Idea {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        pinned: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn row_to_week_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<WeekLog> {
    let tags_json: String = row.get(6)?;
    let tags = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(WeekLog {
        id: row.get(0)?,
        week_key: row.get(1)?,
        week_start: row.get(2)?,
        week_end: row.get(3)?,
        title: row.get(4)?,
        body: row.get(5)?,
        tags,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// ISO-week fields for the current (UTC) week: ("2026-W26", "2026-06-22", "2026-06-28").
#[allow(dead_code)]
pub fn current_week_fields() -> Result<(String, String, String)> {
    let today = OffsetDateTime::now_utc().date();
    let (year, week, _) = today.to_iso_week_date();
    let week_key = format!("{year}-W{week:02}");
    let (start, end) = week_bounds(&week_key)?;
    Ok((week_key, start, end))
}

/// Monday/Sunday bounds for a "YYYY-Www" key, formatted as YYYY-MM-DD.
#[allow(dead_code)]
fn week_bounds(week_key: &str) -> Result<(String, String)> {
    let (year, week) = parse_week_key(week_key)?;
    let monday = Date::from_iso_week_date(year, week, Weekday::Monday)
        .with_context(|| format!("invalid ISO week {week_key}"))?;
    let sunday = monday + Duration::days(6);
    let format = format_description!("[year]-[month]-[day]");
    Ok((monday.format(&format)?, sunday.format(&format)?))
}

#[allow(dead_code)]
fn normalize_week_key(week_key: &str) -> Result<String> {
    let (year, week) = parse_week_key(week_key)?;
    Ok(format!("{year}-W{week:02}"))
}

#[allow(dead_code)]
fn parse_week_key(week_key: &str) -> Result<(i32, u8)> {
    let (year, week) = week_key
        .trim()
        .split_once("-W")
        .with_context(|| format!("invalid week key {week_key}"))?;
    let year: i32 = year
        .parse()
        .with_context(|| format!("invalid week year in {week_key}"))?;
    let week: u8 = week
        .parse()
        .with_context(|| format!("invalid week number in {week_key}"))?;
    if !(1..=53).contains(&week) {
        anyhow::bail!("week number out of range in {week_key}");
    }
    Ok((year, week))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[allow(dead_code)]
pub struct SyncSnapshot {
    pub schema: u16,
    pub client: String,
    pub exported_at: String,
    pub snippets: Vec<Snippet>,
    #[serde(default)]
    pub week_logs: Vec<WeekLog>,
    #[serde(default)]
    pub ideas: Vec<Idea>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[allow(dead_code)]
pub struct SyncImportResult {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
}
