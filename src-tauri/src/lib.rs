mod models;
mod store;

use models::{Snippet, SnippetInput};
use store::Store;
use tauri::Manager;

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
fn list_snippets(query: Option<String>, include_deleted: Option<bool>) -> Result<Vec<Snippet>, AppError> {
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
            database_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
