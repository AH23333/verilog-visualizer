use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Get the project files directory from the app's data directory
/// This places files outside src-tauri/ so Tauri's file watcher won't trigger rebuilds
fn get_project_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join("project_files"))
}

/// Ensure the project files directory exists
fn ensure_project_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = get_project_dir(app_handle)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create project directory: {}", e))?;
    Ok(dir)
}

/// Save a file to the project directory
#[tauri::command]
fn save_project_file(app_handle: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let path = dir.join(&name);
    fs::write(&path, &content).map_err(|e| format!("Failed to save file '{}': {}", name, e))?;
    Ok(())
}

/// List all files in the project directory
#[tauri::command]
fn list_project_files(app_handle: tauri::AppHandle) -> Result<Vec<ProjectFileInfo>, String> {
    let dir = ensure_project_dir(&app_handle)?;
    let mut files = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read project directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "v" || ext == "sv" || ext == "vh") {
            let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
            let modified = metadata
                .modified()
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                })
                .unwrap_or(0);

            files.push(ProjectFileInfo {
                name: path.file_name().unwrap().to_string_lossy().to_string(),
                size: metadata.len(),
                modified,
            });
        }
    }

    Ok(files)
}

/// Read a file from the project directory
#[tauri::command]
fn read_project_file(app_handle: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = ensure_project_dir(&app_handle)?;
    let path = dir.join(&name);
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", name, e))
}

/// Delete a file from the project directory
#[tauri::command]
fn delete_project_file(app_handle: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let path = dir.join(&name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file '{}': {}", name, e))?;
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectFileInfo {
    name: String,
    size: u64,
    modified: u64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_project_file,
            list_project_files,
            read_project_file,
            delete_project_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}