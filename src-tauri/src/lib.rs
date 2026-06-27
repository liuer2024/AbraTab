mod gitee_sync;
mod models;
mod qiniu;
mod store;

use gitee_sync::{GiteePullResult, GiteePushResult, GiteeSyncConfigInput, GiteeSyncStatus};
use qiniu::{QiniuStatus, UploadResult};
use models::{
    InboxItem, Project, ProjectInput, Snippet, SnippetInput, Track, TrackEntry, TrackEntryInput,
    TrackInput, WeekLog, WeekLogInput,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use store::Store;
use tauri::Manager;

const INTEGRATION_START: &str = "# >>> AbraTab shell integration >>>";
const INTEGRATION_END: &str = "# <<< AbraTab shell integration <<<";
const OLD_ZSH_INTEGRATION_START: &str = "# >>> AbraTab zsh integration >>>";
const OLD_ZSH_INTEGRATION_END: &str = "# <<< AbraTab zsh integration <<<";

#[derive(Debug, Clone, Serialize)]
struct ShellIntegrationStatus {
    shell: String,
    config_path: String,
    registered: bool,
    cli_path: String,
    cli_built: bool,
}

#[derive(Debug, Clone, Serialize)]
struct CurrentWeek {
    week_key: String,
    week_start: String,
    week_end: String,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalDependencyStatus {
    fzf_installed: bool,
    fzf_path: Option<String>,
    homebrew_installed: bool,
    install_command: String,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error(transparent)]
    Anyhow(#[from] anyhow::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
fn list_snippets(
    query: Option<String>,
    include_deleted: Option<bool>,
) -> Result<Vec<Snippet>, AppError> {
    Ok(Store::open_default()?.list(query.as_deref(), include_deleted.unwrap_or(false))?)
}

#[tauri::command]
fn save_snippet(input: SnippetInput) -> Result<Snippet, AppError> {
    Ok(Store::open_default()?.save(input)?)
}

#[tauri::command]
fn delete_snippet(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete(&id)?;
    Ok(())
}

#[tauri::command]
fn restore_snippet(id: String) -> Result<(), AppError> {
    Store::open_default()?.restore(&id)?;
    Ok(())
}

#[tauri::command]
fn purge_snippet(id: String) -> Result<(), AppError> {
    Store::open_default()?.purge(&id)?;
    Ok(())
}

#[tauri::command]
fn set_snippet_favorite(id: String, favorite: bool) -> Result<(), AppError> {
    Store::open_default()?.set_favorite(&id, favorite)?;
    Ok(())
}

#[tauri::command]
fn set_snippet_pinned(id: String, pinned: bool) -> Result<(), AppError> {
    Store::open_default()?.set_pinned(&id, pinned)?;
    Ok(())
}

#[tauri::command]
fn move_snippet_category(id: String, category: String) -> Result<(), AppError> {
    Store::open_default()?.set_category(&id, &category)?;
    Ok(())
}

#[tauri::command]
fn expand_snippet(shortcut: String, shell: Option<String>) -> Result<Option<String>, AppError> {
    Ok(Store::open_default()?
        .get_by_shortcut(&shortcut, shell.as_deref())?
        .map(|snippet| snippet.body))
}

#[tauri::command]
fn copy_snippet(id: String) -> Result<(), AppError> {
    let snippet = Store::open_default()?
        .get(&id)?
        .ok_or_else(|| anyhow::anyhow!("snippet not found"))?;
    let mut clipboard = arboard::Clipboard::new().map_err(|error| anyhow::anyhow!(error))?;
    clipboard
        .set_text(snippet.body)
        .map_err(|error| anyhow::anyhow!(error))?;
    Ok(())
}

#[tauri::command]
fn database_path() -> Result<String, AppError> {
    Ok(store::default_db_path()?.display().to_string())
}

#[tauri::command]
fn list_week_logs(query: Option<String>) -> Result<Vec<WeekLog>, AppError> {
    Ok(Store::open_default()?.list_week_logs(query.as_deref())?)
}

#[tauri::command]
fn save_week_log(input: WeekLogInput) -> Result<WeekLog, AppError> {
    Ok(Store::open_default()?.save_week_log(input)?)
}

#[tauri::command]
fn set_week_log_favorite(id: String, favorite: bool) -> Result<(), AppError> {
    Store::open_default()?.set_week_log_favorite(&id, favorite)?;
    Ok(())
}

#[tauri::command]
fn delete_week_log(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete_week_log(&id)?;
    Ok(())
}

#[tauri::command]
fn list_projects(query: Option<String>) -> Result<Vec<Project>, AppError> {
    Ok(Store::open_default()?.list_projects(query.as_deref())?)
}

#[tauri::command]
fn save_project(input: ProjectInput) -> Result<Project, AppError> {
    Ok(Store::open_default()?.save_project(input)?)
}

#[tauri::command]
fn delete_project(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete_project(&id)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
struct InboxConnectionInfo {
    cli_path: String,
    db_path: String,
}

#[tauri::command]
fn list_inbox_items(query: Option<String>) -> Result<Vec<InboxItem>, AppError> {
    Ok(Store::open_default()?.list_inbox_items(query.as_deref())?)
}

#[tauri::command]
fn set_inbox_read(id: String, read: bool) -> Result<(), AppError> {
    Store::open_default()?.set_inbox_read(&id, read)?;
    Ok(())
}

#[tauri::command]
fn delete_inbox_item(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete_inbox_item(&id)?;
    Ok(())
}

#[tauri::command]
fn inbox_connection_info() -> Result<InboxConnectionInfo, AppError> {
    Ok(InboxConnectionInfo {
        cli_path: cli_path().display().to_string(),
        db_path: store::default_db_path()?.display().to_string(),
    })
}

// ── Weeklog soft lock (master password + locked id list, stored locally) ──
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct LockData {
    #[serde(default)]
    salt: String,
    #[serde(default)]
    hash: String,
    #[serde(default)]
    locked_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct LockState {
    configured: bool,
    locked_ids: Vec<String>,
}

fn lock_file_path() -> anyhow::Result<PathBuf> {
    Ok(store::default_db_path()?.with_file_name("lock.json"))
}

fn load_lock() -> LockData {
    lock_file_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_lock(data: &LockData) -> anyhow::Result<()> {
    let path = lock_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(data)?)?;
    Ok(())
}

fn salt_string() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

fn hash_password(salt: &str, password: &str) -> String {
    type HmacSha1 = Hmac<Sha1>;
    let mut mac = HmacSha1::new_from_slice(salt.as_bytes()).expect("hmac accepts any key length");
    mac.update(password.as_bytes());
    STANDARD.encode(mac.finalize().into_bytes())
}

#[tauri::command]
fn lock_state() -> Result<LockState, AppError> {
    let data = load_lock();
    Ok(LockState {
        configured: !data.hash.is_empty(),
        locked_ids: data.locked_ids,
    })
}

#[tauri::command]
fn set_master_password(password: String) -> Result<(), AppError> {
    let mut data = load_lock();
    if data.salt.is_empty() {
        data.salt = salt_string();
    }
    data.hash = hash_password(&data.salt, &password);
    save_lock(&data).map_err(AppError::from)
}

#[tauri::command]
fn verify_master_password(password: String) -> Result<bool, AppError> {
    let data = load_lock();
    if data.hash.is_empty() {
        return Ok(false);
    }
    Ok(hash_password(&data.salt, &password) == data.hash)
}

#[tauri::command]
fn clear_master_password() -> Result<(), AppError> {
    save_lock(&LockData::default()).map_err(AppError::from)
}

#[tauri::command]
fn set_week_log_locked(id: String, locked: bool) -> Result<(), AppError> {
    let mut data = load_lock();
    data.locked_ids.retain(|existing| existing != &id);
    if locked {
        data.locked_ids.push(id);
    }
    save_lock(&data).map_err(AppError::from)
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, AppError> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|error| anyhow::anyhow!("failed to read autostart state: {error}").into())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), AppError> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| anyhow::anyhow!("failed to update autostart: {error}").into())
}

/// Reveal a directory in the OS file manager (Finder / Explorer / xdg-open).
#[tauri::command]
fn open_path(path: String) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("path is empty").into());
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";
    Command::new(program)
        .arg(trimmed)
        .spawn()
        .map_err(|error| anyhow::anyhow!("failed to open {trimmed}: {error}"))?;
    Ok(())
}

