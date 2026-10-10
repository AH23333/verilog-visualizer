// Global settings store
// Manages font size, default view mode, sandbox options, and other UI preferences

const FONT_SIZE_KEY = 'verilog-viz-font-size';
const DEFAULT_VIEW_KEY = 'verilog-viz-default-view';
const SANDBOX_KEY = 'verilog-viz-sandbox-settings';
const AUTOSAVE_KEY = 'verilog-viz-autosave-settings';

export type ViewMode = 'circuit' | 'code' | 'split' | 'sandbox';

/** 自动保存设置（两模式共用）：编译编辑器与沙盒画布都按此开关/间隔落盘。
 *  关掉后仍会在「手动保存 / 切档 / 卸载 / 关窗」时落盘（不会因关闭自动保存而丢正在看的内容）。 */
export interface AutosaveSettings {
  enabled: boolean;
  intervalMs: number;
}

const DEFAULT_AUTOSAVE: AutosaveSettings = { enabled: true, intervalMs: 2000 };

/** 间隔可选项（ms）—— 面板下拉用 */
export const AUTOSAVE_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000, 30000];


export interface SandboxSettings {
  /** 网格间距（px） */
  gridSize: number;
  /** 是否显示网格 */
  showGrid: boolean;
  /** 拖动部件时是否吸附到网格 */
  snapToGrid: boolean;
  /** 连线走线方式 */
  wireStyle: 'metro' | 'orthogonal' | 'straight';
  /** 新建 IO 部件的默认位宽 */
  defaultBits: number;
  /** 打开沙盒时自动运行仿真 */
  autoStartSim: boolean;
  /** 仿真步进间隔（ms）—— 波形调试速度，与编译模式的 SPEED 滑条同一量纲 */
  simSpeedMs: number;
  /** 只读视图（编译主视图/展开图/钻取）把「运算器 + Constant 喂入」折叠成 +5 圆圈（R114，不改存档） */
  foldConstants: boolean;
}

const DEFAULT_SANDBOX: SandboxSettings = {
  gridSize: 16,
  showGrid: true,
  snapToGrid: true,
  wireStyle: 'metro',
  defaultBits: 1,
  autoStartSim: true,
  simSpeedMs: 10,
  foldConstants: true,
};

function getSavedFontSize(): number {
  try {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (n >= 8 && n <= 36) return n;
    }
  } catch {}
  return 16;
}

function getSavedDefaultView(): ViewMode {
  try {
    const saved = localStorage.getItem(DEFAULT_VIEW_KEY);
    if (saved === 'code' || saved === 'circuit') return saved;
  } catch {}
  return 'circuit';
}

function getSavedSandbox(): SandboxSettings {
  try {
    const raw = localStorage.getItem(SANDBOX_KEY);
    if (raw) return { ...DEFAULT_SANDBOX, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SANDBOX };
}

function getSavedAutosave(): AutosaveSettings {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const intervalMs = Math.min(60000, Math.max(500, Number(p.intervalMs) || DEFAULT_AUTOSAVE.intervalMs));
      return { enabled: p.enabled !== false, intervalMs };
    }
  } catch {}
  return { ...DEFAULT_AUTOSAVE };
}

let fontSize: number = getSavedFontSize();
let defaultViewMode: ViewMode = getSavedDefaultView();
let sandbox: SandboxSettings = getSavedSandbox();
let autosave: AutosaveSettings = getSavedAutosave();
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((fn) => fn());
}

// Apply font size to document root
function applyFontSize(size: number) {
  document.documentElement.style.fontSize = `${size}px`;
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
}

applyFontSize(fontSize);

export const settingsStore = {
  getFontSize(): number {
    return fontSize;
  },

  setFontSize(size: number): void {
    fontSize = Math.min(36, Math.max(8, size));
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    applyFontSize(fontSize);
    notify();
  },

  increaseFontSize(): void {
    this.setFontSize(fontSize + 1);
  },

  decreaseFontSize(): void {
    this.setFontSize(fontSize - 1);
  },

  resetFontSize(): void {
    this.setFontSize(16);
  },

  getDefaultViewMode(): ViewMode {
    return defaultViewMode;
  },

  setDefaultViewMode(mode: ViewMode): void {
    defaultViewMode = mode;
    localStorage.setItem(DEFAULT_VIEW_KEY, mode);
    notify();
  },

  // ---- Sandbox options ----
  getSandboxSettings(): SandboxSettings {
    return { ...sandbox };
  },

  setSandboxSettings(patch: Partial<SandboxSettings>): void {
    sandbox = { ...sandbox, ...patch };
    try { localStorage.setItem(SANDBOX_KEY, JSON.stringify(sandbox)); } catch {}
    notify();
  },

  resetSandboxSettings(): void {
    sandbox = { ...DEFAULT_SANDBOX };
    try { localStorage.setItem(SANDBOX_KEY, JSON.stringify(sandbox)); } catch {}
    notify();
  },

  // ---- Autosave（两模式共用）----
  getAutosaveSettings(): AutosaveSettings {
    return { ...autosave };
  },

  setAutosaveSettings(patch: Partial<AutosaveSettings>): void {
    const next = { ...autosave, ...patch };
    next.intervalMs = Math.min(60000, Math.max(500, Number(next.intervalMs) || DEFAULT_AUTOSAVE.intervalMs));
    autosave = next;
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autosave)); } catch {}
    notify();
  },

  resetAutosaveSettings(): void {
    autosave = { ...DEFAULT_AUTOSAVE };
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autosave)); } catch {}
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};
