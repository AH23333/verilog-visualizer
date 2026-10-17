// ============================================================================
// API 审计通道（CONFIG_PROTOCOL §9.5）
// 每次过闸的工具调用一行 JSONL：{ts, traceId, tool, ref, subject, verdict, ms, argsDigest, configHash}
//   verdict 七值：auto/approved/denied/error/surface-denied/not-registered/not-granted（闸③档案拒）
//   落 `.vv/audit/trace-YYYY-MM-DD.jsonl`（那颗日期串就是下面 slice(0,10) 的产物；.gitignore 的 audit/ 规则保它不入库）。
// 反超前铁律：工程未 initProject（无 .vv/）＝通道静默；dirState 只判一次，开户须重启窗口（工程开户是大事）。
// 写策略：内存缓冲 + 批量整写日文件（workspace.fs 无 append）——30 行/5 秒即刷；日文件滚动上限 500 行。
// argsDigest：⛔ 进原参（整段电路 json 可能大且涉密）——只记键名清单+类型/字节数形状，尾部挂总字节标注。
// configHash：生效 API 契约（规范化排序后 sha256）——回答「这次调用看到的规则是哪份」。
// ============================================================================
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { projectRoot } from './dispatch';
import { loadApiContract } from './apiSurface';

/** verdict 的名册（一颗主人）：类型由它导出，文档/自检想列 verdict 都读这一份——⛔ 抄第二遍。 */
export const AUDIT_VERDICTS = ['auto', 'approved', 'denied', 'error', 'surface-denied', 'not-registered', 'not-granted'] as const;
export type AuditVerdict = typeof AUDIT_VERDICTS[number];
export interface AuditLine {
  ts: string; traceId: string; tool: string | null; ref: string; subject: string;
  /** 从哪一端点进来（rpc／ui／mcp／cli）——⚠ 与 `subject` 分两颗是 R154 定的：
   *  `subject` 永远是**身份**（grants 按它放行），`channel` 才是**通道**。
   *  修前那颗 `subject` 在 RPC 路径上被写成 `"rpc"`（通道），而授权检查却按 `"ui"`（身份）算——
   *  同一个字段两处各说各话，agent 拿审计账反推"谁能调用"必然推错。 */
  channel: string;
  verdict: AuditVerdict; ms: number; argsDigest: string; note?: string; configHash: string;
}
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let dirState: Promise<boolean> | undefined;

function then<T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> {
  return new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));
}
/** 未开户（无 .vv/）一律静默——判定结果进程内缓存（工程 init 后需重启窗口才开账，属刻意保守）。 */
function vvReady(context: vscode.ExtensionContext): Promise<boolean> {
  if (!dirState) dirState = then(vscode.workspace.fs.stat(vscode.Uri.joinPath(projectRoot(context), '.vv'))).then(() => true, () => false);
  return dirState;
}
export function __resetAuditForTest(): void { dirState = undefined; pending = []; if (timer) clearTimeout(timer); timer = undefined; }

function configHash(): string {
  const c = loadApiContract();
  const canon = {
    apiVersion: c.apiVersion, surfacesGlobal: c.surfacesGlobal,
    tools: Object.fromEntries(Object.entries(c.tools).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, t]) => [k, { surfaces: t.surfaces, perm: t.perm, sideEffects: t.sideEffects, requiresApproval: !!t.requiresApproval }])),
  };
  // 整账≤几 KB，sha256 每调重算（几十µs）；⛔ 用长度位做变更哨兵——恒等于定值，恰在合同热更新时骗过账本
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
/** 脱敏摘要：只记「形状」不记「值」——键名+类型+字节数（⛔ 电路 json 一字符都不落账本）。 */
function digestOf(args: unknown): string {
  try {
    const body = JSON.stringify(args) ?? '';
    const shapeOf = (v: unknown): string => {
      if (v === null) return 'null';
      if (Array.isArray(v)) return `array[${v.length}]`;
      if (typeof v === 'string') return `string(${v.length}B)`;
      if (typeof v === 'object') {
        let s: string;
        try { s = JSON.stringify(v) ?? ''; } catch { return 'object(?)'; }
        return `object(${s.length}B)`;
      }
      return `${typeof v}(${String(v).slice(0, 24)})`;
    };
    const o = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
    const shape = o
      ? Object.keys(o).sort().map((k) => `${k}:${shapeOf(o[k])}`).join(',')
      : shapeOf(args);
    const out = `${shape}|${body.length}B`;
    // 总字节标注永远收尾（…NB）＝断言/排障都先看到规模；形状超长就退化成纯计数（值依旧⛔）
    return out.length <= 260 ? out : `args:${(o ? Object.keys(o).length : 1)}keys|${body.length}B`;
  } catch { return 'unreadable'; }
}

