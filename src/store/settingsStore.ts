// Global settings store
// Manages font size, default view mode, sandbox options, and other UI preferences.
//
// 片 5（配置归 contributes.configuration）后这里**不再持久化**：初值一律内置默认，
// 真源在宿主（VS Code settings）。宿主推送的配置经 `applyHostConfig` 落进来，
// 画布/工具条照旧读 getter + subscribe 刷新。

import type { HostConfig } from '../lib/host/host';

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

let fontSize: number = 16;
let defaultViewMode: ViewMode = 'circuit';
let sandbox: SandboxSettings = { ...DEFAULT_SANDBOX };
let autosave: AutosaveSettings = { ...DEFAULT_AUTOSAVE };
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((fn) => fn());
}

// Apply font size to document root
function applyFontSize(size: number) {
  // R145：无头环境（vitest node 环境跑 gateSystem 纯逻辑单测——依赖链
  // gateSystem→sandboxStore→settingsStore 会撞这行）⛔ 摸 DOM。样式应用归样式 owner（浏览器/壳），
  // 存储层在无 DOM 处静默跳过＝本来就该有的形状。
  if (typeof document === 'undefined') return;
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
    notify();
  },

  // ---- Sandbox options ----
  getSandboxSettings(): SandboxSettings {
    return { ...sandbox };
  },

  setSandboxSettings(patch: Partial<SandboxSettings>): void {
    sandbox = { ...sandbox, ...patch };
    notify();
  },

  resetSandboxSettings(): void {
    sandbox = { ...DEFAULT_SANDBOX };
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
    notify();
  },

  resetAutosaveSettings(): void {
    autosave = { ...DEFAULT_AUTOSAVE };
    notify();
  },

  /**
   * 宿主配置落店（片 5：配置真源在 contributes.configuration）：
   * patch 沙盒设置、字号跟随 editor.fontSize。宿主每次 configChanged 都会重推全量。
   */
  applyHostConfig(cfg: HostConfig): void {
    if (cfg?.sandbox) sandbox = { ...DEFAULT_SANDBOX, ...cfg.sandbox };
    if (typeof cfg?.editorFontSize === 'number' && cfg.editorFontSize > 0) {
      fontSize = Math.min(36, Math.max(8, Math.round(cfg.editorFontSize)));
      applyFontSize(fontSize);
    }
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};
