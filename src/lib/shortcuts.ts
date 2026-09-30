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
  { id: 'file.import',  combo: 'Ctrl+O',             label: 'Import Verilog file(s)',  group: 'File' },
  { id: 'file.new',     combo: 'Ctrl+N',             label: 'Create new file',         group: 'File' },
  { id: 'file.save',    combo: 'Ctrl+S',             label: 'Save current file',       group: 'File' },
  { id: 'file.compile', combo: 'F5',                 label: 'Compile current file',    group: 'File' },
  { id: 'app.quit',     combo: 'Alt+F4',             label: 'Close app',               group: 'File' },

  { id: 'view.sidebar',        combo: 'Ctrl+B',          label: 'Toggle sidebar',           group: 'View' },
  { id: 'view.output',         combo: 'Ctrl+J',          label: 'Toggle output panel',      group: 'View' },
  { id: 'view.shortcutsHelp',  combo: 'Ctrl+/',          label: 'Keyboard shortcuts help',  group: 'View' },

  { id: 'editor.undo',   combo: 'Ctrl+Z',        label: 'Undo (editor)',          group: 'Editor', editorOnly: true },
  { id: 'editor.redo',   combo: 'Ctrl+Y',        label: 'Redo (editor)',          group: 'Editor', editorOnly: true },
  { id: 'editor.find',   combo: 'Ctrl+F',        label: 'Find / replace (editor)', group: 'Editor', editorOnly: true },
  { id: 'editor.zoomIn',   combo: 'Ctrl+=',        label: 'Increase font size',    group: 'Editor', editorOnly: true },
  { id: 'editor.zoomOut',  combo: 'Ctrl+-',        label: 'Decrease font size',    group: 'Editor', editorOnly: true },
  { id: 'editor.zoomReset', combo: 'Ctrl+0',       label: 'Reset font size',       group: 'Editor', editorOnly: true },

  { id: 'edit.selected.copy', combo: 'Ctrl+C', label: 'Copy selected file(s)', group: 'File' },
  { id: 'edit.selected.cut',  combo: 'Ctrl+X', label: 'Cut selected file(s)',  group: 'File' },
  { id: 'edit.selected.paste', combo: 'Ctrl+V', label: 'Paste file(s)',        group: 'File' },
  { id: 'edit.selected.delete', combo: 'Delete', label: 'Delete selected file(s)', group: 'File' },

  { id: 'search.global', combo: 'Ctrl+Shift+F', label: 'Global search', group: 'View' },
  { id: 'canvas.fit',  combo: 'Shift+F',  label: 'Fit circuit to window (canvas)', group: 'View' },

  { id: 'canvas.help', combo: 'Wheel', label: 'Scroll wheel: zoom · Right-drag: pan · Click switches to simulate (unlocked) · Double-click → jump to source · Right-click a sub-module cell → Enter · Circuit button glows cursor-line elements', group: 'Canvas' },
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