/** 记账入口（fire-and-forget：dispatch 不 await，写失败⛔ 影响调用结果——账丢了是账的损失）。
 *  `traceId` 由**调用方**（executeTool）发号并回给调用方：调用失败时人拿到的那串就是账上这行的 traceId。
 *  ⛔ 在这里现算——异步落账与抛错两路各取一个随机数＝调用方那串永远查不到自己的行。 */
export function auditToolCall(context: vscode.ExtensionContext, p: { tool?: string; ref: string; subject: string; channel?: string; verdict: AuditVerdict; ms: number; args: unknown; note?: string; traceId?: string }): void {
  void (async () => {
    try {
      if (!await vvReady(context)) return;
      const line: AuditLine = {
        ts: new Date().toISOString(), traceId: p.traceId || crypto.randomBytes(4).toString('hex'),
        tool: p.tool ?? null, ref: p.ref, subject: p.subject, channel: p.channel ?? p.subject, verdict: p.verdict,
        ms: Math.round(p.ms * 100) / 100, argsDigest: digestOf(p.args), ...(p.note ? { note: String(p.note).slice(0, 200) } : {}),
        configHash: configHash(),
      };
      pending.push(JSON.stringify(line));
      if (pending.length >= 30) void flushAudit(context);
      else if (!timer) timer = setTimeout(() => void flushAudit(context), 5000);
    } catch { /* 审计自身炸＝静默，主业优先 */ }
  })();
}

/** 通道现状（`sys.selfCheck` 用）。⚠ "读不到账"有三张脸，⛔ 让调用方猜是哪一张：
 *  ① 工程没开户（`.vv/` 不在）② 行还在内存缓冲没落盘 ③ 日文件在但确实零行。
 *  `ready` 答①、`pending` 答②，③由读侧的 `exists/total` 答。 */
export async function auditChannelState(context: vscode.ExtensionContext): Promise<{ ready: boolean; pending: number }> {
  return { ready: await vvReady(context), pending: pending.length };
}

/** 落盘（日文件整写；测试收口与未来 deactivate 手动催）。返回本轮写出行数。 */
export async function flushAudit(context: vscode.ExtensionContext): Promise<number> {
  if (timer) { clearTimeout(timer); timer = undefined; }
  const batch = pending; pending = [];
  if (!batch.length) return 0;
  if (!await vvReady(context)) { pending.unshift(...batch); return 0; }
  const file = vscode.Uri.joinPath(projectRoot(context), '.vv', 'audit', `trace-${new Date().toISOString().slice(0, 10)}.jsonl`);
  let cap: string[] = [];
  try { cap = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(file))).split('\n').filter(Boolean); } catch { /* 新日新文件 */ }
  cap.push(...batch);
  if (cap.length > 500) cap = cap.slice(cap.length - 400);
  await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectRoot(context), '.vv', 'audit'))).catch(() => undefined);
  await then(vscode.workspace.fs.writeFile(file, new TextEncoder().encode(cap.join('\n') + '\n')));
  return batch.length;
}
