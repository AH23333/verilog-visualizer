// Global keyboard shortcut registry — single source of truth.
// App.tsx dispatches by `combo` from this table; the shortcuts help dialog
// (ShortcutsHelpDialog) renders `label`/`group` from the SAME table.
// Keep in sync with App.tsx's key handler ids when adding actions.

export interface ShortcutDef {
  /** stable id — App dispatches on this, never on the displayed text */
  id: string;
  /** display combo, e.g. "Ctrl+Shift+F" */
  combo: string;
  /** short action label (en, matches the rest of the UI) */
  label: string;
  /** section grouping for the help dialog */
  group: 'File' | 'View' | 'Sim' | 'Editor' | 'Canvas';
  /** when true the combo also applies while the code editor has focus (handled there) */
  editorOnly?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'file.import',  combo: 'Ctrl+O',             label: '导入 Verilog 文件',  group: 'File' },
  { id: 'file.new',     combo: 'Ctrl+N',             label: '新建文件',         group: 'File' },
  { id: 'file.save',    combo: 'Ctrl+S',             label: '保存当前文件',       group: 'File' },
  { id: 'file.compile', combo: 'F5',                 label: '编译当前文件',    group: 'File' },
  { id: 'app.quit',     combo: 'Alt+F4',             label: '关闭应用',               group: 'File' },

  { id: 'view.sidebar',        combo: 'Ctrl+B',          label: '切换侧栏',           group: 'View' },
  { id: 'view.output',         combo: 'Ctrl+J',          label: '切换输出面板',      group: 'View' },
  { id: 'view.shortcutsHelp',  combo: 'Ctrl+/',          label: '快捷键帮助',  group: 'View' },
  { id: 'view.commandPalette', combo: 'Ctrl+Shift+P',    label: '命令面板',          group: 'View' },
  { id: 'sim.stepOnce',        combo: 'F7',              label: '单步推进一个时钟沿',      group: 'Sim' },

  { id: 'editor.undo',   combo: 'Ctrl+Z',        label: '撤销（编辑器）',          group: 'Editor', editorOnly: true },
  { id: 'editor.redo',   combo: 'Ctrl+Y',        label: '重做（编辑器）',          group: 'Editor', editorOnly: true },
  { id: 'editor.find',   combo: 'Ctrl+F',        label: '查找 / 替换（编辑器）', group: 'Editor', editorOnly: true },
  { id: 'editor.zoomIn',   combo: 'Ctrl+=',        label: '增大字号',    group: 'Editor', editorOnly: true },
  { id: 'editor.zoomOut',  combo: 'Ctrl+-',        label: '减小字号',    group: 'Editor', editorOnly: true },
  { id: 'editor.zoomReset', combo: 'Ctrl+0',       label: '重置字号',       group: 'Editor', editorOnly: true },

  { id: 'edit.selected.copy', combo: 'Ctrl+C', label: '复制选中文件', group: 'File' },
  { id: 'edit.selected.cut',  combo: 'Ctrl+X', label: '剪切选中文件',  group: 'File' },
  { id: 'edit.selected.paste', combo: 'Ctrl+V', label: '粘贴文件',        group: 'File' },
  { id: 'edit.selected.delete', combo: 'Delete', label: '删除选中文件', group: 'File' },

  { id: 'search.global', combo: 'Ctrl+Shift+F', label: '全局搜索', group: 'View' },
  { id: 'canvas.fit',  combo: 'Shift+F',  label: '电路适应窗口（画布）', group: 'View' },

  { id: 'canvas.help', combo: 'Wheel', label: '滚轮：缩放 · 右键拖拽：平移 · 点击开关进行仿真（解锁后） · 双击 → 跳转到源码 · 右键子模块单元 → 进入 · 电路按钮高亮光标行对应元件', group: 'Canvas' },
];

export const SHORTCUT_GROUPS: ShortcutDef['group'][] = ['File', 'View', 'Editor', 'Canvas'];

/** Does an event match a registry combo? Handles Ctrl/Alt/Shift modifiers + F-keys + plain keys. */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const wantCtrl = parts.includes('Ctrl') || parts.includes('Mod');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt');
  const gotCtrl = e.ctrlKey || e.metaKey;
  if (wantCtrl !== gotCtrl) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  // normalize letter case (Shift+letter yields uppercase e.key)
  const gotKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const wantKey = key.length === 1 ? key.toLowerCase() : key;
  // Ctrl+= arrives as '=' ; Ctrl+- as '-'; Ctrl+[ etc. — covered by direct compare.
  return gotKey === wantKey;
}
