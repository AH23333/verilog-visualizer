// ============================================================================
// 统一调用层·单执行器（CONFIG_PROTOCOL §15 接口范式的 Tools 面，批次一：文件系统族）
// **收编而非另起**：闸 1（契约 surfaces）/闸 3（档案 grants）/审计（apiAudit）全部复用
// dispatch 同款——错误标签 [API_*]、verdict 七值、闸序 1→2(硬)→3→2(审批) 逐字一致，
// 审计账本一锅（`.vv/audit/trace-*.jsonl`）。dispatch 那 9 颗 RPC 的迁移（闸已在跑，换执行器不改语义）是第二批；
// 本执行器先服务树命令（ui 面）与未来 agent（mcp/agent 面——契约 surfacesGlobal.mcp 现在=false，
// 放开 agent 调用＝改契约一行，这正是统一层的杠杆点）。
//
// 调用方档案 ToolCaller：{ surface, subject, interactive }——
//   · ui 树命令＝CALLER_UI（interactive:true：确认弹窗由命令自己出，执行器⛔ 二次弹）；
//   · agent/mcp＝interactive:false → requiresApproval 工具由执行器出 HITL 弹窗（§11 审批原语落点）。
// 工具账双真源纪律：registry（TS，title/description/schema/handler）+ 契约 JSON（perm/sideEffects/
//   surfaces/ref/requiresApproval）——双方 id 必须**一一对齐**（apiDoc.test 钉死孤儿），
//   docs/API_REFERENCE.md 由 apiDoc.ts 从两源**生成**（⛔ 手写文档漂移）。
// 调用号：每次 executeTool 发一颗 `traceId`，审计那行与拒单抛回的 `ToolError.traceId` 是同一串——
//   最坏情况下 agent 手里只有"被拒"两个字，凭这串就能查到账上是哪道闸、什么实参形状、看的哪份契约。
// ============================================================================
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { canSurface, loadApiContract } from './apiSurface';
import { checkGrant } from './apiGrants';
import { auditToolCall, type AuditVerdict } from './apiAudit';

export type ToolSurface = 'ui' | 'rpc' | 'mcp' | 'cli';

/** 调用方档案：`subject`＝身份（闸③ grants 的 key，也是审计账上那颗 `subject`）、
 *  `surface`＝端点（闸② 按它放行，落账时写进 `channel`）、`interactive` 决定审批弹窗归谁出。
 *  ⚠ 两颗⛔ 合成一颗：RPC 路径上端点是 `rpc` 而身份是「用户」（`ui`），
 *  混起来＝审计账与授权闸两套口径（R154 之前 dispatch 就这么写）。 */
export interface ToolCaller {
  surface: ToolSurface;
  subject: string;
  interactive: boolean;
}
/** 扩展自己的树命令/标题钮（用户亲手点＝已过命令层确认，执行器不再弹） */
export const CALLER_UI: ToolCaller = { surface: 'ui', subject: 'ui', interactive: true };

/** 参数 JSON Schema（文档+校验双用；契约 JSON 的 perm/sideEffects/surfaces 与此互补不重叠） */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDef {
  id: string;
  title: string;
  description: string;
  schema: ToolSchema;
  handler: (context: vscode.ExtensionContext, args: Record<string, unknown>, caller: ToolCaller) => Promise<unknown>;
}

const registry = new Map<string, ToolDef>();

/** 注册（幂等守护：同 id 二次注册＝编程错误，当场炸） */
export function registerTool(def: ToolDef): void {
  if (registry.has(def.id)) throw new Error(`工具 ${def.id} 重复注册`);
  registry.set(def.id, def);
}
export function getTool(id: string): ToolDef | undefined { return registry.get(id); }
export function listTools(): ToolDef[] { return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id)); }
/** 测试/热载清场（⛔ 生产路径不调） */
export function __resetRegistryForTest(): void { registry.clear(); }

/** 带码错误：调用方（webview/agent）按 code 机读，message 人读。
 *  `traceId`＝这次调用在审计账上的那一行（同串）——最坏情况下 agent 拿到的只有"被拒"，
 *  有了它就能 `sys.readAudit`/grep 账本定位"哪道闸、什么实参形状、看到的契约是哪份（configHash）"，
 *  ⛔ 只能靠复述现象回来找人。
 *  R160 四-4 错误契约 v2：code 枚举收编满设计稿 §五 九颗（+NOT_FOUND/TOO_LARGE/HANDLER_ERROR/BAD_REQUEST）；
 *  `hint`＝拒单必须自带的"下一步打哪颗、带什么实参形状"（每道闸抛出点硬要求，台架逐 code 样本钉）。 */
