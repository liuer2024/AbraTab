mod models;
mod store;

use models::{Snippet, SnippetInput};
use serde::Serialize;
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
            expand_snippet,
            copy_snippet,
            database_path,
            terminal_integration_status,
            install_shell_integration,
            uninstall_shell_integration,
            build_cli
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
