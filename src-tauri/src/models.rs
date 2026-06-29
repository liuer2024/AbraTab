use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub body: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub shortcut: String,
    pub shell: String,
    pub enabled: bool,
    pub favorite: bool,
    pub pinned: bool,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetInput {
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub shortcut: Option<String>,
    pub shell: Option<String>,
    pub enabled: Option<bool>,
    pub favorite: Option<bool>,
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeekLog {
    pub id: String,
    pub week_key: String,
    pub week_start: String,
    pub week_end: String,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct WeekLogInput {
    pub id: Option<String>,
    pub week_key: String,
    pub title: Option<String>,
    pub body: String,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub git_url: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ProjectInput {
    pub id: Option<String>,
    pub name: String,
    pub path: Option<String>,
    pub git_url: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayActivity {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub source: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub format: String,
    pub read: bool,
    pub created_at: String,
    #[serde(default)]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub entry_count: i64,
    #[serde(default)]
    pub last_entry_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct TrackInput {
    pub id: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEntry {
    pub id: String,
    pub track_id: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct TrackEntryInput {
    pub track_id: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub cover_url: String,
    pub intro: String,
    pub status: String, // want / reading / finished
    #[serde(default)]
    pub rating: i64, // 0 = unrated, 1-5 stars
    #[serde(default)]
    pub start_date: String,
    #[serde(default)]
    pub end_date: String,
    pub thoughts: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub excerpt_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct BookInput {
    pub id: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover_url: Option<String>,
    pub intro: Option<String>,
    pub status: Option<String>,
    pub rating: Option<i64>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub thoughts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookExcerpt {
    pub id: String,
    pub book_id: String,
    pub text: String,
    #[serde(default)]
    pub page: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct BookExcerptInput {
    pub book_id: String,
    pub text: String,
    #[serde(default)]
    pub page: String,
}
