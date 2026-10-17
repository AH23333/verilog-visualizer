// Sandbox settings store
// 旧「全局设置 store」退役后（R150 路标③：设置面板已不存在、fontSize/defaultViewMode/
// autosave 无消费方），只剩沙盒运行偏好的影子内存（真源在宿主 contributes.configuration，
// 片 5 起不再持久化）。
//
// 活接口仅四个：`applyHostConfig`（宿主全量推送落店）、`subscribe`、`getSandboxSettings`/
// `setSandboxSettings`（工具条 simSpeed 滑条 + 闸门驱动）。字号仅作为 `editorFontSize`
// 的投影保留（applyFontSize 落根字号），读写面不开。

import type { HostConfig } from '../lib/host/host';

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
let sandbox: SandboxSettings = { ...DEFAULT_SANDBOX };
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
  // ---- Sandbox options ----
  getSandboxSettings(): SandboxSettings {
    return { ...sandbox };
  },

  setSandboxSettings(patch: Partial<SandboxSettings>): void {
    sandbox = { ...sandbox, ...patch };
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
