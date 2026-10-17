// ============================================================================
// 授权闸③（CONFIG_PROTOCOL §9.4 第三行）——调用方档案授权
// 域 B：`.vv/api.grants.json`（✅ 可选提交；vvProject 初始化刻意不生成——没出现＝不自设这道闸）。
// 形状：subjects 绑「端点身份 → profile 名」，profiles 是「profile 名 → 工具 id 白名单」。
// 语义：**只收窄、永远不放宽**——闸 1（surfacesGlobal）与闸 2（工具 surfaces/固有审批）先于本闸求值，
//   审批弹窗只在闸 1/3 都通过后才发起（协议硬序）；工具固有 requiresApproval/perm ⛔ 被档案豁免。
// subject 词表（阶段二）：`ui`＝本扩展自己的画布 webview（全部 rpc 流量的唯一身份）；MCP/CLI 接线时
//   按连接身份传 `mcp:<serverId>`/`cli:<proc>`（§10.2 agent 侧 grants 与此同文件同闸，端点无特权）。
// 文件缺席 / 某调用方未绑 profile ⇒ 它不受此闸约束（闸 1/2 照办）；绑了不存在的 profile ⇒ 该调用方
//   白名单清空＝fail-closed（作者明确想绑定但档案缺失，⌫ 不是"忘写"而是错发错）。
// 文件解析/形状失败 ⇒ 告警并当作缺席（授权档案是收窄器，收窄器自身坏了不能砖死全 UI；
//   与 .vv/api.json「沿用默认账」同一姿态——紧告警宽运行）。
// ============================================================================
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';

export interface GrantsFile {
  schemaVersion?: string;
  $schema?: string;
  meta?: Record<string, unknown>;
  subjects: Record<string, string>;
  profiles: Record<string, string[]>;
}

/** subject → 白名单（undefined＝档案缺席，闸不生效） */
let grants: Record<string, string[]> | undefined;

function then<T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> {
  return new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));
}

/**
 * 读工程授权档案（activate 一次性加载；热更新需重启窗口——与 .vv/api.json 覆盖同一姿态）。
 * 返回告警 reasons（合法且生效时为空）。
 */
export async function loadProjectGrants(context: vscode.ExtensionContext): Promise<string[]> {
  grants = undefined;
  const notes: string[] = [];
  const uri = vscode.Uri.joinPath(projectRoot(context), '.vv', 'api.grants.json');
  let raw: string;
  try { raw = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(uri))); } catch { return notes; }  // 缺席＝常返（阶段一常态）
  let p: Partial<GrantsFile> & Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { return ['api.grants.json 解析失败：当作未设置（授权闸不生效），请修好后再重启窗口']; }
  if (!p || typeof p !== 'object' || typeof p.subjects !== 'object' || p.subjects === null || typeof p.profiles !== 'object' || p.profiles === null) {
    return ['api.grants.json 形状不对（需要 subjects/profiles 两张表）：当作未设置'];
  }
  const g: Record<string, string[]> = {};
  for (const [subject, profile] of Object.entries(p.subjects)) {
    if (typeof profile !== 'string' || !profile) { notes.push(`subjects["${subject}"] 绑定值不是 profile 名：该档案条目忽略`); continue; }
    const list = (p.profiles as Record<string, unknown>)[profile];
    if (list === undefined) { g[subject] = []; notes.push(`subjects["${subject}"] → 「${profile}」在 profiles 里查无此档案：白名单清空（fail-closed）`); continue; }
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) {
      notes.push(`profiles["${profile}"] 不是工具 id 数组：该调用方白名单清空（fail-closed）`); g[subject] = []; continue;
    }
    g[subject] = list.filter(String);
  }
  grants = g;
  return notes;
}

/** 闸③唯一判定入口：subject 未绑档案＝true（不受此闸）；绑了＝白名单内才放行。⛔ 不放宽固有审批。 */
export function checkGrant(subject: string, toolId: string): boolean {
  if (grants === undefined) return true;
  const list = grants[subject];
  if (!list) return true;               // 档案只收窄它绑定过的调用方——没绑＝没话
  return list.includes(toolId);
}
