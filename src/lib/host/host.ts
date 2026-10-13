/**
 * 宿主中立调用层（项目迁移第一步的落点，2026-10-13 用户令：改 VS Code 套壳、统一调用层，
 * 暂不搭 agent 功能）。
 *
 * ── 为什么先做这一层 ──────────────────────────────────────────────
 * 架构文档（`AGENT_PRODUCT_ARCHITECTURE.md` §9.6）把迁移成本封在"宿主胶水"这一层：
 * 电路画布（digitaljs/joint）与全部 React 渲染代码在 Tauri 与 VS Code 里跑的是同一个
 * Webview，⛔ 不需要重写。真正要换的只有"谁提供文件、剪贴板、保存对话框、标题栏"。
 * 此前这些能力直接从 4 个文件里 `invoke('...')` 打洞到 Rust 后端（实测清单见文件末），
 * 换宿主就要一处一处改。这里把它们收成**一份接口**：
 *   · `tauriHost`  现有实现的等价搬运（⛔ 顺手改语义——闸门 70 格全靠这些行为）
 *   · `vscodeHost` Webview 里经 `postMessage` 走 Extension Host（本期只出客户端协议）
 *   · `browserHost` 浏览器（dev / 无头闸门）——**必须与今天一样"抛错"**，见下
 *
 * ── 三条不能错的形状（都是读代码/实测确认的，不是猜的）────────────
 * 1. **探测必须每次现读**：`r12-export` 的 [F] 三格是在**点击前**注入
 *    `window.__TAURI_INTERNALS__` 来验证"生产路径走原生保存对话框"。模块加载期求值会把
 *    那三格变成永远测不到 Tauri 分支（`exportUtils.ts` 里原来那句注释就是为这件事写的）。
 * 2. **browserHost 的文件类方法要 reject，不许返回空表**：`fileStore.refresh()` 拿到
 *    空 `tree.files` 时会把 localStorage 里的文件**全过滤掉**（`files.filter(在磁盘上)`），
 *    浏览器里"磁盘"永远是空 ⇒ 空表＝抹掉用户的全部文件。今天的行为是 invoke 抛错 →
 *    catch → 重试 3 次，正好绕开这一支。⛔ 把"不支持"做成"空结果"。
 * 3. **剪贴板失败要有 DOM 兜底**：`CodeEditor.tsx:129-165` 现在就是"先试 Tauri 插件、
 *    失败退回 textarea 选中复制"。宿主层只负责"试一次"，兜底留在调用方（行为不变）。
 *
 * ── 实测耦合面（2026-10-13，⛔ 照文档的"5 文件 / 16 处 invoke"抄）────────
 * 前端直连 Tauri 的文件：`lib/exportUtils.ts`、`store/fileStore.ts`（14 处 invoke）、
 * `store/projectConfigStore.ts`（2 处）、`components/CodeEditor.tsx`（3 处剪贴板）、
 * `components/WindowControls.tsx`（isTauri 守卫 + 窗口控制）。Rust 侧 14 颗命令 / 402 行。
 */

export type HostId = 'tauri' | 'vscode' | 'browser';

/** 项目根里的一行文件信息（与 Rust `ProjectFileInfo` 同形，⛔ 改名要同步 lib.rs） */
export interface ProjectFileInfo { name: string, size: number, modified: number }
/** 与 Rust `ProjectTree` 同形 */
export interface ProjectTree { files: ProjectFileInfo[], folders: string[] }

/** 宿主不支持某个能力时抛这一颗：调用方现有的 `.catch(console.warn)` 全部照旧生效。 */
export class HostUnsupported extends Error {
  constructor(method: string, host: HostId) {
    super(`宿主 ${host} 不支持 ${method}`);
    this.name = 'HostUnsupported';
  }
}

/**
 * 统一调用层的接口面（按"能力"分四组，⛔ 与 Rust 命令一一对应地散着命名）。
 * 所有方法都是"尽力而为"：失败要么抛 `HostUnsupported`，要么抛宿主原始错误，
 * 由调用方决定吞掉还是提示——今天各处就是吞成 `console.warn` 的。
 */
export interface ProjectHost {
  readonly id: HostId;
  /** 自绘标题栏还有没有意义（VS Code / 浏览器里没有自己的窗口） */
  readonly hasWindowControls: boolean;