#[tauri::command]
fn current_week() -> Result<CurrentWeek, AppError> {
    let (week_key, week_start, week_end) = store::current_week_fields()?;
    Ok(CurrentWeek {
        week_key,
        week_start,
        week_end,
    })
}

#[tauri::command]
fn list_tracks(query: Option<String>) -> Result<Vec<Track>, AppError> {
    Ok(Store::open_default()?.list_tracks(query.as_deref())?)
}

#[tauri::command]
fn save_track(input: TrackInput) -> Result<Track, AppError> {
    Ok(Store::open_default()?.save_track(input)?)
}

#[tauri::command]
fn delete_track(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete_track(&id)?;
    Ok(())
}

#[tauri::command]
fn list_track_entries(track_id: String) -> Result<Vec<TrackEntry>, AppError> {
    Ok(Store::open_default()?.list_track_entries(&track_id)?)
}

#[tauri::command]
fn add_track_entry(input: TrackEntryInput) -> Result<TrackEntry, AppError> {
    Ok(Store::open_default()?.add_track_entry(input)?)
}

#[tauri::command]
fn update_track_entry(id: String, body: String) -> Result<TrackEntry, AppError> {
    Ok(Store::open_default()?.update_track_entry(&id, &body)?)
}

#[tauri::command]
fn delete_track_entry(id: String) -> Result<(), AppError> {
    Store::open_default()?.delete_track_entry(&id)?;
    Ok(())
}

