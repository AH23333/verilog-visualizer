// ============================================================================
// 统一 API 层·读侧（CONFIG_PROTOCOL §9，阶段二）
// 内置默认契约 = 随包分发的工具账（vv-api.defaults.json，产品定义「有什么能力」）；
// 工程 `.vv/api.json` = 覆盖层（**只能收窄**：端点交集、总开关 AND、审批只许加严——§9.4 下限语义，
// 固有属性 perm/ref/sideEffects 出现在工程文件＝整份拒绝——想改属性是产品的权力，工程的权力是更严）。
// 对账锁（vscodeShell）双向钉死 rpc 投影＝dispatch 表；本文件的执行闸（dispatch 入口）是运行时第二道。
// ============================================================================
import * as vscode from 'vscode';
import defaults from '../api/vv-api.defaults.json';

export interface ApiToolDef {
  perm: string;
  sideEffects: string;
  requiresApproval?: boolean;
  surfaces: string[];
  ref: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  idempotent?: boolean;
  since?: string;
  description?: string;
}
export interface ApiContract {
  apiVersion: string;
  sources?: unknown;
  surfacesGlobal?: Record<string, boolean>;
  tools: Record<string, ApiToolDef>;
}
const DEFAULTS = defaults as ApiContract;
/** 合并后的生效契约（工程覆盖载入前＝默认账） */
let merged: ApiContract = DEFAULTS;

export function loadApiContract(): ApiContract { return merged; }

/** 端点是否可调用此工具（闸 1∧闸 2；profile 授权闸接入在 api.grants 落地刀）。 */
export function canSurface(toolId: string, surface: 'ui' | 'rpc' | 'mcp' | 'cli'): boolean {
  if ((merged.surfacesGlobal?.[surface] ?? true) === false) return false;
  const t = merged.tools[toolId];
  return !!t && t.surfaces.includes(surface);
}

/** rpc method → tool id 反查（全表 ref 匹配；surfaces 开没开交给 canSurface 判——
 *  工程把某工具 rpc 裁光时报「SURFACE_DENIED」而非「NOT_REGISTERED」，文案各归各位）。 */
export function toolIdForRpc(method: string): string | undefined {
  for (const [id, t] of Object.entries(merged.tools)) if (t.ref === method) return id;
  return undefined;
}

/**
 * 读工程层 `.vv/api.json` 并合并（只收窄）；返回被拒原因数组（合法时为空）。
 * 文件不存在＝静默（阶段一常态）。
 */
export async function loadProjectApiOverride(context: vscode.ExtensionContext): Promise<string[]> {
  const rejects: string[] = [];
  const uri = vscode.Uri.joinPath(projectRootOf(context), '.vv', 'api.json');
  let raw: string;
  try { raw = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(uri))); } catch { return rejects; }
  let proj: Partial<ApiContract> & Record<string, unknown>;
  try { proj = JSON.parse(raw); } catch { return ['api.json 解析失败：沿用默认账']; }
  // 固有属性越权检测：工程文件里出现 perm/ref/sideEffects 任一 ⇒ 整份拒绝（下限不可谈）
  const INTRINSIC = ['perm', 'ref', 'sideEffects'];
  for (const [id, t] of Object.entries((proj.tools || {}) as Record<string, any>)) {
    if (!DEFAULTS.tools[id]) { rejects.push(`未知工具 ${id}（默认账无此登记）：忽略该行`); continue; }
    const intr = INTRINSIC.filter((k) => t[k] !== undefined);
    if (intr.length) { return [`工程 api.json 试图改动固有属性 [${intr.join(',')}]（${id}）：整份拒绝，沿用默认账`]; }
  }
  const tools: Record<string, ApiToolDef> = { ...DEFAULTS.tools };
  for (const [id, ov] of Object.entries((proj.tools || {}) as Record<string, Partial<ApiToolDef>>)) {
    if (!DEFAULTS.tools[id]) continue;
    const base = DEFAULTS.tools[id];
    const surfaces = Array.isArray(ov.surfaces) ? base.surfaces.filter((s) => ov.surfaces!.includes(s)) : base.surfaces;
    tools[id] = {
      ...base,
      surfaces,
      requiresApproval: base.requiresApproval === true || ov.requiresApproval === true,   // 只许加严
      timeoutMs: ov.timeoutMs ? Math.min(base.timeoutMs ?? ov.timeoutMs, ov.timeoutMs) : base.timeoutMs,
      maxConcurrent: ov.maxConcurrent ? Math.min(base.maxConcurrent ?? ov.maxConcurrent, ov.maxConcurrent) : base.maxConcurrent,
    };
  }
  const sg = { ...DEFAULTS.surfacesGlobal };
  for (const [k, v] of Object.entries(proj.surfacesGlobal || {})) if (v === false) sg[k] = false;    // 总开关只许关
  merged = { ...DEFAULTS, apiVersion: proj.apiVersion || DEFAULTS.apiVersion, surfacesGlobal: sg, tools };
  return rejects;
}

function projectRootOf(context: vscode.ExtensionContext): vscode.Uri {
  const f = vscode.workspace.workspaceFolders?.[0];
  return f ? f.uri : context.extensionUri;
}
function then<T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> {
  return new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));
}
