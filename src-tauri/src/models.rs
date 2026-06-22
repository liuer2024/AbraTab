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
