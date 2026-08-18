// File metadata and management store
// Stores imported Verilog files and folders in memory with Tauri-backed project directory persistence

import { invoke } from '@tauri-apps/api/core';
import { parseVerilogModules } from '../lib/verilog';

export interface FileEntry {
  id: string;
  name: string;
  /** Full file path (original import path or project directory path) */
  filePath?: string;
  content: string;
  circuitJson: Record<string, unknown> | null;
  importedAt: number;
  status: 'pending' | 'compiled' | 'error' | 'missing_deps';
  errorMessage?: string;
  missingModules?: string[];
  /** Module names defined in this file (parsed from Verilog content) */
  definedModules?: string[];
  /** Manual bindings: missing-module-name → file-id that defines it */
  moduleBindings?: Record<string, string>;
}

/** A tracked folder entry (persisted separately from file-inferred folders) */
export interface FolderEntry {
  path: string;
}

const FILES_STORAGE_KEY = 'verilog-viz-files';
const FOLDERS_STORAGE_KEY = 'verilog-viz-folders';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFilesFromLocalStorage(): FileEntry[] {
  try {
    const raw = localStorage.getItem(FILES_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return data.map((f: any) => ({ ...f, circuitJson: null, status: 'pending' as const }));
    }
  } catch {}
  return [];
}

function loadFoldersFromLocalStorage(): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as string[];
    }
  } catch {}
  return [];
}

function saveFilesToLocalStorage(files: FileEntry[]): void {
  try {
    const toSave = files.map(({ circuitJson, ...rest }) => rest);
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

function saveFoldersToLocalStorage(folders: string[]): void {
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  } catch {}
}

let files: FileEntry[] = loadFilesFromLocalStorage();
let folders: string[] = loadFoldersFromLocalStorage();
/** Cached snapshot for stable reference across useSyncExternalStore calls */
let foldersSnapshot: string[] = [];
let listeners: Array<() => void> = [];
let initialized = false;

function recomputeFoldersSnapshot(): void {
  const inferred = new Set<string>();
  for (const f of files) {
    const parts = f.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      inferred.add(parts.slice(0, i).join('/'));
    }
  }
  const merged = new Set([...folders, ...inferred]);
  foldersSnapshot = Array.from(merged).sort();
}

// Initialize snapshot
recomputeFoldersSnapshot();

function notify() {
  recomputeFoldersSnapshot();
  listeners.forEach((fn) => fn());
}

/** Get all tracked folder paths (includes both tracked and file-inferred folders) */
function getAllFolders(): string[] {
  return foldersSnapshot;
}