#[tauri::command]
fn gitee_sync_status() -> Result<GiteeSyncStatus, AppError> {
    Ok(gitee_sync::load_status()?)
}

#[tauri::command]
fn save_gitee_sync_config(input: GiteeSyncConfigInput) -> Result<GiteeSyncStatus, AppError> {
    Ok(gitee_sync::save_config(input)?)
}

#[tauri::command]
async fn push_gitee_sync() -> Result<GiteePushResult, AppError> {
    let snapshot = Store::open_default()?.export_snapshot()?;
    let counts = (
        snapshot.snippets.len(),
        snapshot.week_logs.len(),
        snapshot.tracks.len(),
        snapshot.projects.len(),
        snapshot.inbox_items.len(),
    );
    match gitee_sync::push(snapshot).await {
        Ok(result) => {
            gitee_sync::record_sync(
                "push",
                true,
                Some(&result.gist_id),
                counts.0,
                counts.1,
                counts.2,
                counts.3,
                counts.4,
                "",
            );
            Ok(result)
        }
        Err(error) => {
            gitee_sync::record_sync(
                "push",
                false,
                None,
                counts.0,
                counts.1,
                counts.2,
                counts.3,
                counts.4,
                &error.to_string(),
            );
            Err(error.into())
        }
    }
}

#[tauri::command]
async fn pull_gitee_sync() -> Result<GiteePullResult, AppError> {
    match gitee_sync::pull().await {
        Ok((gist_id, snapshot)) => {
            let counts = (
                snapshot.snippets.len(),
                snapshot.week_logs.len(),
                snapshot.tracks.len(),
                snapshot.projects.len(),
                snapshot.inbox_items.len(),
            );
            let imported = Store::open_default()?.import_snapshot(snapshot)?;
            gitee_sync::record_sync(
                "pull",
                true,
                Some(&gist_id),
                counts.0,
                counts.1,
                counts.2,
                counts.3,
                counts.4,
                "",
            );
            Ok(GiteePullResult { gist_id, imported })
        }
        Err(error) => {
            gitee_sync::record_sync("pull", false, None, 0, 0, 0, 0, 0, &error.to_string());
            Err(error.into())
        }
    }
}

#[tauri::command]
fn qiniu_status() -> Result<QiniuStatus, AppError> {
    Ok(qiniu::load_status()?)
}

