// Global settings store
// Manages font size, default view mode, sandbox options, and other UI preferences

const FONT_SIZE_KEY = 'verilog-viz-font-size';
const DEFAULT_VIEW_KEY = 'verilog-viz-default-view';
const SANDBOX_KEY = 'verilog-viz-sandbox-settings';

export type ViewMode = 'circuit' | 'code' | 'split' | 'sandbox';

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
}

const DEFAULT_SANDBOX: SandboxSettings = {
  gridSize: 16,
  showGrid: true,
  snapToGrid: true,
  wireStyle: 'metro',
  defaultBits: 1,
  autoStartSim: true,
  simSpeedMs: 10,
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

let fontSize: number = getSavedFontSize();
let defaultViewMode: ViewMode = getSavedDefaultView();
let sandbox: SandboxSettings = getSavedSandbox();
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

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};