export const fileStore = {
  getAll(): FileEntry[] {
    return files;
  },

  /** Get all folders (tracked + inferred from file paths) */
  getFolders(): string[] {
    return getAllFolders();
  },

  getById(id: string): FileEntry | undefined {
    return files.find((f) => f.id === id);
  },

  /** Find a file by its module name */
  getByModuleName(moduleName: string): FileEntry | undefined {
    return files.find((f) => f.definedModules?.includes(moduleName));
  },

  addFile(name: string, content: string, filePath?: string): FileEntry {
    const modules = parseVerilogModules(content);
    const entry: FileEntry = {
      id: generateId(),
      name,
      filePath: filePath || name,
      content,
      circuitJson: null,
      importedAt: Date.now(),
      status: 'pending',
      definedModules: modules,
    };
    files = [...files, entry];
    saveFilesToLocalStorage(files);

    // Save to project directory via Tauri backend
    invoke('save_project_file', { name, content }).catch((err) => {
      console.warn('Failed to save file to project directory:', err);
    });

    notify();
    return entry;
  },

  /** Create a new empty file */
  createFile(name: string): FileEntry {
    const content = `// ${name}\n`;
    const modules = parseVerilogModules(content);
    const entry: FileEntry = {
      id: generateId(),
      name,
      filePath: name,
      content,
      circuitJson: null,
      importedAt: Date.now(),
      status: 'pending',
      definedModules: modules,
    };
    files = [...files, entry];
    saveFilesToLocalStorage(files);
    invoke('save_project_file', { name, content }).catch(console.warn);
    notify();
    return entry;
  },

  /** Create a new folder in the project directory and track it */
  createFolder(name: string): void {
    if (folders.includes(name)) return;
    folders = [...folders, name];
    saveFoldersToLocalStorage(folders);

    invoke('create_project_folder', { name }).catch((err) => {
      console.warn('Failed to create folder:', err);
    });
    notify();
  },

  /** Delete a folder and all files inside it */
  deleteFolder(name: string): void {
    // Remove all files whose path starts with the folder name
    const prefix = name + '/';
    files = files.filter((f) => f.name !== name && !f.name.startsWith(prefix));
    saveFilesToLocalStorage(files);

    // Remove the folder and any subfolders from tracking
    folders = folders.filter((f) => f !== name && !f.startsWith(prefix));
    saveFoldersToLocalStorage(folders);

    invoke('delete_project_folder', { name }).catch((err) => {
      console.warn('Failed to delete folder:', err);
    });
    notify();
  },

  /** Save file content to disk (without re-parsing) */
  saveContent(id: string, content: string): void {
    const file = files.find((f) => f.id === id);
    if (file) {
      const modules = parseVerilogModules(content);
      const updated = { ...file, content, definedModules: modules };
      files = files.map((f) => (f.id === id ? updated : f));
      saveFilesToLocalStorage(files);
      invoke('save_project_file', { name: file.name, content }).catch(console.warn);
      notify();
    }
  },

  updateFile(id: string, updates: Partial<FileEntry>): void {
    files = files.map((f) => (f.id === id ? { ...f, ...updates } : f));
    saveFilesToLocalStorage(files);
    notify();
  },

  /** Set a manual module binding: missing module name → file ID */
  setModuleBinding(fileId: string, missingModule: string, sourceFileId: string): void {
    files = files.map((f) => {
      if (f.id === fileId) {
        const bindings = { ...(f.moduleBindings || {}), [missingModule]: sourceFileId };
        return { ...f, moduleBindings: bindings };
      }
      return f;
    });
    saveFilesToLocalStorage(files);
    notify();
  },

  deleteFile(id: string): void {
    const file = files.find((f) => f.id === id);
    if (file) {
      invoke('delete_project_file', { name: file.name }).catch((err) => {
        console.warn('Failed to delete file from project directory:', err);
      });
    }
    files = files.filter((f) => f.id !== id);
    saveFilesToLocalStorage(files);
    notify();
  },

  renameFile(id: string, newName: string): void {
    const file = files.find((f) => f.id === id);
    if (!file || file.name === newName) return;
    const oldName = file.name;

    // Check for name conflict
    const targetExists = files.some((f) => f.id !== id && f.name === newName)
      || folders.includes(newName);
    let resolvedName = newName;
    if (targetExists) {
      const fileName = newName.split('/').pop() || newName;
      const parentFolder = newName.includes('/') ? newName.split('/').slice(0, -1).join('/') : '';
      const uniqueName = this.getUniqueName(fileName, parentFolder || undefined);
      resolvedName = parentFolder ? parentFolder + '/' + uniqueName : uniqueName;
    }

    invoke('move_project_file', { oldName, newName: resolvedName }).catch((err) => {
      console.warn('Failed to move file on disk:', err);
    });

    files = files.map((f) => (f.id === id ? { ...f, name: resolvedName, filePath: resolvedName } : f));
    saveFilesToLocalStorage(files);
    notify();
  },

  /** Move a file to a new path (to a different folder). Auto-renames if target exists. */
  moveFile(id: string, newPath: string): void {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    const oldName = file.name;
    if (oldName === newPath) return;

    // Check for name conflict at target
    const targetExists = files.some((f) => f.id !== id && f.name === newPath)
      || folders.includes(newPath);
    let resolvedPath = newPath;
    if (targetExists) {
      const fileName = newPath.split('/').pop() || newPath;
      const parentFolder = newPath.includes('/') ? newPath.split('/').slice(0, -1).join('/') : '';
      const uniqueName = this.getUniqueName(fileName, parentFolder || undefined);
      resolvedPath = parentFolder ? parentFolder + '/' + uniqueName : uniqueName;
    }

    invoke('move_project_file', { oldName, newName: resolvedPath }).catch((err) => {
      console.warn('Failed to move file on disk:', err);
    });

    files = files.map((f) =>
      f.id === id ? { ...f, name: resolvedPath, filePath: resolvedPath } : f
    );
    saveFilesToLocalStorage(files);
    notify();
  },

  /** Move/rename a folder. Auto-renames if target folder already exists. */
  moveFolder(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    const prefix = oldPath + '/';

    // Check for name conflict: target folder or file with same name exists
    const targetExists = folders.includes(newPath)
      || files.some((f) => f.name === newPath || f.name.startsWith(newPath + '/'));
    let resolvedPath = newPath;
    if (targetExists) {
      const folderName = newPath.split('/').pop() || newPath;
      const parentFolder = newPath.includes('/') ? newPath.split('/').slice(0, -1).join('/') : '';
      const uniqueName = this.getUniqueName(folderName, parentFolder || undefined);
      resolvedPath = parentFolder ? parentFolder + '/' + uniqueName : uniqueName;
    }

    invoke('move_project_folder', { oldName: oldPath, newName: resolvedPath }).catch((err) => {
      console.warn('Failed to move folder on disk:', err);
    });

    // Update all files under the moved folder
    files = files.map((f) => {
      if (f.name === oldPath || f.name.startsWith(prefix)) {
        const newName = f.name === oldPath ? resolvedPath : resolvedPath + '/' + f.name.slice(prefix.length);
        return { ...f, name: newName, filePath: newName };
      }
      return f;
    });
    saveFilesToLocalStorage(files);

    // Update tracked folders
    folders = folders.map((f) => {
      if (f === oldPath) return resolvedPath;
      if (f.startsWith(prefix)) return resolvedPath + '/' + f.slice(prefix.length);
      return f;
    });
    saveFoldersToLocalStorage(folders);

    notify();
  },

  /** Move multiple files to a target folder */
  moveFilesToFolder(fileIds: string[], targetFolder: string): void {
    for (const id of fileIds) {
      const file = files.find((f) => f.id === id);
      if (!file) continue;
      const fileName = file.name.split('/').pop() || file.name;
      const newPath = targetFolder ? targetFolder + '/' + fileName : fileName;
      this.moveFile(id, newPath);
    }
  },

  /** Generate a unique name by adding numbered suffix if the name already exists */
  getUniqueName(name: string, targetFolder?: string): string {
    const prefix = targetFolder ? targetFolder + '/' : '';
    const isFile = name.includes('.');
    let base: string;
    let ext: string;

    if (isFile) {
      const lastDot = name.lastIndexOf('.');
      base = name.substring(0, lastDot);
      ext = name.substring(lastDot);
    } else {
      base = name;
      ext = '';
    }

    // Check if name already exists (among files and folders in the target folder)
    const allNames = new Set<string>();
    for (const f of files) {
      if (!targetFolder || f.name.startsWith(prefix)) {
        const rel = targetFolder ? f.name.slice(prefix.length) : f.name;
        allNames.add(rel);
      }
    }
    for (const f of folders) {
      if (!targetFolder || f.startsWith(prefix)) {
        const rel = targetFolder ? f.slice(prefix.length) : f;
        // Only consider direct children
        if (!rel.includes('/')) {
          allNames.add(rel);
        }
      }
    }

    let candidate = name;
    let counter = 1;
    while (allNames.has(candidate)) {
      candidate = `${base} (${counter})${ext}`;
      counter++;
    }
    return candidate;
  },

  /** Copy a file to the same folder with auto-incremented name, or to a target folder */
  copyFile(fileId: string, targetFolder?: string): FileEntry | null {
    const file = files.find((f) => f.id === fileId);
    if (!file) return null;

    const fileName = file.name.split('/').pop() || file.name;
    const parentFolder = targetFolder ?? (file.name.includes('/') ? file.name.split('/').slice(0, -1).join('/') : '');
    const uniqueName = this.getUniqueName(fileName, parentFolder || undefined);
    const newPath = parentFolder ? parentFolder + '/' + uniqueName : uniqueName;

    invoke('copy_project_file', { source: file.name, dest: newPath }).catch((err) => {
      console.warn('Failed to copy file on disk:', err);
    });

    const entry: FileEntry = {
      id: generateId(),
      name: newPath,
      filePath: newPath,
      content: file.content,
      circuitJson: null,
      importedAt: Date.now(),
      status: 'pending',
      definedModules: file.definedModules ? [...file.definedModules] : undefined,
      moduleBindings: file.moduleBindings ? { ...file.moduleBindings } : undefined,
    };
    files = [...files, entry];
    saveFilesToLocalStorage(files);
    notify();
    return entry;
  },

  /** Copy a folder and all its contents to the same parent with auto-incremented name, or to a target folder */
  copyFolder(sourcePath: string, targetFolder?: string): string | null {
    const folderName = sourcePath.split('/').pop() || sourcePath;
    const parentFolder = targetFolder ?? (sourcePath.includes('/') ? sourcePath.split('/').slice(0, -1).join('/') : '');
    const uniqueName = this.getUniqueName(folderName, parentFolder || undefined);
    const newPath = parentFolder ? parentFolder + '/' + uniqueName : uniqueName;

    invoke('copy_project_folder', { source: sourcePath, dest: newPath }).catch((err) => {
      console.warn('Failed to copy folder on disk:', err);
    });

    const prefix = sourcePath + '/';
    const newPrefix = newPath + '/';

    // Copy all files under the folder
    const newFiles: FileEntry[] = [];
    for (const f of files) {
      if (f.name === sourcePath || f.name.startsWith(prefix)) {
        const newName = f.name === sourcePath ? newPath : newPrefix + f.name.slice(prefix.length);
        newFiles.push({
          id: generateId(),
          name: newName,
          filePath: newName,
          content: f.content,
          circuitJson: null,
          importedAt: Date.now(),
          status: 'pending',
          definedModules: f.definedModules ? [...f.definedModules] : undefined,
          moduleBindings: f.moduleBindings ? { ...f.moduleBindings } : undefined,
        });
      }
    }
    files = [...files, ...newFiles];
    saveFilesToLocalStorage(files);

    // Track the new folder and its subfolders
    folders = [...folders, newPath];
    for (const f of folders) {
      if (f.startsWith(prefix)) {
        const newFolder = newPrefix + f.slice(prefix.length);
        if (!folders.includes(newFolder)) {
          folders = [...folders, newFolder];
        }
      }
    }
    saveFoldersToLocalStorage(folders);

    notify();
    return newPath;
  },

  /** Load files from project directory on startup, with retry for IPC readiness */
  async loadFromProjectDir(): Promise<void> {
    if (initialized) return;
    initialized = true;

    const tryLoad = async (retries: number): Promise<void> => {
      try {
        // Use list_project_tree to get both files and folders
        const tree = await invoke<{ files: Array<{ name: string; size: number; modified: number }>; folders: string[] }>(
          'list_project_tree'
        );

        // Merge folders from disk with locally tracked folders
        const diskFolders = new Set(folders);
        for (const f of tree.folders) {
          diskFolders.add(f);
        }
        folders = Array.from(diskFolders).sort();
        saveFoldersToLocalStorage(folders);

        for (const info of tree.files) {
          if (files.some((f) => f.name === info.name)) continue;

          try {
            const content = await invoke<string>('read_project_file', { name: info.name });
            const modules = parseVerilogModules(content);
            const entry: FileEntry = {
              id: generateId(),
              name: info.name,
              filePath: info.name,
              content,
              circuitJson: null,
              importedAt: info.modified || Date.now(),
              status: 'pending',
              definedModules: modules,
            };
            files = [...files, entry];
          } catch (err) {
            console.warn(`Failed to read project file '${info.name}':`, err);
          }
        }
        saveFilesToLocalStorage(files);
        notify();
      } catch (err) {
        console.warn(`Failed to list project files (retries left: ${retries}):`, err);
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 800));
          return tryLoad(retries - 1);
        }
      }
    };

    await tryLoad(3);
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};