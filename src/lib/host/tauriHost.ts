/** Tauri 宿主：现有实现的等价搬运（⛔ 顺手改语义——70 格闸门认的就是这些行为）。 */
import { invoke } from '@tauri-apps/api/core';
import type { ProjectHost, ProjectTree } from './host';

async function win(): Promise<any> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export const tauriHost: ProjectHost = {
  id: 'tauri',
  hasWindowControls: true,

  saveProjectFile: (name, content) => invoke('save_project_file', { name, content }),
  listProjectTree: () => invoke<ProjectTree>('list_project_tree'),
  readProjectFile: (name) => invoke<string>('read_project_file', { name }),
  deleteProjectFile: (name) => invoke('delete_project_file', { name }),
  createProjectFolder: (name) => invoke('create_project_folder', { name }),
  deleteProjectFolder: (name) => invoke('delete_project_folder', { name }),
  moveProjectFile: (oldName, newName) => invoke('move_project_file', { oldName, newName }),
  moveProjectFolder: (oldName, newName) => invoke('move_project_folder', { oldName, newName }),
  copyProjectFile: (source, dest) => invoke('copy_project_file', { source, dest }),
  copyProjectFolder: (source, dest) => invoke('copy_project_folder', { source, dest }),

  readProjectConfig: () => invoke<string>('read_project_config', {}),
  saveProjectConfig: (content) => invoke('save_project_config', { content }),

  // 用户在系统保存对话框里取消 → Rust 返回 null → false（⛔ 抛错：取消是正常下落）。
  // mime 在这一档没用：Rust 侧按 defaultName 的后缀给对话框配过滤器。
  saveExportFile: async (bytes, defaultName) => {
    const path = await invoke<string | null>('save_export_file', {
      content: Array.from(bytes), defaultName,
    });
    return path != null;
  },

  clipboardWrite: (text) => invoke('plugin:clipboard-manager|write_text', { text }),
  clipboardRead: () => invoke<string>('plugin:clipboard-manager|read_text'),

  windowIsMaximized: async () => (await win()).isMaximized(),
  onWindowResize: async (cb) => {
    const fn = await (await win()).onResized(() => { cb(); });
    return fn;
  },
  windowMinimize: async () => { await (await win()).minimize(); },
  windowToggleMaximize: async () => { await (await win()).toggleMaximize(); },
  windowClose: async () => { await (await win()).close(); },
};
