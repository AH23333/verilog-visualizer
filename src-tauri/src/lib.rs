use std::fs;
use std::path::{Path, PathBuf};
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

/// Sanitize a relative path to prevent directory traversal attacks
fn sanitize_path(name: &str) -> Result<PathBuf, String> {
    let path = Path::new(name);
    // Reject absolute paths
    if path.is_absolute() {
        return Err("Absolute paths are not allowed".to_string());
    }
    // Reject paths with parent directory traversal
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Parent directory traversal is not allowed".to_string());
        }
    }
    Ok(path.to_path_buf())
}

/// Recursively scan a directory for Verilog files, returning relative paths
fn scan_dir_recursive(base: &Path, dir: &Path) -> Result<Vec<ProjectFileInfo>, String> {
    let mut files = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;

        if metadata.is_dir() {
            // Recursively scan subdirectories
            let sub_files = scan_dir_recursive(base, &path)?;
            files.extend(sub_files);
        } else if path.extension().map_or(false, |ext| ext == "v" || ext == "sv" || ext == "vh") {
            let relative = path
                .strip_prefix(base)
                .map_err(|e| format!("Failed to get relative path: {}", e))?;
            let modified = metadata
                .modified()
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                })
                .unwrap_or(0);

            files.push(ProjectFileInfo {
                name: relative.to_string_lossy().to_string().replace('\\', "/"),
                size: metadata.len(),
                modified,
            });
        }
    }

    Ok(files)
}

/// Save a file to the project directory (supports subdirectories)
#[tauri::command]
fn save_project_file(app_handle: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let rel_path = sanitize_path(&name)?;
    let path = dir.join(&rel_path);

    // Ensure parent directories exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    fs::write(&path, &content).map_err(|e| format!("Failed to save file '{}': {}", name, e))?;
    Ok(())
}

/// List all files in the project directory (recursively)
#[tauri::command]
fn list_project_files(app_handle: tauri::AppHandle) -> Result<Vec<ProjectFileInfo>, String> {
    let dir = ensure_project_dir(&app_handle)?;
    scan_dir_recursive(&dir, &dir)
}

/// Read a file from the project directory (supports subdirectories)
#[tauri::command]
fn read_project_file(app_handle: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = ensure_project_dir(&app_handle)?;
    let rel_path = sanitize_path(&name)?;
    let path = dir.join(&rel_path);
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", name, e))
}

/// Delete a file from the project directory (supports subdirectories)
#[tauri::command]
fn delete_project_file(app_handle: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let rel_path = sanitize_path(&name)?;
    let path = dir.join(&rel_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file '{}': {}", name, e))?;
    }
    Ok(())
}

/// Create a folder in the project directory
#[tauri::command]
fn create_project_folder(app_handle: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let rel_path = sanitize_path(&name)?;
    let path = dir.join(&rel_path);
    if path.exists() {
        return Err(format!("Folder '{}' already exists", name));
    }
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create folder '{}': {}", name, e))?;
    Ok(())
}

/// Delete a folder from the project directory
#[tauri::command]
fn delete_project_folder(app_handle: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let rel_path = sanitize_path(&name)?;
    let path = dir.join(&rel_path);
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err(format!("'{}' is not a folder", name));
    }
    fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete folder '{}': {}", name, e))?;
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
            create_project_folder,
            delete_project_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}