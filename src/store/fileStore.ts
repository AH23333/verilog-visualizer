// File metadata and management store
// Stores imported Verilog files in memory with Tauri-backed project directory persistence

import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  id: string;
  name: string;
  content: string;
  circuitJson: any | null;
  importedAt: number;
  status: 'pending' | 'compiled' | 'error';
  errorMessage?: string;
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

  addFile(name: string, content: string): FileEntry {
    const entry: FileEntry = {
      id: generateId(),
      name,
      content,
      circuitJson: null,
      importedAt: Date.now(),
      status: 'pending',
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

  updateFile(id: string, updates: Partial<FileEntry>): void {
    files = files.map((f) => (f.id === id ? { ...f, ...updates } : f));
    saveFilesToLocalStorage(files);
    notify();
  },

  deleteFile(id: string): void {
    const file = files.find((f) => f.id === id);
    if (file) {
      // Delete from project directory via Tauri backend
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
      // Save with new name, delete old
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
          // Skip if already loaded
          if (files.some((f) => f.name === info.name)) continue;

          try {
            const content = await invoke<string>('read_project_file', { name: info.name });
            const entry: FileEntry = {
              id: generateId(),
              name: info.name,
              content,
              circuitJson: null,
              importedAt: info.modified || Date.now(),
              status: 'pending',
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
          // Retry after delay — Tauri IPC may not be ready immediately
          await new Promise((r) => setTimeout(r, 800));
          return tryLoad(retries - 1);
        }
      }
    };

    // Initial attempt with 3 retries
    await tryLoad(3);
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};