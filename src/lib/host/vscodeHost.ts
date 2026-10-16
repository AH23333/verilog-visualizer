/**
 * VS Code Webview 侧的宿主实现（客户端协议 + 类型，
 * Extension Host 的处理器在 `extension/src/dispatch.ts`，本文件与它共用一份方法名表）。
 *
 * ── 为什么方法是 async RPC 而不是直接调 API ────────────────────────
 * Webview 里没有 `vscode.*`：配置、对话框、输出通道都在 Extension Host（Node）进程。
 * 唯一通道是 `acquireVsCodeApi().postMessage()`，一问一答要自己配对 ⇒ 这里实现成
 * 带序号的 RPC（`req/res` + pending map + 超时），⛔ 用"最后一条回复"当结果（并发调用会串号）。
 *
 * ── 三条实测/规范形状 ────────────────────────────────────────────
 * 1. **`acquireVsCodeApi()` 一个会话只准调一次**（VS Code 会抛"已调用过"）⇒ 结果缓存在模块里。
 * 2. **消息是 JSON 序列化的**：`Uint8Array` 直接发会变一串数字甚至丢类型 ⇒ 导出字节走 **base64**。
 * 3. **`saveExportFile` 等用户点对话框**，不能上短超时：这一颗给 5 分钟，其余 20 秒。
 *    用户在对话框里取消 ＝ 正常下落，Extension Host 回 `data:false`，⛔ 回 error。
 *
 * 宿主→webview 还有两条**单向推送**（不走 RPC 应答）：`{vvh:'push', op:'compile'|'sim'|'export'|
 * 'configChanged'}`（画布）与 `{vvh:'doc', op:'init'|'revert'}`（.djs 文档）——各自入口自己监听。
 */
import { HostUnsupported, type HostConfig, type ProjectHost } from './host';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare global {
  interface Window { acquireVsCodeApi?: () => VsCodeApi }
}

let api: VsCodeApi | null = null;
function bridge(): VsCodeApi {
  if (api) return api;
  if (typeof window === 'undefined' || typeof window.acquireVsCodeApi !== 'function') {
    throw new HostUnsupported('acquireVsCodeApi', 'vscode');
  }
  api = window.acquireVsCodeApi();
  return api;
}

let seq = 0;
const pending = new Map<string, { resolve: (v: any) => void, reject: (e: any) => void, timer: ReturnType<typeof setTimeout> }>();

/** 收到 Extension Host 的应答：按 id 认领，认领不到的忽略（可能是上一批会话的尾巴） */
function onMessage(ev: MessageEvent) {
  const d = ev.data as { vvh?: string, id?: string, ok?: boolean, data?: any, error?: string } | undefined;
  if (!d || d.vvh !== 'res' || !d.id) return;
  const wait = pending.get(d.id);
  if (!wait) return;
  pending.delete(d.id);
  clearTimeout(wait.timer);
  if (d.ok) wait.resolve(d.data);
  else wait.reject(new Error(d.error || 'Extension Host 返回失败'));
}
if (typeof window !== 'undefined') window.addEventListener('message', onMessage);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  const CH = 0x8000;                       // 分块：String.fromCharCode(...大数组) 会栈溢出
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(bin);
};

async function rpc<T>(method: string, args?: unknown, timeoutMs = 20000): Promise<T> {
  const id = `req${++seq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`VS Code 宿主调用超时：${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      bridge().postMessage({ vvh: 'req', id, method, args });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export const vscodeHost: ProjectHost = {
  id: 'vscode',

  getConfig: () => rpc<HostConfig>('getConfig'),
  // 5 分钟：等用户在"另存为"对话框里操作（取消＝data:false，不是错误）
  saveExportFile: async (bytes, defaultName, mime) =>
    rpc<boolean>('saveExportFile', { base64: bytesToBase64(bytes), defaultName, mime }, 300000),

  // 片 4（R135）：Problems/Output 的 workbench 接管——Extension Host 侧落
  // DiagnosticCollection / OutputChannel（dispatch 的 publishProblems/appendOutput 分支）。
  publishProblems: (items) => rpc<void>('publishProblems', { items }),
  appendOutput: (text) => rpc<void>('appendOutput', { text }),

  // 片 5-B2：主电路+子部件一批落成工作区 .djs（扩展侧做重名 (n) 递增；沙盒树经 watcher 自刷）
  copyToSandbox: (files) => rpc<string[]>('copyToSandbox', { files }),

  // 片 5-B1：旧 localStorage 档一次性迁成工作区真文件
  importLegacyData: (items) => rpc<string[]>('importLegacyData', { items }),

  // 片 5-B3 → R137：绑定关系按目录链解析（doc=文档相对路径；不传＝项目根表兼容旧调用）
  getAllBindings: (doc) => rpc<Record<string, string>>('getAllBindings', doc ? { doc } : {}),
  setDocBindings: (docName, bindings) => rpc<void>('setDocBindings', { docName, bindings }),

  // 片 5：画布双击器件 → 宿主开文本编辑器并滚到那一行
  jumpToSource: (file, line) => rpc<void>('jumpToSource', { file, line }),
};

/**
 * 画布就绪握手（编译画布 Panel 侧，与 DocApp 的 doc ready 同族）：
 * 宿主在 html 赋值后立刻 postMessage 会被丢（webview 没装载完，真机实测＝首编译"还没有电路"）——
 * 挂载完先发 ready，宿主这才回推挂起的那颗编译单（compilePanel.flushPendingCompile）。
 * 复用上面已缓存的 bridge（⛔ 二次 acquireVsCodeApi 会抛）。
 */
export function notifyReady(): void {
  try { bridge().postMessage({ vvh: 'push', op: 'ready' }); }
  catch { /* 非壳环境：没有编译单可等 */ }
}