#[tauri::command]
fn save_qiniu_config(
    access_key: String,
    secret_key: String,
    bucket: String,
    domain: String,
    up_host: Option<String>,
) -> Result<QiniuStatus, AppError> {
    Ok(qiniu::save_config(
        &access_key,
        &secret_key,
        &bucket,
        &domain,
        up_host.as_deref(),
    )?)
}

#[tauri::command]
async fn upload_image(filename: String, data: String) -> Result<UploadResult, AppError> {
    Ok(qiniu::upload(&filename, &data).await?)
}

#[tauri::command]
fn terminal_integration_status() -> Result<Vec<ShellIntegrationStatus>, AppError> {
    ["zsh", "bash", "fish"]
        .into_iter()
        .map(shell_status)
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
}

#[tauri::command]
fn install_shell_integration(shell: String) -> Result<ShellIntegrationStatus, AppError> {
    install_integration(&shell)?;
    shell_status(&shell).map_err(Into::into)
}

#[tauri::command]
fn uninstall_shell_integration(shell: String) -> Result<ShellIntegrationStatus, AppError> {
    uninstall_integration(&shell)?;
    shell_status(&shell).map_err(Into::into)
}

#[tauri::command]
fn build_cli() -> Result<String, AppError> {
    Ok(build_cli_binary()?.display().to_string())
}

#[tauri::command]
fn terminal_dependency_status() -> TerminalDependencyStatus {
    dependency_status()
}

#[tauri::command]
fn install_fzf() -> Result<TerminalDependencyStatus, AppError> {
    if command_path("brew").is_none() {
        return Err(anyhow::anyhow!(
            "Homebrew is required to install fzf automatically. Run: brew install fzf"
        )
        .into());
    }

    let output = Command::new("sh")
        .args(["-lc", "brew install fzf"])
        .output()
        .map_err(anyhow::Error::from)?;

    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "brew install fzf failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(dependency_status())
}

fn dependency_status() -> TerminalDependencyStatus {
    let fzf_path = command_path("fzf");
    TerminalDependencyStatus {
        fzf_installed: fzf_path.is_some(),
        fzf_path,
        homebrew_installed: command_path("brew").is_some(),
        install_command: "brew install fzf".to_string(),
    }
}

