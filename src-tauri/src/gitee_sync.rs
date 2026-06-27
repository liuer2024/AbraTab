use crate::store::{SyncImportResult, SyncSnapshot};
use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const API_BASE: &str = "https://gitee.com/api/v5";
const SYNC_FILENAME: &str = "abratab-sync.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GiteeSyncConfig {
    pub access_token: String,
    pub gist_id: Option<String>,
    pub description: String,
    pub public: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GiteeSyncConfigInput {
    // The frontend sends camelCase keys; accept both spellings so the
    // nested struct deserializes regardless of how Tauri forwards the args.
    #[serde(alias = "accessToken")]
    pub access_token: String,
    #[serde(alias = "gistId")]
    pub gist_id: Option<String>,
    pub description: Option<String>,
    pub public: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncLogEntry {
    pub at: String,
    pub action: String,
    pub ok: bool,
    pub gist_id: Option<String>,
    pub snippet_count: usize,
    pub week_log_count: usize,
    pub track_count: usize,
    #[serde(default)]
    pub project_count: usize,
    #[serde(default)]
    pub inbox_count: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GiteeSyncStatus {
    pub configured: bool,
    pub gist_id: Option<String>,
    pub description: String,
    pub public: bool,
    pub config_path: String,
    pub last_sync: Option<SyncLogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GiteePushResult {
    pub gist_id: String,
    pub snippet_count: usize,
    pub week_log_count: usize,
    pub track_count: usize,
    pub project_count: usize,
    pub inbox_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GiteePullResult {
    pub gist_id: String,
    pub imported: SyncImportResult,
}

#[derive(Debug, Deserialize)]
struct GiteeGistResponse {
    files: Option<HashMap<String, GiteeGistFile>>,
}

#[derive(Debug, Deserialize)]
struct GiteeGistFile {
    content: Option<String>,
}

pub fn load_status() -> Result<GiteeSyncStatus> {
    let config = load_config().ok();
    Ok(GiteeSyncStatus {
        configured: config
            .as_ref()
            .is_some_and(|value| !value.access_token.trim().is_empty()),
        gist_id: config.as_ref().and_then(|value| value.gist_id.clone()),
        description: config
            .as_ref()
            .map(|value| value.description.clone())
            .unwrap_or_else(default_description),
        public: config.as_ref().map(|value| value.public).unwrap_or(false),
        config_path: config_path()?.display().to_string(),
        last_sync: load_last_sync(),
    })
}

fn log_path() -> Result<PathBuf> {
    Ok(config_path()?.with_file_name("gitee-sync-log.json"))
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// Best-effort: persist the outcome of the most recent push/pull so the UI can
/// show a "last sync" log line. Failures to write the log are ignored.
#[allow(clippy::too_many_arguments)]
pub fn record_sync(
    action: &str,
    ok: bool,
    gist_id: Option<&str>,
    snippet_count: usize,
    week_log_count: usize,
    track_count: usize,
    project_count: usize,
    inbox_count: usize,
    message: &str,
) {
    let entry = SyncLogEntry {
        at: now_rfc3339(),
        action: action.to_string(),
        ok,
        gist_id: gist_id.map(ToOwned::to_owned),
        snippet_count,
        week_log_count,
        track_count,
        project_count,
        inbox_count,
        message: message.to_string(),
    };
    if let Ok(path) = log_path() {
        if let Ok(json) = serde_json::to_string_pretty(&entry) {
            let _ = fs::write(path, json);
        }
    }
}

fn load_last_sync() -> Option<SyncLogEntry> {
    let path = log_path().ok()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save_config(input: GiteeSyncConfigInput) -> Result<GiteeSyncStatus> {
    let existing = load_config().ok();
    let access_token = input.access_token.trim().to_string();
    let config = GiteeSyncConfig {
        access_token: if access_token.is_empty() {
            existing
                .as_ref()
                .map(|value| value.access_token.clone())
                .unwrap_or_default()
        } else {
            access_token
        },
        gist_id: input
            .gist_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        description: input
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(default_description),
        public: input.public.unwrap_or(false),
    };

    if config.access_token.is_empty() {
        anyhow::bail!("Gitee access token is required");
    }

    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(&config)?;
    fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
    load_status()
}

pub async fn push(snapshot: SyncSnapshot) -> Result<GiteePushResult> {
    let mut config = load_config().context("Gitee sync is not configured")?;
    if config.access_token.trim().is_empty() {
        anyhow::bail!("Gitee access token is required");
    }

    let content = serde_json::to_string_pretty(&snapshot)?;
    let gist_id = match config.gist_id.clone() {
        Some(gist_id) => update_gist(&config, &gist_id, &content).await?,
        None => {
            let gist_id = create_gist(&config, &content).await?;
            config.gist_id = Some(gist_id.clone());
            persist_config(&config)?;
            gist_id
        }
    };

    Ok(GiteePushResult {
        gist_id,
        snippet_count: snapshot.snippets.len(),
        week_log_count: snapshot.week_logs.len(),
        track_count: snapshot.tracks.len(),
        project_count: snapshot.projects.len(),
        inbox_count: snapshot.inbox_items.len(),
    })
}

pub async fn pull() -> Result<(String, SyncSnapshot)> {
    let config = load_config().context("Gitee sync is not configured")?;
    let gist_id = config
        .gist_id
        .clone()
        .context("Gitee gist id is required before pulling")?;
    let snapshot = fetch_snapshot(&config, &gist_id).await?;
    Ok((gist_id, snapshot))
}

async fn create_gist(config: &GiteeSyncConfig, content: &str) -> Result<String> {
    let body = json!({
        "access_token": config.access_token,
        "description": config.description,
        "public": config.public,
        "files": {
            SYNC_FILENAME: {
                "content": content
            }
        }
    });
    let response = Client::new()
        .post(format!("{API_BASE}/gists"))
        .json(&body)
        .send()
        .await?;
    let value = response_json(response).await?;
    value
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .context("Gitee did not return a gist id")
}

async fn update_gist(config: &GiteeSyncConfig, gist_id: &str, content: &str) -> Result<String> {
    let body = json!({
        "access_token": config.access_token,
        "description": config.description,
        "files": {
            SYNC_FILENAME: {
                "content": content
            }
        }
    });
    let response = Client::new()
        .patch(format!("{API_BASE}/gists/{gist_id}"))
        .json(&body)
        .send()
        .await?;
    response_json(response).await?;
    Ok(gist_id.to_string())
}

async fn fetch_snapshot(config: &GiteeSyncConfig, gist_id: &str) -> Result<SyncSnapshot> {
    let url = reqwest::Url::parse_with_params(
        &format!("{API_BASE}/gists/{gist_id}"),
        &[("access_token", config.access_token.as_str())],
    )?;
    let response = Client::new()
        .get(url)
        .send()
        .await?;
    let gist: GiteeGistResponse = response_typed(response).await?;
    let files = gist.files.context("Gitee gist response did not include files")?;
    let content = files
        .get(SYNC_FILENAME)
        .and_then(|file| file.content.clone())
        .or_else(|| files.values().find_map(|file| file.content.clone()))
        .context("Gitee gist did not include sync file content")?;
    serde_json::from_str(&content).context("parsing AbraTab sync snapshot")
}

async fn response_json(response: reqwest::Response) -> Result<Value> {
    response_typed(response).await
}

async fn response_typed<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("Gitee API returned {status}: {text}");
    }
    serde_json::from_str(&text).context("parsing Gitee API response")
}

fn load_config() -> Result<GiteeSyncConfig> {
    let path = config_path()?;
    let text = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

fn persist_config(config: &GiteeSyncConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(config)?)
        .with_context(|| format!("writing {}", path.display()))
}

fn config_path() -> Result<PathBuf> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))
        .context("could not find a data directory")?;
    Ok(base.join("AbraTab").join("gitee-sync.json"))
}

fn default_description() -> String {
    "AbraTab sync data".to_string()
}
