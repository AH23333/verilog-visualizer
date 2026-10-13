/**
 * VS Code Webview 侧的宿主实现（迁移第一步只出**客户端协议 + 类型**，
 * Extension Host 的处理器在 `extension/src/extension.ts`，本文件与它共用一份方法名表）。
 *
 * ── 为什么方法是 async RPC 而不是直接调 API ────────────────────────
 * Webview 里没有 `vscode.*`：文件、对话框、密钥、输出通道都在 Extension Host（Node）进程。
 * 唯一通道是 `acquireVsCodeApi().postMessage()`，一问一答要自己配对 ⇒ 这里实现成
 * 带序号的 RPC（`req/res` + pending map + 超时），⛔ 用"最后一条回复"当结果（并发调用会串号）。
 *
 * ── 三条实测/规范形状 ────────────────────────────────────────────
 * 1. **`acquireVsCodeApi()` 一个会话只准调一次**（VS Code 会抛"已调用过"）⇒ 结果缓存在模块里。
 * 2. **消息是 JSON 序列化的**：`Uint8Array` 直接发会变一串数字甚至丢类型 ⇒ 导出字节走 **base64**。
 * 3. **`saveExportFile` 等用户点对话框**，不能上短超时：这一颗给 5 分钟，其余 20 秒。
 *    用户在对话框里取消 ＝ 正常下落，Extension Host 回 `data:false`，⛔ 回 error。
 *
 * 窗口控制在这一档不存在（VS Code 自带标题栏），直接抛 `HostUnsupported`。
 */
import { HostUnsupported, type ProjectHost, type ProjectTree } from './host';

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
  hasWindowControls: false,

  saveProjectFile: (name, content) => rpc<void>('saveProjectFile', { name, content }),
  listProjectTree: () => rpc<ProjectTree>('listProjectTree'),
  readProjectFile: (name) => rpc<string>('readProjectFile', { name }),
  deleteProjectFile: (name) => rpc<void>('deleteProjectFile', { name }),
  createProjectFolder: (name) => rpc<void>('createProjectFolder', { name }),
  deleteProjectFolder: (name) => rpc<void>('deleteProjectFolder', { name }),
  moveProjectFile: (oldName, newName) => rpc<void>('moveProjectFile', { oldName, newName }),
  moveProjectFolder: (oldName, newName) => rpc<void>('moveProjectFolder', { oldName, newName }),
  copyProjectFile: (source, dest) => rpc<void>('copyProjectFile', { source, dest }),
  copyProjectFolder: (source, dest) => rpc<void>('copyProjectFolder', { source, dest }),

  readProjectConfig: () => rpc<string>('readProjectConfig'),
  saveProjectConfig: (content) => rpc<void>('saveProjectConfig', { content }),

  // 5 分钟：等用户在"另存为"对话框里操作（取消＝data:false，不是错误）
  saveExportFile: async (bytes, defaultName, mime) =>
    rpc<boolean>('saveExportFile', { base64: bytesToBase64(bytes), defaultName, mime }, 300000),

  clipboardWrite: (text) => rpc<void>('clipboardWrite', { text }),
  clipboardRead: () => rpc<string>('clipboardRead'),

  // ⛔ 同步 throw（类型是 Promise）：改成 reject，理由见 browserHost 的 nope()
  windowIsMaximized: () => Promise.reject(new HostUnsupported('windowIsMaximized', 'vscode')),
  onWindowResize: () => Promise.reject(new HostUnsupported('onWindowResize', 'vscode')),
  windowMinimize: () => Promise.reject(new HostUnsupported('windowMinimize', 'vscode')),
  windowToggleMaximize: () => Promise.reject(new HostUnsupported('windowToggleMaximize', 'vscode')),
  windowClose: () => Promise.reject(new HostUnsupported('windowClose', 'vscode')),
};
