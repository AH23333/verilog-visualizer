/**
 * 宿主中立调用层。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────
 * 电路画布（digitaljs/joint）与全部 React 渲染代码在 VS Code webview 里跑，换宿主⛔ 要重写它们。
 * 真正要换的只有"谁提供配置、另存对话框、Problems/Output 通道"。
 * 片 5（全面原生）后接口从 18 颗收到 **6 颗**：文件管理归原生 Explorer、配置归
 * contributes.configuration、剪贴板归编辑器——旧 React UI 的那批 RPC 随退役一起删了
 * （找回旧接口：`git log` 到"弃旧 UI"之前的提交）。
 *   · `vscodeHost`   Webview 里经 `postMessage` 走 Extension Host（**唯一主宿主**）
 *   · `browserHost`  浏览器（dev / 无头闸门）——**必须"抛错"而不是返回空结果**，见下
 *
 * ── 三条不能错的形状（都是读代码/实测确认的，⛔ 猜的）────────────
 * 1. **探测必须每次现读**：`r12-export` 的 [F] 三格是在**点击前**往 window 上注入
 *    `acquireVsCodeApi` 桩，用来验证"生产路径走宿主原生另存为、⛔ `<a download>`"。
 *    模块加载期求值会把那三格变成永远测不到 vscode 分支。
 * 2. **browserHost 的能力类方法要 reject，⛔ 返回空结果**：调用方 `.catch(console.warn)` 靠
 *    rejection 区分"宿主没有"与"宿主说没有"；返回空表/空串会把失败伪装成成功。
 * 3. **消息是 JSON 序列化的**：`Uint8Array` 直接发会变一串数字甚至丢类型 ⇒ 导出字节走 **base64**。
 */

export type HostId = 'vscode' | 'browser';

import type { SandboxSettings } from '../../store/settingsStore';

/** Settings UI（contributes.configuration）的全量快照（dispatch.getConfig 的形状） */
export interface HostConfig {
  compile: {
    topModule?: string;
    yosysOptions?: string;
    noFlatten: boolean;
    noOpt: boolean;
    autoRecompile: boolean;
  };
  sandbox: SandboxSettings;
  /** R146 绑定策略（verilogViz.bindings.policy）：auto＝同名兜底+可见；strict＝未录入⛔ 兜底 */
  bindings?: { policy: 'auto' | 'strict' };
  /** 画布字号跟随原生 editor.fontSize（不给自选项） */
  editorFontSize?: number;
}

/** 宿主不支持某个能力时抛这一颗：调用方现有的 `.catch(console.warn)` 全部照旧生效。 */
export class HostUnsupported extends Error {
  constructor(method: string, host: HostId) {
    super(`宿主 ${host} 不支持 ${method}`);
    this.name = 'HostUnsupported';
  }
}

/**
 * 统一调用层的接口面（片 5：6 颗）。
 * 所有方法都是"尽力而为"：失败要么抛 `HostUnsupported`，要么抛宿主原始错误，
 * 由调用方决定吞掉还是提示。
 */
export interface ProjectHost {
  readonly id: HostId;

  /* Settings UI → 画布：启动拉一次全量；后续由宿主推送 configChanged（settingsStore patch） */
  getConfig(): Promise<HostConfig>;

  /* "另存为"式导出：用户取消返回 false（⛔ 抛错——取消是正常下落）。
     mime 是给调用方语义用的（文件类型与某些浏览器的另存行为靠它）。 */
  saveExportFile(bytes: Uint8Array, defaultName: string, mime: string): Promise<boolean>;

  /* Problems/Output 的 workbench 接管（片 4）：vscode 档落 DiagnosticCollection / OutputChannel。 */
  publishProblems(items: ProblemItem[]): Promise<void>;
  appendOutput(text: string): Promise<void>;

  /* 画布 → 沙盒：主电路 + 全部子部件一批落成工作区 `.djs`（`folder/name` 形式），
     返回落盘名（沙盒树经 watcher 自刷）。片 5-B2：子部件化回到这一颗。 */
  copyToSandbox(files: Array<{ name: string; content: string }>): Promise<string[]>;

  /* 旧版 localStorage 档 → 工作区真文件（一次性迁移，B1）：宿主按名落盘，返回落盘名。 */
  importLegacyData(items: Array<{ name: string; content: string }>): Promise<string[]>;

  /* 绑定关系（R137 目录级）：celltype→部件文件，落**各目录**的 `.verilogviz.json` bindings 段
     （仿 .vscode/settings.json 层级：文档目录 → … → 项目根逐级合并，近层覆盖；值相对本层目录）。
     getAllBindings(doc)：带文档名走链合并（webview 画布用）；不带＝项目根表（兼容）。 */
  getAllBindings(doc?: string): Promise<Record<string, string>>;
  setDocBindings(docName: string, bindings: Record<string, string>): Promise<void>;

  /* 画布双击器件 → 跳回源码行 */
  jumpToSource(file: string, line: number): Promise<void>;
}

/** 一条编译问题（line=null 表示给不出行，⛔ 冒充第 1 行） */
export interface ProblemItem {
  fileName: string;
  line: number | null;
  message: string;
  severity: 'error' | 'warning';
}

/** VS Code Webview 里注入的取桥函数（一个会话只允许调用一次，见 vscodeHost 的缓存） */
const vscodeBridgeMarker = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).acquireVsCodeApi === 'function';

/**
 * 当前该用哪个宿主。**每次调用现读**（见文件头形状 1）。
 * 两个实现各自惰性 import：浏览器与测试环境里不许把宿主代码强推进主包。
 */
let cached: { id: HostId, host: ProjectHost } | null = null;
export async function getHost(): Promise<ProjectHost> {
  const id: HostId = vscodeBridgeMarker() ? 'vscode' : 'browser';
  if (cached && cached.id === id) return cached.host;
  const host: ProjectHost = id === 'vscode'
    ? (await import('./vscodeHost')).vscodeHost
    : (await import('./browserHost')).browserHost;
  cached = { id, host };
  return host;
}

/** 同步版：只回答"这是什么宿主"（同样每次现读）。 */
export function hostId(): HostId {
  return vscodeBridgeMarker() ? 'vscode' : 'browser';
}

/**
 * 后台尽力而为（fire-and-forget）——写 Problems/Output 全是这个形状：不等结果、失败 `console.warn`。
 * 第一个参数原样当 warn 的前缀文本用：那些 `'Failed to ...'` 语句是有人在读的，⛔ 换措辞。
 */
export function hostFire(warnPrefix: string, run: (h: ProjectHost) => Promise<unknown>): void {
  getHost()
    .then(run)
    .catch((err) => console.warn(warnPrefix, err));
}
