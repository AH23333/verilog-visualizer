// File metadata and management store
// Stores imported Verilog files in memory with Tauri-backed project directory persistence

import { invoke } from '@tauri-apps/api/core';
import { parseVerilogModules } from '../lib/verilog';

export interface FileEntry {
  id: string;
  name: string;
  /** Full file path (original import path or project directory path) */
  filePath?: string;
  content: string;
  circuitJson: any | null;
  importedAt: number;
  status: 'pending' | 'compiled' | 'error' | 'missing_deps';
  errorMessage?: string;
  missingModules?: string[];
  /** Module names defined in this file (parsed from Verilog content) */
  definedModules?: string[];
  /** Manual bindings: missing-module-name → file-id that defines it */
  moduleBindings?: Record<string, string>;
}

const STORAGE_KEY = 'verilog-viz-files';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFilesFromLocalStorage(): FileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return data.map((f: any) => ({ ...f, circuitJson: null, status: 'pending' as const }));
    }
  } catch {}
  return [];
}

function saveFilesToLocalStorage(files: FileEntry[]): void {
  try {
    const toSave = files.map(({ circuitJson, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

let files: FileEntry[] = loadFilesFromLocalStorage();
let listeners: Array<() => void> = [];
let initialized = false;

function notify() {
  listeners.forEach((fn) => fn());
}

export const fileStore = {
  getAll(): FileEntry[] {
    return files;
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

  /** Create a new folder in the project directory */
  createFolder(name: string): void {
    invoke('create_project_folder', { name }).catch((err) => {
      console.warn('Failed to create folder:', err);
    });
    // No local state change needed — folders are just containers
    // The file tree will show them when files are created inside
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
    if (file) {
      const oldName = file.name;
      invoke('save_project_file', { name: newName, content: file.content }).catch(console.warn);
      if (oldName !== newName) {
        invoke('delete_project_file', { name: oldName }).catch(console.warn);
      }
    }
    files = files.map((f) => (f.id === id ? { ...f, name: newName } : f));
    saveFilesToLocalStorage(files);
    notify();
  },

  /** Load files from project directory on startup, with retry for IPC readiness */
  async loadFromProjectDir(): Promise<void> {
    if (initialized) return;
    initialized = true;

    const tryLoad = async (retries: number): Promise<void> => {
      try {
        const fileList = await invoke<Array<{ name: string; size: number; modified: number }>>(
          'list_project_files'
        );

        for (const info of fileList) {
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