export class ToolError extends Error {
  constructor(readonly code: 'NOT_REGISTERED' | 'SURFACE_DENIED' | 'NOT_GRANTED' | 'NOT_APPROVED' | 'BAD_ARGS'
    | 'NOT_FOUND' | 'TOO_LARGE' | 'HANDLER_ERROR' | 'BAD_REQUEST', message: string,
    readonly traceId: string = '', readonly hint?: string) { super(message); }
}

/** 工具成功执行后的宿主联动（extension.ts 订阅：sideEffects≠none ⇒ refreshAllTrees） */
const toolExecuted = new vscode.EventEmitter<{ toolId: string; caller: ToolCaller; ms: number }>();
export const onToolExecuted = toolExecuted.event;

/**
 * 统一执行入口。闸序与 dispatch 同一硬序（§9.4）：
 * ① 登记（registry∧契约 双查，孤儿任一＝not-registered）→ ② surfaces（全局开关∧工具面）
 * → ③ 档案 grants → ④ requiresApproval 且调用方非交互 ⇒ HITL 弹窗 → handler → 审计 auto/approved。
 * 审计七 verdict 与 dispatch 逐字同账；args 只落形状摘要（apiAudit.digestOf 同源）。
 */
export async function executeTool(
  context: vscode.ExtensionContext,
  caller: ToolCaller,
  id: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const t0 = Date.now();
  // 一次调用一个号，且**由执行器发**（⛔ 让落账那侧现算：拒单是先抛后异步写，两边各取随机数＝
  // 调用方手里那串在账上永远查不到，"给我看日志"变成"给我猜是哪一行"）。
  const traceId = crypto.randomBytes(4).toString('hex');
  const contract = loadApiContract();
  const def = getTool(id);
  const ct = contract.tools[id];
  const audit = (verdict: AuditVerdict, note?: string): void => {
    // `ref` 一颗算法贯穿到底：契约里那颗 `ref` 拿得到就用它，拿不到才退回 id。
    // ⚠ 修前两处不一致——放行路径传了 knownId（ref=契约那颗，如 `copyToSandbox`），
    //   而四道拒单都走 `audit(verdict, note)`（ref 变成 `host.copyToSandbox`）。
    //   同一颗工具在账本里因"这次成没成"而有两个 ref＝按 ref 聚合调用记录的读法必然漏，
    //   而 RPC 时代没人发现是因为 dispatch 自己那层壳把 ref 一律写成 method 名（重复实现遮蔽了它）。
    const ref = contract.tools[id]?.ref ?? id;
    // `tool` 只在"这颗确实登记了"时才写名：not-registered 那一行若也带上名字，账本就把一个⛔ 存在的
    // 工具说成调用过（审计臂②判的正是这一格）。
    auditToolCall(context, { tool: getTool(id) ? id : undefined, ref, subject: caller.subject, channel: caller.surface, verdict, ms: Date.now() - t0, args, note, traceId });
  };
  // 错误契约 v2（R160 四-4）：fail 多收一颗 hint——"拒了去哪修"与闸码同批落地，⛔ 自由发挥。
  const fail = (code: ToolError['code'], verdict: AuditVerdict, msg: string, note?: string, hint?: string): never => {
    // 拒单那行必须**自带机读码**（`[API_*]`）且⛔ 空。两条理由：
    //   · `sys.readAudit`/agent 自调试是按 note 反查拒因的，note=undefined 的账＝"被拦了，为什么没说"；
    //   · verdict 与 code ⛔ 一一对应——BAD_ARGS 和 handler 抛错都落 `error`，只盯 verdict 会把
    //     "调用方实参写错"读成"工具自己有 bug"，归责方向直接反了。
    // 缺省 note 时整条 msg 上账（msg 本就带标签）；给了 note 就补标签，两界读法一致。
    audit(verdict, note ? `[API_${code}] ${note}` : msg);
    throw new ToolError(code, msg, traceId, hint);
  };
  if (!def || !ct) {
    return fail('NOT_REGISTERED', 'not-registered',
      `[API_NOT_REGISTERED] ${id} 未登记（registry=${!!def} contract=${!!ct}——两边必须一一对齐）`,
      `registry=${!!def} contract=${!!ct}`,
      '两颗账里没有这个名字——sys.listTools 拿真名清单；sys.describeTool {"tool":"…"} 可预演任意名字');
  }
  // §15 设计纪律「每接口 schema+校验」的最小实现：required 实参在场校验（完整 JSON Schema 校验挂账批次三）。
  const missing = (def.schema.required ?? []).filter((k) => args?.[k] === undefined);
  if (missing.length) {
    return fail('BAD_ARGS', 'error', `[API_BAD_ARGS] ${id} 缺必填实参：${missing.join(', ')}`, `missing=${missing.join(',')}`,
      `补齐再打：sys.describeTool {"tool":"${id}"} 有参数 schema 全形（缺的是 ${missing.join(', ')}）`);
  }
  if (!canSurface(id, caller.surface)) {
    return fail('SURFACE_DENIED', 'surface-denied', `[API_SURFACE_DENIED] ${id}：端点未对 ${caller.surface} 开放（契约工具账）`, undefined,
      `这颗在 ${caller.surface} 面没开是契约裁的——sys.describeTool {"tool":"${id}","surface":"${caller.surface}"} 看账面；开面＝人类侧契约/覆盖文件改动，⛔ 绕面硬打`);
  }
  if (!checkGrant(caller.subject, id)) {
    return fail('NOT_GRANTED', 'not-granted', `[API_NOT_GRANTED] ${id}：调用方档案（${caller.subject}）未获授权（改 .vv/api.grants.json）`, undefined,
      `授权档案归人类管理——sys.selfCheck 看 ${caller.subject} 档案在场与告警；⛔ agent 自批`);
  }
  let approved = false;
  // 审批豁免只给**扩展自己的 UI**（三条件全满足）——树命令的确认弹窗已在命令层出过，⛔ 二次弹。
  // 自检加固（卷六十二补记）：豁免⛔ 只看 caller 自报的 interactive——那可被伪造；三条件齐验 +
  // 传输层纪律（批次二：MCP/LangGraph 接线时 subject/surface 由传输固化，业务代码⛔ 自造身份）。
  const isOwnUi = caller.surface === 'ui' && caller.subject === 'ui' && caller.interactive === true;
  if (ct.requiresApproval && !isOwnUi) {
    const pick = await vscode.window.showWarningMessage(
      `API 工具「${id}」要求确认后执行（调用方 ${caller.subject}）。${ct.description ?? def.description}`,
      { modal: true } as any, '允许');
    if (pick !== '允许') {
      return fail('NOT_APPROVED', 'denied', `[API_NOT_APPROVED] ${id}：用户未批准`, 'HITL 拒',
        '人没点头＝这次意图已尽，⛔ 循环重试；sys.readAudit {"limit":20} 回看这行（traceId=' + traceId + '），人工明示后再打');
    }
    approved = true;
  }
  try {
    const out = await def.handler(context, args, caller);
    audit(approved ? 'approved' : 'auto');
    toolExecuted.fire({ toolId: id, caller, ms: Date.now() - t0 });
    return out;
  } catch (e) {
    audit('error', String(e instanceof Error ? e.message : e).slice(0, 200));
    // 错误契约 v2 收编（§五"后三颗桥/执行器已有语义"）：handler 世界的错误也一律带码带号——
    //   ToolError 空号（handler 内部构造拿不到执行器号）补上这颗，调用方手里那串＝账上那行；
    //   raw throw 折成 HANDLER_ERROR（此前裸抛进桥的泛型 catch＝归责含糊，"过大"读成"工具炸了"）。
    if (e instanceof ToolError) {
      throw e.traceId ? e : new ToolError(e.code, e.message, traceId, e.hint);
    }
    throw new ToolError('HANDLER_ERROR',
      `[API_HANDLER_ERROR] ${id} handler 内部抛错：${String(e instanceof Error ? e.message : e).slice(0, 300)}`,
      traceId,
      '这颗工具内部炸了（不是你的实参问题）——sys.readAudit 按 traceId 回看这行；sys.describeTool {"tool":"…"} 看卡预演；反复重现＝报人类的工具缺陷，⛔ 换着实参硬试掩盖它');
  }
}

/** 实参宽容：uri 实参可能以 string（agent/JSON）或 vscode.Uri（进程内调用）抵达。
 *  ⚠ scheme 判定只认 `file://` 前缀——宽正则会把 Windows 盘符 `D:\p` 误判成 scheme（`D:` 命中），
 *    然后栽在宿主/桩的 `Uri.parse` 上（批次一实测连环 18 红，全被命令层 .catch 吞成静默）。
 *  ⚠ 空实参当场抛（自检补）：`Uri.file('')` 在宿主/桩两界的形状都不可靠，缺路径＝调用方 bug，⛔ 静默吞。 */
export function argUri(v: unknown): vscode.Uri {
  if (v && typeof v === 'object' && 'fsPath' in (v as any)) return v as vscode.Uri;
  const s = String(v ?? '').trim();
  if (!s) throw new Error('uri 实参为空（工具调用缺必填路径）');
  if (/^file:\/\//i.test(s)) {
    let p = s.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* 编码坏＝原样 */ }
    return vscode.Uri.file(p);
  }
  return vscode.Uri.file(s);   // fsPath（win 反斜杠 / posix 斜杠 / 桩的 `/d:/…` 全收）
}