fn command_path(name: &str) -> Option<String> {
    let output = Command::new("sh")
        .args(["-lc", &format!("command -v {name}")])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

fn build_cli_binary() -> anyhow::Result<PathBuf> {
    let src_tauri = src_tauri_dir()?;
    let output = Command::new("cargo")
        .args(["build", "--bin", "abratab-cli"])
        .current_dir(&src_tauri)
        .output()?;

    if !output.status.success() {
        anyhow::bail!(
            "cargo build failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(cli_path())
}

fn shell_status(shell: &str) -> anyhow::Result<ShellIntegrationStatus> {
    let config_path = shell_config_path(shell)?;
    let registered = match shell {
        "fish" => {
            config_path.exists()
                && fs::read_to_string(&config_path)
                    .map(|content| content.contains("abratab.fish"))
                    .unwrap_or(false)
        }
        _ => fs::read_to_string(&config_path)
            .map(|content| content.contains(INTEGRATION_START) && content.contains(INTEGRATION_END))
            .unwrap_or(false),
    };

    let cli_path = cli_path();
    Ok(ShellIntegrationStatus {
        shell: shell.to_string(),
        config_path: config_path.display().to_string(),
        registered,
        cli_built: cli_path.exists(),
        cli_path: cli_path.display().to_string(),
    })
}

fn install_integration(shell: &str) -> anyhow::Result<()> {
    let root = project_root()?;
    let cli = cli_path();
    if !cli.exists() {
        build_cli_binary()?;
    }

    let config_path = shell_config_path(shell)?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }

    match shell {
        "fish" => {
            let content = format!(
                "set -gx ABRATAB_ROOT \"{}\"\nset -gx ABRATAB_CLI \"{}\"\nsource \"{}\"\n",
                root.display(),
                cli.display(),
                root.join("scripts/abratab.fish").display()
            );
            fs::write(config_path, content)?;
        }
        "zsh" | "bash" => {
            let script = root.join(format!("scripts/abratab.{shell}"));
            let block = format!(
                "{INTEGRATION_START}\nexport ABRATAB_ROOT=\"{}\"\nexport ABRATAB_CLI=\"{}\"\nsource \"{}\"\n{INTEGRATION_END}\n",
                root.display(),
                cli.display(),
                script.display()
            );
            let existing = fs::read_to_string(&config_path).unwrap_or_default();
            let cleaned = remove_marked_block(&existing);
            fs::write(config_path, format!("{}\n{}", cleaned.trim_end(), block))?;
        }
        other => anyhow::bail!("unsupported shell: {other}"),
    }

    Ok(())
}

fn uninstall_integration(shell: &str) -> anyhow::Result<()> {
    let config_path = shell_config_path(shell)?;
    match shell {
        "fish" => {
            if config_path.exists() {
                fs::remove_file(config_path)?;
            }
        }
        "zsh" | "bash" => {
            let existing = fs::read_to_string(&config_path).unwrap_or_default();
            fs::write(config_path, remove_marked_block(&existing))?;
        }
        other => anyhow::bail!("unsupported shell: {other}"),
    }
    Ok(())
}

fn remove_marked_block(content: &str) -> String {
    let content = remove_marked_block_pair(content, INTEGRATION_START, INTEGRATION_END);
    remove_marked_block_pair(&content, OLD_ZSH_INTEGRATION_START, OLD_ZSH_INTEGRATION_END)
}

fn remove_marked_block_pair(content: &str, start: &str, end: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in content.lines() {
        if line == start {
            skipping = true;
            continue;
        }
        if line == end {
            skipping = false;
            continue;
        }
        if !skipping {
            output.push(line);
        }
    }
    output.join("\n")
}

fn shell_config_path(shell: &str) -> anyhow::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("could not find home directory"))?;
    match shell {
        "zsh" => Ok(std::env::var_os("ZDOTDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.clone())
            .join(".zshrc")),
        "bash" => Ok(home.join(".bashrc")),
        "fish" => Ok(home.join(".config/fish/conf.d/abratab.fish")),
        other => anyhow::bail!("unsupported shell: {other}"),
    }
}

fn project_root() -> anyhow::Result<PathBuf> {
    Ok(src_tauri_dir()?
        .parent()
        .ok_or_else(|| anyhow::anyhow!("could not find project root"))?
        .to_path_buf())
}

fn src_tauri_dir() -> anyhow::Result<PathBuf> {
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

fn cli_path() -> PathBuf {
    src_tauri_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target/debug/abratab-cli")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Persist and restore the window size (width/height) and position.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION,
                )
                .build(),
        )
        .setup(|app| {
            Store::open_default().map_err(|error| {
                tauri::Error::Anyhow(anyhow::anyhow!("failed to initialize database: {error}"))
            })?;
            app.manage(());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_snippets,
            save_snippet,
            delete_snippet,
            restore_snippet,
            purge_snippet,
            set_snippet_favorite,
            set_snippet_pinned,
            move_snippet_category,
            expand_snippet,
            copy_snippet,
            database_path,
            list_week_logs,
            save_week_log,
            set_week_log_favorite,
            delete_week_log,
            list_projects,
            save_project,
            delete_project,
            open_path,
            list_inbox_items,
            set_inbox_read,
            delete_inbox_item,
            inbox_connection_info,
            lock_state,
            set_master_password,
            verify_master_password,
            clear_master_password,
            set_week_log_locked,
            get_autostart,
            set_autostart,
            current_week,
            list_tracks,
            save_track,
            delete_track,
            list_track_entries,
            add_track_entry,
            update_track_entry,
            delete_track_entry,
            gitee_sync_status,
            save_gitee_sync_config,
            push_gitee_sync,
            pull_gitee_sync,
            qiniu_status,
            save_qiniu_config,
            upload_image,
            terminal_integration_status,
            terminal_dependency_status,
            install_shell_integration,
            uninstall_shell_integration,
            build_cli,
            install_fzf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
