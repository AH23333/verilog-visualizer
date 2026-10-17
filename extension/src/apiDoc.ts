// ============================================================================
// API 文档生成器（⛔ 手写文档必漂移——单一真源=registry(标题/描述/参数schema) + 契约JSON
// (perm/sideEffects/surfaces/ref/requiresApproval)，本文件只做渲染。docs/API_REFERENCE.md
// 由 apiDoc.test 生成并钉「无漂移」；有意变更=跑 pnpm api:doc 再生成后随代码一并提交。）
// ============================================================================
import { listTools } from './toolRegistry';
import { loadApiContract } from './apiSurface';

/** 渲染整份 API_REFERENCE.md（UTF-8、无前置 BOM；表格列=契约×registry 的并集真相）。 */
export function renderApiReference(): string {
  const c = loadApiContract();
  const tools = listTools();
  const lines: string[] = [];
  lines.push('# API_REFERENCE（生成物 · 统一调用层）');
  lines.push('');
  lines.push(`> ⛔ **手改无效**：本文件由 \`pnpm api:doc\` 从 registry（extension/src/toolsFs.ts）+ 契约（extension/api/vv-api.defaults.json，工程层 \`.vv/api.json\` 只许收窄）**生成**；漂移会被台架钉住。`);
  lines.push(`> apiVersion \`${c.apiVersion}\` · 生成工具数 **${tools.length}** · 调用面 ${Object.entries(c.surfacesGlobal ?? {}).map(([k, v]) => `${k}=${v ? '开' : '关'}`).join(' / ')}`);
  lines.push('>');
  lines.push('> **调用方式（三方同门）**：`executeTool(context, caller, toolId, args)`（extension/src/toolRegistry.ts）。');
  lines.push('> **闸序（硬）**：① 登记（registry∧契约双查）→ ② surfaces（全局开关∧工具面）→ ③ 档案 `.vv/api.grants.json` → ④ `requiresApproval` 且调用方非交互 ⇒ HITL 弹窗。');
  lines.push('> **审计**：每次过闸一行 JSONL 落 `.vv/audit/trace-YYYYMMDD.jsonl`（verdict 七值：auto/approved/denied/error/surface-denied/not-registered/not-granted；args 只记形状摘要）。');
  lines.push('> **错误标签**：`[API_NOT_REGISTERED]` / `[API_SURFACE_DENIED]` / `[API_NOT_GRANTED]` / `[API_NOT_APPROVED]`（机读 code = 去掉 `[API_]` 壳）。');
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
  lines.push('- dispatch 的 6 颗 webview RPC（host.getConfig/getAllBindings/setDocBindings/copyToSandbox/…）——闸已在跑，迁移=换执行器不改语义。');
  lines.push('- 绑定族命令（bindParts/materialize/audit/complete/togglePartRole）与 compile 族（compileAndShow）。');
  lines.push('- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。');
  lines.push('');
  return lines.join('\n') + '\n';
}
