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

/// Move/rename a file within the project directory
#[tauri::command]
fn move_project_file(app_handle: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let old_rel = sanitize_path(&old_name)?;
    let new_rel = sanitize_path(&new_name)?;
    let old_path = dir.join(&old_rel);
    let new_path = dir.join(&new_rel);

    if !old_path.exists() {
        return Err(format!("Source file '{}' does not exist", old_name));
    }

    // Ensure parent directory of target exists
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to move file '{}' -> '{}': {}", old_name, new_name, e))?;
    Ok(())
}

/// Move/rename a folder and all its contents within the project directory
#[tauri::command]
fn move_project_folder(app_handle: tauri::AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let old_rel = sanitize_path(&old_name)?;
    let new_rel = sanitize_path(&new_name)?;
    let old_path = dir.join(&old_rel);
    let new_path = dir.join(&new_rel);

    if !old_path.exists() {
        return Err(format!("Source folder '{}' does not exist", old_name));
    }
    if !old_path.is_dir() {
        return Err(format!("'{}' is not a folder", old_name));
    }
    if new_path.exists() {
        return Err(format!("Target '{}' already exists", new_name));
    }

    // Ensure parent directory of target exists
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to move folder '{}' -> '{}': {}", old_name, new_name, e))?;
    Ok(())
}

/// Copy a file within the project directory
#[tauri::command]
fn copy_project_file(app_handle: tauri::AppHandle, source: String, dest: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let src_rel = sanitize_path(&source)?;
    let dst_rel = sanitize_path(&dest)?;
    let src_path = dir.join(&src_rel);
    let dst_path = dir.join(&dst_rel);

    if !src_path.exists() {
        return Err(format!("Source file '{}' does not exist", source));
    }

    // Ensure parent directory of target exists
    if let Some(parent) = dst_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    fs::copy(&src_path, &dst_path)
        .map_err(|e| format!("Failed to copy file '{}' -> '{}': {}", source, dest, e))?;
    Ok(())
}

/// Recursively copy a folder within the project directory
#[tauri::command]
fn copy_project_folder(app_handle: tauri::AppHandle, source: String, dest: String) -> Result<(), String> {
    let dir = ensure_project_dir(&app_handle)?;
    let src_rel = sanitize_path(&source)?;
    let dst_rel = sanitize_path(&dest)?;
    let src_path = dir.join(&src_rel);
    let dst_path = dir.join(&dst_rel);

    if !src_path.exists() {
        return Err(format!("Source folder '{}' does not exist", source));
    }
    if !src_path.is_dir() {
        return Err(format!("'{}' is not a folder", source));
    }

    copy_dir_recursive(&src_path, &dst_path)
        .map_err(|e| format!("Failed to copy folder '{}' -> '{}': {}", source, dest, e))?;
    Ok(())
}

/// Recursively copy a directory and its contents
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory '{}': {}", dst.display(), e))?;

    let entries = fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory '{}': {}", src.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let dest_path = dst.join(path.file_name().unwrap());

        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)
                .map_err(|e| format!("Failed to copy file '{}': {}", path.display(), e))?;
        }
    }
    Ok(())
}

/// List the full project tree including empty folders
#[tauri::command]
fn list_project_tree(app_handle: tauri::AppHandle) -> Result<ProjectTree, String> {
    let dir = ensure_project_dir(&app_handle)?;
    scan_tree_recursive(&dir, &dir)
}

/// Recursively scan a directory returning both files and folders
fn scan_tree_recursive(base: &Path, dir: &Path) -> Result<ProjectTree, String> {
    let mut files = Vec::new();
    let mut folders = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory '{}': {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        let relative = path
            .strip_prefix(base)
            .map_err(|e| format!("Failed to get relative path: {}", e))?
            .to_string_lossy()
            .to_string()
            .replace('\\', "/");

        if metadata.is_dir() {
            let sub_tree = scan_tree_recursive(base, &path)?;
            files.extend(sub_tree.files);
            folders.extend(sub_tree.folders);
            folders.push(relative);
        } else if path.extension().map_or(false, |ext| ext == "v" || ext == "sv" || ext == "vh") {
            let modified = metadata
                .modified()
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                })
                .unwrap_or(0);

            files.push(ProjectFileInfo {
                name: relative,
                size: metadata.len(),
                modified,
            });
        }
    }

    Ok(ProjectTree { files, folders })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectFileInfo {
    name: String,
    size: u64,
    modified: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ProjectTree {
    files: Vec<ProjectFileInfo>,
    folders: Vec<String>,
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
            move_project_file,
            move_project_folder,
            copy_project_file,
            copy_project_folder,
            list_project_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}