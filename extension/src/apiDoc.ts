// ============================================================================
// API 文档生成器（⛔ 手写文档必漂移——单一真源=registry(标题/描述/参数schema) + 契约JSON
// (perm/sideEffects/surfaces/ref/requiresApproval)，本文件只做渲染。docs/API_REFERENCE.md
// 由 apiDoc.test 生成并钉「无漂移」；有意变更=跑 pnpm api:doc 再生成后随代码一并提交。）
// ============================================================================
import { listTools } from './toolRegistry';
import { loadApiContract } from './apiSurface';
import { AUDIT_VERDICTS } from './apiAudit';

/** 渲染整份 API_REFERENCE.md（UTF-8、无前置 BOM；表格列=契约×registry 的并集真相）。 */
export function renderApiReference(): string {
  const c = loadApiContract();
  const tools = listTools();
  const lines: string[] = [];
  lines.push('# API_REFERENCE（生成物 · 统一调用层）');
  lines.push('');
  lines.push('> ⛔ **手改无效**：本文件由 `pnpm api:doc` 从 registry（`toolsFs.ts`／`toolsDomain.ts`／`dispatch.ts` 三处 `register*Tools()` 的并集）+ 契约（extension/api/vv-api.defaults.json，工程层 `.vv/api.json` 只许收窄）**生成**；漂移会被台架钉住。');
  lines.push(`> apiVersion \`${c.apiVersion}\` · 生成工具数 **${tools.length}** · 调用面 ${Object.entries(c.surfacesGlobal ?? {}).map(([k, v]) => `${k}=${v ? '开' : '关'}`).join(' / ')}`);
  lines.push('>');
  lines.push('> **调用方式（三方同门）**：`executeTool(context, caller, toolId, args)`（extension/src/toolRegistry.ts）。');
  lines.push('> **闸序（硬）**：① 登记（registry∧契约双查）→ ② surfaces（全局开关∧工具面）→ ③ 档案 `.vv/api.grants.json` → ④ `requiresApproval` 且调用方非交互 ⇒ HITL 弹窗。');
  lines.push(`> **审计**：每次过闸一行 JSONL 落 \`.vv/audit/trace-YYYY-MM-DD.jsonl\`（那颗日期串由 \`Date.toISOString().slice(0,10)\` 出，带连字符——正本 \`apiAudit.ts\`，⛔ 信上一版文档的口头描述）。每行两颗身份槽：\`subject\`＝调用方**身份**（闸③ grants 按它放行），\`channel\`＝**端点**（闸② surfaces 按它放行；rpc/ui/mcp/cli）。verdict ${AUDIT_VERDICTS.length} 值：${AUDIT_VERDICTS.join('/')}；args 只记形状摘要（⛔ 值）。`);
  lines.push('> **错误标签**：`[API_NOT_REGISTERED]` / `[API_SURFACE_DENIED]` / `[API_NOT_GRANTED]` / `[API_NOT_APPROVED]` / `[API_BAD_ARGS]`（机读 code = 去掉 `[API_]` 壳）。');
  lines.push('');
  lines.push('## 工具总表');
  lines.push('');
  lines.push('| 工具 id | 标题 | perm | sideEffects | surfaces | 审批 | ref（命令/rpc） | since |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const t of tools) {
    const ct = c.tools[t.id];
    if (!ct) { lines.push(`| \`${t.id}\` | ${t.title} | ⚠️ 契约缺账 | — | — | — | — | — |`); continue; }
    lines.push(`| \`${t.id}\` | ${t.title} | ${ct.perm} | ${ct.sideEffects} | ${ct.surfaces.join('/')} | ${ct.requiresApproval ? '**HITL**' : '—'} | \`${ct.ref}\` | ${ct.since ?? '—'} |`);
  }
  lines.push('');
  lines.push('## 工具详情（参数 schema）');
  for (const t of tools) {
    const ct = c.tools[t.id];
    lines.push('');
    lines.push(`### \`${t.id}\` — ${t.title}`);
    lines.push('');
    lines.push(`${t.description}`);
    if (!ct) { lines.push(''); lines.push('> ⚠️ 契约缺账：本工具未上 vv-api.defaults.json（孤儿，闸会以 not-registered 拒）。'); continue; }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(t.schema, null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push('## 尚未收编（第二批挂账）');
  lines.push('');
  // ⚠ 这一节的颗数⛔ 再手打：上一版写「dispatch 的 6 颗 webview RPC」而契约的 rpc 面现读 9 颗——
  //   本文件的立身之本就是「⛔ 手写文档必漂移」，挂账清单当然也不例外，一律从契约×registry 现算。
  const registeredIds = new Set(tools.map((t) => t.id));
  const contractIds = Object.keys(c.tools);
  const off = (surfaces: string) => contractIds.filter((id) => c.tools[id].surfaces.includes(surfaces) && !registeredIds.has(id));
  const rpcNoHandler = off('rpc');
  const uiNoHandler = contractIds.filter((id) => !c.tools[id].surfaces.includes('rpc') && !registeredIds.has(id));
  const handlerOffContract = tools.map((t) => t.id).filter((id) => !contractIds.includes(id));
  const rpcOnContract = contractIds.filter((id) => c.tools[id].surfaces.includes('rpc'));
  // ⚠ 这句话必须**随颗数换说法**：上一版无论 0 颗还是 9 颗都印"闸已在跑（dispatch 入口那份内联四闸）"，
  //   RPC 收编完后它就变成一份不存在实现的说明书——生成物也会说谎，而且说得更权威。
  lines.push(rpcNoHandler.length
    ? `- dispatch 的 **${rpcNoHandler.length}** 颗 webview RPC（${rpcNoHandler.map((s) => s.replace(/^host\./, '')).join(' / ')}）——还没上 registry，正由 dispatch 自己那层壳执行。`
    : `- webview RPC：待迁 **0** 颗（契约 rpc 面在册 ${rpcOnContract.length} 颗已全部走 \`executeTool\`；名册正本＝\`dispatch.ts\` 那颗 \`RPC_METHODS\`，对账锁拿它与契约 rpc 投影双向钉）。`);
  lines.push(`- 契约上账、非 rpc 面且⛔ registry handler：**${uiNoHandler.length}** 颗（${uiNoHandler.map((id) => `${id}→${c.tools[id].ref}`).join(' / ') || '（无）'}）——这几颗现在由命令面板直调 Extension Host 里的实现，绕开 executeTool。`);
  lines.push(`- 反向（registry 有 handler 而契约⛔ 上账）：**${handlerOffContract.length}** 颗（${handlerOffContract.join(' / ') || '（无）'}）。`);
  lines.push('- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。');
  lines.push('');
  return lines.join('\n') + '\n';
}