  /* 项目目录里的文件与文件夹（name 是相对项目根的路径，可含 '/'） */
  saveProjectFile(name: string, content: string): Promise<void>;
  listProjectTree(): Promise<ProjectTree>;
  readProjectFile(name: string): Promise<string>;
  deleteProjectFile(name: string): Promise<void>;
  createProjectFolder(name: string): Promise<void>;
  deleteProjectFolder(name: string): Promise<void>;
  moveProjectFile(oldName: string, newName: string): Promise<void>;
  moveProjectFolder(oldName: string, newName: string): Promise<void>;
  copyProjectFile(source: string, dest: string): Promise<void>;
  copyProjectFolder(source: string, dest: string): Promise<void>;

  /* 工程级配置（与文件目录分开的单份 JSON） */
  readProjectConfig(): Promise<string>;
  saveProjectConfig(content: string): Promise<void>;

  /* "另存为"式导出：用户取消返回 false（⛔ 抛错——取消是正常下落）。
     mime 是给浏览器 `<a download>` 的 Blob 类型用的（今天调用方就传 image/svg+xml 等，
     ⛔ 在宿主层丢掉它——文件类型与某些浏览器的另存行为靠它）。 */
  saveExportFile(bytes: Uint8Array, defaultName: string, mime: string): Promise<boolean>;

  /* 编辑器剪贴板（跨宿主都可能有权限限制，失败就抛，调用方留 DOM 兜底） */
  clipboardWrite(text: string): Promise<void>;
  clipboardRead(): Promise<string>;

  /* 窗口控制（只有自带标题栏的宿主有：VS Code / 浏览器里这颗组件根本不渲染） */
  windowIsMaximized(): Promise<boolean>;
  onWindowResize(cb: () => void): Promise<() => void>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
}

const tauriMarker = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as any);

/** VS Code Webview 里注入的取桥函数（一个会话只允许调用一次，见 vscodeHost 的缓存） */
const vscodeBridgeMarker = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).acquireVsCodeApi === 'function';

/**
 * 当前该用哪个宿主。**每次调用现读**（见文件头形状 1）。
 * 三个实现各自惰性 import：浏览器与测试环境里不许把 `@tauri-apps/*` 的代码强推进主包。
 */
let cached: { id: HostId, host: ProjectHost } | null = null;
export async function getHost(): Promise<ProjectHost> {
  const id: HostId = tauriMarker() ? 'tauri' : vscodeBridgeMarker() ? 'vscode' : 'browser';
  if (cached && cached.id === id) return cached.host;
  const host: ProjectHost = id === 'tauri'
    ? (await import('./tauriHost')).tauriHost
    : id === 'vscode'
      ? (await import('./vscodeHost')).vscodeHost
      : (await import('./browserHost')).browserHost;
  cached = { id, host };
  return host;
}

/** 同步版：只回答"这是什么宿主"，给 `isTauri()` 这类守卫用（同样每次现读）。 */
export function hostId(): HostId {
  return tauriMarker() ? 'tauri' : vscodeBridgeMarker() ? 'vscode' : 'browser';
}

/**
 * 旧的 `exportUtils.isTauri()` 语义保持不变（生产窗口里有 `__TAURI_INTERNALS__`）。
 * 留在这里是为了：⛔ 让"探测"长回某个具体文件里，下次换宿主又得挨处找。
 */
export const isTauri = tauriMarker;

/**
 * 后台尽力而为（fire-and-forget）——今天这些写盘点全是这个形状：不等结果、失败 `console.warn`。
 * 收成一个 helper 是为了让"换宿主"这件事在 5 个文件里只剩方法名差异，
 * ⛔ 顺手改成 await/加提示（那会改 `fileStore` 的时序行为，闸门里"存盘立刻可见"那几格会变）。
 * 第一个参数原样当 warn 的前缀文本用：那些 `'Failed to ...'` 语句是有人在读的，⛔ 换措辞。
 */
export function hostFire(warnPrefix: string, run: (h: ProjectHost) => Promise<unknown>): void {
  getHost()
    .then(run)
    .catch((err) => console.warn(warnPrefix, err));
}
