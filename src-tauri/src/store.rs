use crate::models::{
    Book, BookExcerpt, BookExcerptInput, BookInput, DayActivity, Habit, HabitCheckin, HabitInput,
    InboxItem, Project, ProjectInput, Snippet, SnippetInput, Track, TrackEntry, TrackEntryInput,
    TrackInput, WeekLog, WeekLogInput,
};
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
                SELECT id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at
                FROM week_logs
                WHERE lower(title) LIKE ?1
                   OR lower(body) LIKE ?1
                ORDER BY created_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![pattern], row_to_week_log)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at
                FROM week_logs
                ORDER BY created_at DESC
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
                SELECT id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at
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
        let now = now_string();
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_week_log_id);
        let existing = self.get_week_log(&id)?;
        let created_at = existing
            .as_ref()
            .map(|log| log.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let tags = serde_json::to_string(&input.tags.unwrap_or_default())?;

        self.conn.execute(
            r#"
            INSERT INTO week_logs (id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at)
            VALUES (?1, ?2, '', '', ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                body = excluded.body,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                input.week_key,
                input.title.unwrap_or_default(),
                input.body,
                tags,
                input.favorite.unwrap_or(false),
                created_at,
                now,
            ],
        )?;

        self.get_week_log(&id)?.context("week log was not saved")
    }

    #[allow(dead_code)]
    pub fn set_week_log_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        let now = now_string();
        self.conn.execute(
            "UPDATE week_logs SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, favorite, now],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_week_log(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM week_logs WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn list_projects(&self, query: Option<&str>) -> Result<Vec<Project>> {
        let projects = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, name, path, git_url, description, tags, created_at, updated_at
                FROM projects
                WHERE lower(name) LIKE ?1
                   OR lower(path) LIKE ?1
                   OR lower(git_url) LIKE ?1
                   OR lower(description) LIKE ?1
                   OR lower(tags) LIKE ?1
                ORDER BY updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map(params![pattern], row_to_project)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT id, name, path, git_url, description, tags, created_at, updated_at
                FROM projects
                ORDER BY updated_at DESC
                "#,
            )?;
            let rows = stmt
                .query_map([], row_to_project)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        Ok(projects)
    }

    #[allow(dead_code)]
    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        self.conn
            .query_row(
                r#"
                SELECT id, name, path, git_url, description, tags, created_at, updated_at
                FROM projects
                WHERE id = ?1
                "#,
                params![id],
                row_to_project,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn save_project(&self, input: ProjectInput) -> Result<Project> {
        let now = now_string();
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_project_id);
        let existing = self.get_project(&id)?;
        let created_at = existing
            .as_ref()
            .map(|project| project.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let tags = serde_json::to_string(&input.tags.unwrap_or_default())?;

        self.conn.execute(
            r#"
            INSERT INTO projects (id, name, path, git_url, description, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                path = excluded.path,
                git_url = excluded.git_url,
                description = excluded.description,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                input.name,
                input.path.unwrap_or_default(),
                input.git_url.unwrap_or_default(),
                input.description.unwrap_or_default(),
                tags,
                created_at,
                now,
            ],
        )?;

        self.get_project(&id)?.context("project was not saved")
    }

    #[allow(dead_code)]
    pub fn delete_project(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn add_inbox_item(
        &self,
        source: &str,
        title: &str,
        body: &str,
        format: &str,
    ) -> Result<InboxItem> {
        let now = now_string();
        let id = new_inbox_id();
        let source = if source.trim().is_empty() { "unknown" } else { source.trim() };
        let format = if format.trim().is_empty() { "markdown" } else { format.trim() };
        self.conn.execute(
            r#"
            INSERT INTO inbox_items (id, source, title, body, format, read, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
            "#,
            params![id, source, title.trim(), body, format, now],
        )?;
        self.get_inbox_item(&id)?.context("inbox item was not saved")
    }

    #[allow(dead_code)]
    pub fn get_inbox_item(&self, id: &str) -> Result<Option<InboxItem>> {
        self.conn
            .query_row(
                r#"
                SELECT id, source, title, body, format, read, created_at, archived_at
                FROM inbox_items
                WHERE id = ?1
                "#,
                params![id],
                row_to_inbox_item,
            )
            .optional()
            .map_err(Into::into)
    }

    /// List inbox items, optionally filtered by archived state.
    /// `archived`: `Some(false)` → active only, `Some(true)` → archived only, `None` → all.
    #[allow(dead_code)]
    pub fn list_inbox_items(
        &self,
        query: Option<&str>,
        archived: Option<bool>,
    ) -> Result<Vec<InboxItem>> {
        let select = "SELECT id, source, title, body, format, read, created_at, archived_at FROM inbox_items";
        let archived_clause = match archived {
            Some(true) => "archived_at IS NOT NULL",
            Some(false) => "archived_at IS NULL",
            None => "1 = 1",
        };
        let items = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(&format!(
                "{select}
                WHERE {archived_clause}
                  AND (lower(title) LIKE ?1 OR lower(body) LIKE ?1 OR lower(source) LIKE ?1)
                ORDER BY created_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![pattern], row_to_inbox_item)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(&format!(
                "{select} WHERE {archived_clause} ORDER BY created_at DESC"
            ))?;
            let rows = stmt
                .query_map([], row_to_inbox_item)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        Ok(items)
    }

    #[allow(dead_code)]
    pub fn set_inbox_archived(&self, id: &str, archived: bool) -> Result<()> {
        let archived_at = if archived { Some(now_string()) } else { None };
        self.conn.execute(
            "UPDATE inbox_items SET archived_at = ?2 WHERE id = ?1",
            params![id, archived_at],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_inbox_read(&self, id: &str, read: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE inbox_items SET read = ?2 WHERE id = ?1",
            params![id, read],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn update_inbox_item(&self, id: &str, title: &str, body: &str, format: &str) -> Result<()> {
        let format = if format.trim().is_empty() { "markdown" } else { format.trim() };
        self.conn.execute(
            "UPDATE inbox_items SET title = ?2, body = ?3, format = ?4 WHERE id = ?1",
            params![id, title.trim(), body, format],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_inbox_item(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM inbox_items WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- Books ----

    #[allow(dead_code)]
    pub fn list_books(&self, query: Option<&str>, author: Option<&str>) -> Result<Vec<Book>> {
        let select = r#"
            SELECT b.id, b.title, b.author, b.cover_url, b.intro, b.status, b.rating,
                   b.start_date, b.end_date, b.thoughts, b.created_at, b.updated_at,
                   (SELECT COUNT(*) FROM book_excerpts e WHERE e.book_id = b.id) AS excerpt_count
            FROM books b
        "#;
        let mut books = if let Some(q) = query.filter(|v| !v.trim().is_empty()) {
            let pattern = format!("%{}%", q.trim().to_lowercase());
            let mut stmt = self.conn.prepare(&format!(
                "{select}
                WHERE lower(b.title) LIKE ?1 OR lower(b.author) LIKE ?1 OR lower(b.intro) LIKE ?1
                ORDER BY b.updated_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![pattern], row_to_book)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self
                .conn
                .prepare(&format!("{select} ORDER BY b.updated_at DESC"))?;
            let rows = stmt
                .query_map([], row_to_book)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        if let Some(author) = author.filter(|v| !v.trim().is_empty()) {
            let author = author.trim();
            books.retain(|b| b.author == author);
        }
        Ok(books)
    }

    #[allow(dead_code)]
    pub fn get_book(&self, id: &str) -> Result<Option<Book>> {
        self.conn
            .query_row(
                r#"
                SELECT b.id, b.title, b.author, b.cover_url, b.intro, b.status, b.rating,
                       b.start_date, b.end_date, b.thoughts, b.created_at, b.updated_at,
                       (SELECT COUNT(*) FROM book_excerpts e WHERE e.book_id = b.id) AS excerpt_count
                FROM books b
                WHERE b.id = ?1
                "#,
                params![id],
                row_to_book,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn list_book_authors(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT author FROM books WHERE trim(author) <> '' ORDER BY author")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    pub fn save_book(&self, input: BookInput) -> Result<Book> {
        let now = now_string();
        let id = input
            .id
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(new_book_id);
        let existing = self.get_book(&id)?;
        let created_at = existing
            .as_ref()
            .map(|b| b.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let status = input
            .status
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "want".to_string());
        self.conn.execute(
            r#"
            INSERT INTO books (id, title, author, cover_url, intro, status, rating,
                start_date, end_date, thoughts, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                cover_url = excluded.cover_url,
                intro = excluded.intro,
                status = excluded.status,
                rating = excluded.rating,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                thoughts = excluded.thoughts,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                input.title.unwrap_or_default(),
                input.author.unwrap_or_default(),
                input.cover_url.unwrap_or_default(),
                input.intro.unwrap_or_default(),
                status,
                input.rating.unwrap_or(0),
                input.start_date.unwrap_or_default(),
                input.end_date.unwrap_or_default(),
                input.thoughts.unwrap_or_default(),
                created_at,
                now,
            ],
        )?;
        self.get_book(&id)?.context("book was not saved")
    }

    #[allow(dead_code)]
    pub fn delete_book(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM book_excerpts WHERE book_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM books WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn list_book_excerpts(&self, book_id: &str) -> Result<Vec<BookExcerpt>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_id, text, page, created_at FROM book_excerpts WHERE book_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![book_id], row_to_book_excerpt)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    fn list_all_book_excerpts(&self) -> Result<Vec<BookExcerpt>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, book_id, text, page, created_at FROM book_excerpts ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_book_excerpt)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    pub fn add_book_excerpt(&self, input: BookExcerptInput) -> Result<BookExcerpt> {
        let now = now_string();
        let id = new_book_excerpt_id();
        self.conn.execute(
            "INSERT INTO book_excerpts (id, book_id, text, page, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, input.book_id, input.text, input.page, now],
        )?;
        self.conn.execute(
            "UPDATE books SET updated_at = ?2 WHERE id = ?1",
            params![input.book_id, now],
        )?;
        self.get_book_excerpt(&id)?.context("book excerpt was not saved")
    }

    #[allow(dead_code)]
    pub fn update_book_excerpt(&self, id: &str, text: &str, page: &str) -> Result<BookExcerpt> {
        self.conn.execute(
            "UPDATE book_excerpts SET text = ?2, page = ?3 WHERE id = ?1",
            params![id, text, page],
        )?;
        self.get_book_excerpt(id)?.context("book excerpt not found")
    }

    #[allow(dead_code)]
    pub fn delete_book_excerpt(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM book_excerpts WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    fn get_book_excerpt(&self, id: &str) -> Result<Option<BookExcerpt>> {
        self.conn
            .query_row(
                "SELECT id, book_id, text, page, created_at FROM book_excerpts WHERE id = ?1",
                params![id],
                row_to_book_excerpt,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    fn upsert_snapshot_book(&self, book: &Book) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO books (id, title, author, cover_url, intro, status, rating,
                start_date, end_date, thoughts, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                cover_url = excluded.cover_url,
                intro = excluded.intro,
                status = excluded.status,
                rating = excluded.rating,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                thoughts = excluded.thoughts,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            "#,
            params![
                book.id,
                book.title,
                book.author,
                book.cover_url,
                book.intro,
                book.status,
                book.rating,
                book.start_date,
                book.end_date,
                book.thoughts,
                book.created_at,
                book.updated_at
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_book_excerpt(&self, excerpt: &BookExcerpt) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO book_excerpts (id, book_id, text, page, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                book_id = excluded.book_id,
                text = excluded.text,
                page = excluded.page,
                created_at = excluded.created_at
            "#,
            params![
                excerpt.id,
                excerpt.book_id,
                excerpt.text,
                excerpt.page,
                excerpt.created_at
            ],
        )?;
        Ok(())
    }

    /// Per-day record counts (weeklogs + idea entries + inbox + projects) within
    /// an inclusive YYYY-MM-DD range, for the activity heatmap.
    #[allow(dead_code)]
    pub fn activity_by_day(&self, start: &str, end: &str) -> Result<Vec<DayActivity>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT day, COUNT(*) AS n FROM (
                SELECT substr(created_at, 1, 10) AS day FROM week_logs
                UNION ALL SELECT substr(created_at, 1, 10) FROM track_entries
                UNION ALL SELECT substr(created_at, 1, 10) FROM inbox_items
                UNION ALL SELECT substr(created_at, 1, 10) FROM projects
            )
            WHERE day >= ?1 AND day <= ?2
            GROUP BY day
            "#,
        )?;
        let rows = stmt
            .query_map(params![start, end], |row| {
                Ok(DayActivity {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    fn get_week_log_by_key(&self, week_key: &str) -> Result<Option<WeekLog>> {
        self.conn
            .query_row(
                r#"
                SELECT id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at
                FROM week_logs
                WHERE week_key = ?1
                "#,
                params![week_key],
                row_to_week_log,
            )
            .optional()
            .map_err(Into::into)
    }

    /// List tracks, optionally filtered by archived state.
    /// `archived`: `Some(false)` → active only, `Some(true)` → archived only, `None` → all.
    #[allow(dead_code)]
    pub fn list_tracks(&self, query: Option<&str>, archived: Option<bool>) -> Result<Vec<Track>> {
        let select = r#"
            SELECT t.id, t.title, t.created_at, t.updated_at, t.archived_at,
                (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entry_count,
                (SELECT MAX(created_at) FROM track_entries e WHERE e.track_id = t.id) AS last_entry_at
            FROM tracks t
        "#;
        let archived_clause = match archived {
            Some(true) => "t.archived_at IS NOT NULL",
            Some(false) => "t.archived_at IS NULL",
            None => "1 = 1",
        };
        let tracks = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(&format!(
                "{select}
                WHERE {archived_clause}
                  AND (lower(t.title) LIKE ?1
                       OR EXISTS (SELECT 1 FROM track_entries e WHERE e.track_id = t.id AND lower(e.body) LIKE ?1))
                ORDER BY t.updated_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![pattern], row_to_track)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(&format!(
                "{select} WHERE {archived_clause} ORDER BY t.updated_at DESC"
            ))?;
            let rows = stmt
                .query_map([], row_to_track)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        Ok(tracks)
    }

    #[allow(dead_code)]
    pub fn get_track(&self, id: &str) -> Result<Option<Track>> {
        self.conn
            .query_row(
                r#"
                SELECT t.id, t.title, t.created_at, t.updated_at, t.archived_at,
                    (SELECT COUNT(*) FROM track_entries e WHERE e.track_id = t.id) AS entry_count,
                    (SELECT MAX(created_at) FROM track_entries e WHERE e.track_id = t.id) AS last_entry_at
                FROM tracks t
                WHERE t.id = ?1
                "#,
                params![id],
                row_to_track,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn save_track(&self, input: TrackInput) -> Result<Track> {
        let now = now_string();
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_track_id);
        let existing = self.get_track(&id)?;
        let created_at = existing
            .as_ref()
            .map(|track| track.created_at.clone())
            .unwrap_or_else(|| now.clone());

        self.conn.execute(
            r#"
            INSERT INTO tracks (id, title, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                updated_at = excluded.updated_at
            "#,
            params![id, input.title.unwrap_or_default(), created_at, now],
        )?;

        self.get_track(&id)?.context("track was not saved")
    }

    #[allow(dead_code)]
    pub fn delete_track(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM track_entries WHERE track_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM tracks WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_track_archived(&self, id: &str, archived: bool) -> Result<Track> {
        let archived_at = if archived { Some(now_string()) } else { None };
        self.conn.execute(
            "UPDATE tracks SET archived_at = ?2 WHERE id = ?1",
            params![id, archived_at],
        )?;
        self.get_track(id)?.context("track not found")
    }

    #[allow(dead_code)]
    pub fn list_track_entries(&self, track_id: &str) -> Result<Vec<TrackEntry>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, track_id, body, created_at
            FROM track_entries
            WHERE track_id = ?1
            ORDER BY created_at DESC
            "#,
        )?;
        let rows = stmt
            .query_map(params![track_id], row_to_track_entry)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    pub fn add_track_entry(&self, input: TrackEntryInput) -> Result<TrackEntry> {
        let now = now_string();
        let id = new_entry_id();
        self.conn.execute(
            "INSERT INTO track_entries (id, track_id, body, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, input.track_id, input.body, now],
        )?;
        // Touch the parent track so it sorts to the top of the list.
        self.conn.execute(
            "UPDATE tracks SET updated_at = ?2 WHERE id = ?1",
            params![input.track_id, now],
        )?;
        self.get_track_entry(&id)?.context("track entry was not saved")
    }

    #[allow(dead_code)]
    pub fn update_track_entry(&self, id: &str, body: &str) -> Result<TrackEntry> {
        self.conn.execute(
            "UPDATE track_entries SET body = ?2 WHERE id = ?1",
            params![id, body],
        )?;
        self.get_track_entry(id)?.context("track entry not found")
    }

    #[allow(dead_code)]
    pub fn delete_track_entry(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM track_entries WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    fn get_track_entry(&self, id: &str) -> Result<Option<TrackEntry>> {
        self.conn
            .query_row(
                "SELECT id, track_id, body, created_at FROM track_entries WHERE id = ?1",
                params![id],
                row_to_track_entry,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    fn upsert_snapshot_track(&self, track: &Track) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO tracks (id, title, created_at, updated_at, archived_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                archived_at = excluded.archived_at
            "#,
            params![
                track.id,
                track.title,
                track.created_at,
                track.updated_at,
                track.archived_at
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_track_entry(&self, entry: &TrackEntry) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO track_entries (id, track_id, body, created_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                track_id = excluded.track_id,
                body = excluded.body,
                created_at = excluded.created_at
            "#,
            params![entry.id, entry.track_id, entry.body, entry.created_at],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_project(&self, project: &Project) -> Result<()> {
        let tags = serde_json::to_string(&project.tags)?;
        self.conn.execute(
            r#"
            INSERT INTO projects (id, name, path, git_url, description, tags, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                path = excluded.path,
                git_url = excluded.git_url,
                description = excluded.description,
                tags = excluded.tags,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            "#,
            params![
                project.id,
                project.name,
                project.path,
                project.git_url,
                project.description,
                tags,
                project.created_at,
                project.updated_at,
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_inbox_item(&self, item: &InboxItem) -> Result<()> {
        let format = if item.format.trim().is_empty() { "markdown" } else { item.format.trim() };
        self.conn.execute(
            r#"
            INSERT INTO inbox_items (id, source, title, body, format, read, created_at, archived_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                source = excluded.source,
                title = excluded.title,
                body = excluded.body,
                format = excluded.format,
                read = excluded.read,
                created_at = excluded.created_at,
                archived_at = excluded.archived_at
            "#,
            params![
                item.id,
                item.source,
                item.title,
                item.body,
                format,
                item.read,
                item.created_at,
                item.archived_at
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    // ----- Habits (习惯打卡) -----

    const HABIT_COLS: &'static str = r#"
        h.id, h.name, h.emoji, h.color, h.kind, h.target, h.unit, h.schedule,
        h.sort_order, h.created_at, h.updated_at, h.archived_at,
        COALESCE((SELECT c.count FROM habit_checkins c WHERE c.habit_id = h.id AND c.day = ?1), 0) AS today_count,
        (SELECT COUNT(*) FROM habit_checkins c WHERE c.habit_id = h.id AND c.count >= MAX(h.target, 1)) AS total_checkins
    "#;

    /// List habits with today's progress, total completed days and current
    /// streak. `today` is the user's local 'YYYY-MM-DD' (supplied by the UI).
    /// `archived`: `Some(false)` active, `Some(true)` archived, `None` all.
    #[allow(dead_code)]
    pub fn list_habits(
        &self,
        query: Option<&str>,
        archived: Option<bool>,
        today: &str,
    ) -> Result<Vec<Habit>> {
        let cols = Self::HABIT_COLS;
        let archived_clause = match archived {
            Some(true) => "h.archived_at IS NOT NULL",
            Some(false) => "h.archived_at IS NULL",
            None => "1 = 1",
        };
        let mut habits = if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
            let pattern = format!("%{}%", query.trim().to_lowercase());
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {cols} FROM habits h
                 WHERE {archived_clause} AND lower(h.name) LIKE ?2
                 ORDER BY h.sort_order ASC, h.created_at ASC"
            ))?;
            let rows = stmt
                .query_map(params![today, pattern], row_to_habit)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {cols} FROM habits h
                 WHERE {archived_clause}
                 ORDER BY h.sort_order ASC, h.created_at ASC"
            ))?;
            let rows = stmt
                .query_map(params![today], row_to_habit)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for habit in &mut habits {
            self.fill_habit_stats(habit, today)?;
        }
        Ok(habits)
    }

    #[allow(dead_code)]
    pub fn get_habit(&self, id: &str, today: &str) -> Result<Option<Habit>> {
        let cols = Self::HABIT_COLS;
        let habit = self
            .conn
            .query_row(
                &format!("SELECT {cols} FROM habits h WHERE h.id = ?2"),
                params![today, id],
                row_to_habit,
            )
            .optional()?;
        match habit {
            Some(mut habit) => {
                self.fill_habit_stats(&mut habit, today)?;
                Ok(Some(habit))
            }
            None => Ok(None),
        }
    }

    /// Fill the derived `done_today` / `current_streak` fields.
    fn fill_habit_stats(&self, habit: &mut Habit, today: &str) -> Result<()> {
        let target_eff = habit.target.max(1);
        habit.done_today = habit.today_count >= target_eff;
        let days = self.habit_completed_days(&habit.id, target_eff)?;
        habit.current_streak = compute_current_streak(&days, today);
        Ok(())
    }

    /// Set of days (YYYY-MM-DD) on which the habit reached its target.
    fn habit_completed_days(
        &self,
        habit_id: &str,
        target_eff: i64,
    ) -> Result<std::collections::HashSet<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT day FROM habit_checkins WHERE habit_id = ?1 AND count >= ?2")?;
        let days = stmt
            .query_map(params![habit_id, target_eff], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<std::collections::HashSet<String>>>()?;
        Ok(days)
    }

    fn next_habit_sort_order(&self) -> Result<i64> {
        let next: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM habits",
            [],
            |row| row.get(0),
        )?;
        Ok(next)
    }

    #[allow(dead_code)]
    pub fn save_habit(&self, input: HabitInput, today: &str) -> Result<Habit> {
        let now = now_string();
        let id = input
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(new_habit_id);
        let existing = self.get_habit(&id, today)?;
        let created_at = existing
            .as_ref()
            .map(|habit| habit.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let sort_order = match input.sort_order {
            Some(value) => value,
            None => existing
                .as_ref()
                .map(|habit| habit.sort_order)
                .map(Ok)
                .unwrap_or_else(|| self.next_habit_sort_order())?,
        };

        self.conn.execute(
            r#"
            INSERT INTO habits
                (id, name, emoji, color, kind, target, unit, schedule, sort_order, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                emoji = excluded.emoji,
                color = excluded.color,
                kind = excluded.kind,
                target = excluded.target,
                unit = excluded.unit,
                schedule = excluded.schedule,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at
            "#,
            params![
                id,
                input.name.unwrap_or_default(),
                input.emoji.unwrap_or_default(),
                input.color.unwrap_or_default(),
                input.kind.unwrap_or_else(|| "check".to_string()),
                input.target.unwrap_or(1),
                input.unit.unwrap_or_default(),
                input.schedule.unwrap_or_else(|| "daily".to_string()),
                sort_order,
                created_at,
                now,
            ],
        )?;

        self.get_habit(&id, today)?.context("habit was not saved")
    }

    #[allow(dead_code)]
    pub fn delete_habit(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM habit_checkins WHERE habit_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM habits WHERE id = ?1", params![id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_habit_archived(&self, id: &str, archived: bool, today: &str) -> Result<Habit> {
        let archived_at = if archived { Some(now_string()) } else { None };
        self.conn.execute(
            "UPDATE habits SET archived_at = ?2 WHERE id = ?1",
            params![id, archived_at],
        )?;
        self.get_habit(id, today)?.context("habit not found")
    }

    /// Record (or clear) a day's check-in. `count <= 0` removes the row, so the
    /// same command toggles a check-type habit off and sets a count-type value.
    #[allow(dead_code)]
    pub fn set_checkin(
        &self,
        habit_id: &str,
        day: &str,
        count: i64,
        note: &str,
    ) -> Result<Option<HabitCheckin>> {
        if count <= 0 {
            self.conn.execute(
                "DELETE FROM habit_checkins WHERE habit_id = ?1 AND day = ?2",
                params![habit_id, day],
            )?;
            self.touch_habit(habit_id)?;
            return Ok(None);
        }
        let now = now_string();
        self.conn.execute(
            r#"
            INSERT INTO habit_checkins (id, habit_id, day, count, note, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(habit_id, day) DO UPDATE SET
                count = excluded.count,
                note = excluded.note
            "#,
            params![new_checkin_id(), habit_id, day, count, note, now],
        )?;
        self.touch_habit(habit_id)?;
        self.get_checkin(habit_id, day)
    }

    fn touch_habit(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE habits SET updated_at = ?2 WHERE id = ?1",
            params![id, now_string()],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn get_checkin(&self, habit_id: &str, day: &str) -> Result<Option<HabitCheckin>> {
        self.conn
            .query_row(
                "SELECT id, habit_id, day, count, note, created_at FROM habit_checkins WHERE habit_id = ?1 AND day = ?2",
                params![habit_id, day],
                row_to_habit_checkin,
            )
            .optional()
            .map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn list_habit_checkins(
        &self,
        habit_id: &str,
        start: Option<&str>,
        end: Option<&str>,
    ) -> Result<Vec<HabitCheckin>> {
        let mut sql = String::from(
            "SELECT id, habit_id, day, count, note, created_at FROM habit_checkins WHERE habit_id = ?1",
        );
        if start.is_some() {
            sql.push_str(" AND day >= ?2");
        }
        if end.is_some() {
            sql.push_str(" AND day <= ?3");
        }
        sql.push_str(" ORDER BY day DESC");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = match (start, end) {
            (Some(s), Some(e)) => stmt
                .query_map(params![habit_id, s, e], row_to_habit_checkin)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            (Some(s), None) => stmt
                .query_map(params![habit_id, s], row_to_habit_checkin)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            (None, None) => stmt
                .query_map(params![habit_id], row_to_habit_checkin)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            (None, Some(e)) => {
                // No start but an end → bind end as ?2 against the rebuilt SQL.
                let mut stmt = self.conn.prepare(
                    "SELECT id, habit_id, day, count, note, created_at FROM habit_checkins
                     WHERE habit_id = ?1 AND day <= ?2 ORDER BY day DESC",
                )?;
                let rows = stmt
                    .query_map(params![habit_id, e], row_to_habit_checkin)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            }
        };
        Ok(rows)
    }

    /// Raw habits for the sync snapshot (no per-day aggregates needed).
    #[allow(dead_code)]
    fn list_all_habits(&self) -> Result<Vec<Habit>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, emoji, color, kind, target, unit, schedule, sort_order,
                    created_at, updated_at, archived_at, 0, 0
             FROM habits ORDER BY sort_order ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_habit)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    fn list_all_habit_checkins(&self) -> Result<Vec<HabitCheckin>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, habit_id, day, count, note, created_at FROM habit_checkins ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_habit_checkin)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    #[allow(dead_code)]
    fn upsert_snapshot_habit(&self, habit: &Habit) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO habits
                (id, name, emoji, color, kind, target, unit, schedule, sort_order, created_at, updated_at, archived_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                emoji = excluded.emoji,
                color = excluded.color,
                kind = excluded.kind,
                target = excluded.target,
                unit = excluded.unit,
                schedule = excluded.schedule,
                sort_order = excluded.sort_order,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                archived_at = excluded.archived_at
            "#,
            params![
                habit.id,
                habit.name,
                habit.emoji,
                habit.color,
                habit.kind,
                habit.target,
                habit.unit,
                habit.schedule,
                habit.sort_order,
                habit.created_at,
                habit.updated_at,
                habit.archived_at,
            ],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn upsert_snapshot_checkin(&self, checkin: &HabitCheckin) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO habit_checkins (id, habit_id, day, count, note, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                habit_id = excluded.habit_id,
                day = excluded.day,
                count = excluded.count,
                note = excluded.note,
                created_at = excluded.created_at
            "#,
            params![
                checkin.id,
                checkin.habit_id,
                checkin.day,
                checkin.count,
                checkin.note,
                checkin.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn export_snapshot(&self) -> Result<SyncSnapshot> {
        Ok(SyncSnapshot {
            schema: 7,
            client: "AbraTab".to_string(),
            exported_at: now_string(),
            snippets: self.list(None, true)?,
            week_logs: self.list_week_logs(None)?,
            tracks: self.list_tracks(None, None)?,
            track_entries: self.list_all_track_entries()?,
            projects: self.list_projects(None)?,
            inbox_items: self.list_inbox_items(None, None)?,
            books: self.list_books(None, None)?,
            book_excerpts: self.list_all_book_excerpts()?,
            habits: self.list_all_habits()?,
            habit_checkins: self.list_all_habit_checkins()?,
        })
    }

    #[allow(dead_code)]
    pub fn import_snapshot(&self, snapshot: SyncSnapshot) -> Result<SyncImportResult> {
        if snapshot.schema == 0 || snapshot.schema > 7 {
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
        for track in snapshot.tracks {
            match self.get_track(&track.id)? {
                Some(existing) if existing.updated_at >= track.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_track(&track)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_track(&track)?;
                    result.inserted += 1;
                }
            }
        }
        for entry in snapshot.track_entries {
            // Entries are append-only, so an existing id means it's already here.
            if self.get_track_entry(&entry.id)?.is_some() {
                result.skipped += 1;
            } else {
                self.upsert_snapshot_track_entry(&entry)?;
                result.inserted += 1;
            }
        }
        for project in snapshot.projects {
            match self.get_project(&project.id)? {
                Some(existing) if existing.updated_at >= project.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_project(&project)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_project(&project)?;
                    result.inserted += 1;
                }
            }
        }
        for item in snapshot.inbox_items {
            // Inbox records are append-only, so an existing id is already here.
            if self.get_inbox_item(&item.id)?.is_some() {
                result.skipped += 1;
            } else {
                self.upsert_snapshot_inbox_item(&item)?;
                result.inserted += 1;
            }
        }
        for book in snapshot.books {
            match self.get_book(&book.id)? {
                Some(existing) if existing.updated_at >= book.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_book(&book)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_book(&book)?;
                    result.inserted += 1;
                }
            }
        }
        for excerpt in snapshot.book_excerpts {
            if self.get_book_excerpt(&excerpt.id)?.is_some() {
                result.skipped += 1;
            } else {
                self.upsert_snapshot_book_excerpt(&excerpt)?;
                result.inserted += 1;
            }
        }
        for habit in snapshot.habits {
            match self.get_habit(&habit.id, "")? {
                Some(existing) if existing.updated_at >= habit.updated_at => {
                    result.skipped += 1;
                }
                Some(_) => {
                    self.upsert_snapshot_habit(&habit)?;
                    result.updated += 1;
                }
                None => {
                    self.upsert_snapshot_habit(&habit)?;
                    result.inserted += 1;
                }
            }
        }
        for checkin in snapshot.habit_checkins {
            // Keyed by (habit_id, day): if that day already has a check-in it's
            // the same record, so keep ours and skip rather than hit the UNIQUE.
            if self.get_checkin(&checkin.habit_id, &checkin.day)?.is_some() {
                result.skipped += 1;
            } else {
                self.upsert_snapshot_checkin(&checkin)?;
                result.inserted += 1;
            }
        }
        Ok(result)
    }

    #[allow(dead_code)]
    fn list_all_track_entries(&self) -> Result<Vec<TrackEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, track_id, body, created_at FROM track_entries ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], row_to_track_entry)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
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
        self.conn.execute(
            r#"
            INSERT INTO week_logs (id, week_key, week_start, week_end, title, body, tags, favorite, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                week_key = excluded.week_key,
                week_start = excluded.week_start,
                week_end = excluded.week_end,
                title = excluded.title,
                body = excluded.body,
                tags = excluded.tags,
                favorite = excluded.favorite,
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
                log.favorite,
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
                week_key TEXT NOT NULL DEFAULT '',
                week_start TEXT NOT NULL DEFAULT '',
                week_end TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS week_logs_week_idx ON week_logs(week_key);

            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_entries (
                id TEXT PRIMARY KEY NOT NULL,
                track_id TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS tracks_updated_idx ON tracks(updated_at);
            CREATE INDEX IF NOT EXISTS track_entries_track_idx ON track_entries(track_id);

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                path TEXT NOT NULL DEFAULT '',
                git_url TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS projects_updated_idx ON projects(updated_at);

            CREATE TABLE IF NOT EXISTS inbox_items (
                id TEXT PRIMARY KEY NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS inbox_created_idx ON inbox_items(created_at);

            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                author TEXT NOT NULL DEFAULT '',
                cover_url TEXT NOT NULL DEFAULT '',
                intro TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'want',
                rating INTEGER NOT NULL DEFAULT 0,
                start_date TEXT NOT NULL DEFAULT '',
                end_date TEXT NOT NULL DEFAULT '',
                thoughts TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS book_excerpts (
                id TEXT PRIMARY KEY NOT NULL,
                book_id TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                page TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS books_updated_idx ON books(updated_at);
            CREATE INDEX IF NOT EXISTS book_excerpts_book_idx ON book_excerpts(book_id);

            CREATE TABLE IF NOT EXISTS habits (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                emoji TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'check',
                target INTEGER NOT NULL DEFAULT 1,
                unit TEXT NOT NULL DEFAULT '',
                schedule TEXT NOT NULL DEFAULT 'daily',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived_at TEXT
            );

            CREATE TABLE IF NOT EXISTS habit_checkins (
                id TEXT PRIMARY KEY NOT NULL,
                habit_id TEXT NOT NULL,
                day TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 1,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(habit_id, day)
            );

            CREATE INDEX IF NOT EXISTS habits_sort_idx ON habits(sort_order);
            CREATE INDEX IF NOT EXISTS habit_checkins_habit_idx ON habit_checkins(habit_id);
            CREATE INDEX IF NOT EXISTS habit_checkins_day_idx ON habit_checkins(day);
            "#,
        )?;
        self.add_column_if_missing("snippets", "favorite", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("snippets", "pinned", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("snippets", "deleted_at", "TEXT")?;
        self.drop_week_logs_unique()?;
        // After any week_logs rebuild above, ensure the favorite column exists.
        self.add_column_if_missing("week_logs", "favorite", "INTEGER NOT NULL DEFAULT 0")?;
        self.add_column_if_missing("projects", "tags", "TEXT NOT NULL DEFAULT '[]'")?;
        self.add_column_if_missing("inbox_items", "format", "TEXT NOT NULL DEFAULT 'markdown'")?;
        self.add_column_if_missing("tracks", "archived_at", "TEXT")?;
        self.add_column_if_missing("inbox_items", "archived_at", "TEXT")?;

        Ok(())
    }

    /// Older databases created `week_logs.week_key` as UNIQUE (one note per week).
    /// Notes are now independent, so rebuild the table without that constraint.
    fn drop_week_logs_unique(&self) -> Result<()> {
        let definition: Option<String> = self
            .conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'week_logs'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let needs_rebuild = definition
            .map(|sql| sql.to_uppercase().contains("UNIQUE"))
            .unwrap_or(false);
        if !needs_rebuild {
            return Ok(());
        }
        self.conn.execute_batch(
            r#"
            BEGIN;
            ALTER TABLE week_logs RENAME TO week_logs_old;
            CREATE TABLE week_logs (
                id TEXT PRIMARY KEY NOT NULL,
                week_key TEXT NOT NULL DEFAULT '',
                week_start TEXT NOT NULL DEFAULT '',
                week_end TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO week_logs (id, week_key, week_start, week_end, title, body, tags, created_at, updated_at)
                SELECT id, week_key, week_start, week_end, title, body, tags, created_at, updated_at
                FROM week_logs_old;
            DROP TABLE week_logs_old;
            CREATE INDEX IF NOT EXISTS week_logs_week_idx ON week_logs(week_key);
            COMMIT;
            "#,
        )?;
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
fn new_track_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("trk_{nanos:x}")
}

#[allow(dead_code)]
fn new_project_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("prj_{nanos:x}")
}

#[allow(dead_code)]
fn new_inbox_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("inb_{nanos:x}")
}

#[allow(dead_code)]
fn new_entry_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("tren_{nanos:x}")
}

#[allow(dead_code)]
fn new_book_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("book_{nanos:x}")
}

#[allow(dead_code)]
fn new_book_excerpt_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("bexc_{nanos:x}")
}

#[allow(dead_code)]
fn new_habit_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("hab_{nanos:x}")
}

#[allow(dead_code)]
fn new_checkin_id() -> String {
    let nanos = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("hck_{nanos:x}")
}

/// Parse a 'YYYY-MM-DD' string into a `Date` without the `time` parsing feature.
/// Habit days are local dates supplied by the frontend.
fn parse_ymd(s: &str) -> Option<Date> {
    let mut parts = s.split('-');
    let y: i32 = parts.next()?.trim().parse().ok()?;
    let m: u8 = parts.next()?.trim().parse().ok()?;
    let d: u8 = parts.next()?.trim().parse().ok()?;
    let month = time::Month::try_from(m).ok()?;
    Date::from_calendar_date(y, month, d).ok()
}

/// Consecutive completed days ending at (or, if today isn't done yet, just
/// before) `today`. An unfinished today doesn't reset a live streak.
fn compute_current_streak(days: &std::collections::HashSet<String>, today: &str) -> i64 {
    let fmt = format_description!("[year]-[month]-[day]");
    let mut cursor = match parse_ymd(today) {
        Some(d) => d,
        None => return 0,
    };
    if !days.contains(today) {
        cursor = match cursor.previous_day() {
            Some(d) => d,
            None => return 0,
        };
    }
    let mut streak = 0i64;
    loop {
        let key = match cursor.format(&fmt) {
            Ok(s) => s,
            Err(_) => break,
        };
        if !days.contains(&key) {
            break;
        }
        streak += 1;
        cursor = match cursor.previous_day() {
            Some(d) => d,
            None => break,
        };
    }
    streak
}

fn row_to_habit(row: &rusqlite::Row<'_>) -> rusqlite::Result<Habit> {
    Ok(Habit {
        id: row.get(0)?,
        name: row.get(1)?,
        emoji: row.get(2)?,
        color: row.get(3)?,
        kind: row.get(4)?,
        target: row.get(5)?,
        unit: row.get(6)?,
        schedule: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        archived_at: row.get(11)?,
        today_count: row.get(12)?,
        total_checkins: row.get(13)?,
        done_today: false,
        current_streak: 0,
    })
}

fn row_to_habit_checkin(row: &rusqlite::Row<'_>) -> rusqlite::Result<HabitCheckin> {
    Ok(HabitCheckin {
        id: row.get(0)?,
        habit_id: row.get(1)?,
        day: row.get(2)?,
        count: row.get(3)?,
        note: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn row_to_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<Book> {
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        cover_url: row.get(3)?,
        intro: row.get(4)?,
        status: row.get(5)?,
        rating: row.get(6)?,
        start_date: row.get(7)?,
        end_date: row.get(8)?,
        thoughts: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        excerpt_count: row.get(12)?,
    })
}

fn row_to_book_excerpt(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookExcerpt> {
    Ok(BookExcerpt {
        id: row.get(0)?,
        book_id: row.get(1)?,
        text: row.get(2)?,
        page: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn row_to_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        archived_at: row.get(4)?,
        entry_count: row.get(5)?,
        last_entry_at: row.get(6)?,
    })
}

#[allow(dead_code)]
fn row_to_inbox_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: row.get(0)?,
        source: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        format: row.get(4)?,
        read: row.get(5)?,
        created_at: row.get(6)?,
        archived_at: row.get(7)?,
    })
}

#[allow(dead_code)]
fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let tags_json: String = row.get(5)?;
    let tags = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        git_url: row.get(3)?,
        description: row.get(4)?,
        tags,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_track_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackEntry> {
    Ok(TrackEntry {
        id: row.get(0)?,
        track_id: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
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
        favorite: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
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
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub track_entries: Vec<TrackEntry>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub inbox_items: Vec<InboxItem>,
    #[serde(default)]
    pub books: Vec<Book>,
    #[serde(default)]
    pub book_excerpts: Vec<BookExcerpt>,
    #[serde(default)]
    pub habits: Vec<Habit>,
    #[serde(default)]
    pub habit_checkins: Vec<HabitCheckin>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[allow(dead_code)]
pub struct SyncImportResult {
    pub inserted: usize,
    pub updated: usize,
    pub skipped: usize,
}
