// Project configuration store
// Reads/writes verilog-viz.config.json in the project directory via Tauri backend

import { invoke } from '@tauri-apps/api/core';

export interface ProjectConfig {
  topModule?: string;
  defaultView?: 'circuit' | 'code';
  yosysOptions?: string;
  compilerOptions?: {
    noFlatten?: boolean;
    noOpt?: boolean;
  };
}

const defaultConfig: ProjectConfig = {
  defaultView: 'circuit',
};

let config: ProjectConfig = { ...defaultConfig };
let listeners: Array<() => void> = [];
let loaded = false;

function notify() {
  listeners.forEach((fn) => fn());
}

export const projectConfigStore = {
  get(): ProjectConfig {
    return config;
  },

  async load(): Promise<ProjectConfig> {
    if (loaded) return config;
    try {
      const raw = await invoke<string>('read_project_config', {});
      if (raw) {
        config = { ...defaultConfig, ...JSON.parse(raw) };
      }
    } catch {
      // Config file doesn't exist yet, use defaults
      config = { ...defaultConfig };
    }
    loaded = true;
    notify();
    return config;
  },

  async save(): Promise<void> {
    try {
      const json = JSON.stringify(config, null, 2);
      await invoke('save_project_config', { content: json });
    } catch (err) {
      console.warn('Failed to save project config:', err);
    }
  },

  update(updates: Partial<ProjectConfig>): void {
    config = { ...config, ...updates };
    notify();
    this.save();
  },

  setTopModule(module: string | undefined): void {
    this.update({ topModule: module });
  },

  setDefaultView(view: 'circuit' | 'code'): void {
    this.update({ defaultView: view });
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};