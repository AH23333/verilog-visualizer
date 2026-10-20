// ============================================================================
// 统一调用层·领域工具族（批次二，2026-10-17）：按 §15 接口范式补全
//   · discoverTools   → sys.listTools（agent 必须信权威 schema，⛔ 靠经验猜签名）
//   · readLogs        → sys.readAudit（§14 jsonl 账本的读侧——"AI 查调用"落地形态）
//   · getStatus       → sys.getStatus
//   · **深度分级**（阶段三给 agent 的四档，按"要多深"选一颗，⛔ 一上来就倒全表）：
//       D0 sys.listTools（全工具浅档）→ D1 sys.describeTool（单颗深档＋闸前预演，⛔ 执行）
//       → D2 sys.selfCheck（整套 API 现在能不能用／哪道闸在拦／拦了去哪查）→ D3 sys.readAudit（账本原文）
//   · readResource 族 → res.readProjectFile / res.listProject / res.listSandbox（pull 式零副作用，
//                       让 agent"看懂现状"；sanitizeRel 圈死工程根 ⛔ 穿越）
//   · 领域 Tools      → bindings.*（链合并读/目录层写/审计/写全/固化）、circuits.*（名单读/角色翻转）、
//                       compile.closure（依赖闭包只读）
// 挂账（底座未建，⛔ 装样子）：undo/redo、snapshotState/restoreState（快照栈）、checkPermission
//   （策略引擎）、subscribe（hook 埋点）、readMemory/writeMemory（记忆存储）、长操作 getStatus 句柄。
// ============================================================================
import * as vscode from 'vscode';
import { registerTool, argUri, getTool, listTools, ToolError, type ToolCaller, type ToolSurface } from './toolRegistry';
import { broadcastBindingsChanged, projectRoot, vscodeFs } from './dispatch';
import { ProjectStore, sanitizeRel } from './projectStore';
import { rootRel, isVerilogPath } from './verilogDomain';
import {
  getAllBindings, setBindingInDir, collectInstanceHits, completeFromHits,
  materializeBindings, togglePartRole, getCircuitsSet, pathRel, META_FILE,
  readMetaAt, dirChain, metaPathOf, resolveLayerValue, normalizePartName, collectTableDirs,
} from './sandboxFiles';
import { parseVerilogInstances, parseVerilogModules, parseVerilogInstancesWithLines, VERILOG_LITE_PRIMITIVES } from './verilogParseLite';
// R160 四-3：主仓解析器 namespace 引入（res.parseFile main 栏；正本在 shared/，与主仓编译校验同一颗主人）
import * as mainParse from '../../shared/verilogParse';
import { closureOf, scanDefs, lastJobInfo, getLastTextUri } from './compilePanel';
import { apiOverrideSnapshot, canSurface, loadApiContract } from './apiSurface';
import { t, tSchema } from './i18n';   // i18n：运行时错误串直译；注册表元数据存中文、渲染层 t(动态)（I18N_DESIGN §二）
import { checkGrant, grantsSnapshot } from './apiGrants';
import { auditChannelState } from './apiAudit';
import { activationSnapshot } from './activationTrail';
import { bridgeSnapshot } from './mcpBridge';
import { openDocsSnapshot } from './customEditors';
import { getActiveSandboxDocUri, buildHierDefIndex, hierInstancesOf } from './trees';
import { hostState } from './hostState';

let registered = false;

const AUDIT_CAP = 200;   // readAudit 单次行数上限（⛔ 整账倒给 agent 撑上下文）

/** 日档读数的**唯一主人**（sys.readAudit / sys.describeTool / sys.selfCheck 三处共用一份口径）。
 *  ⚠ 文件名与 apiAudit.flushAudit 落盘那颗串逐字一致（`trace-YYYY-MM-DD.jsonl`，带连字符）——
 *    自检抓到的真 bug：读侧曾用无连字符 YYYYMMDD ⇒ 永远 exists:false。
 *  ⚠ 归一⛔ 只写在描述里：这颗是**对外实参**（系统边界），agent 照上一版 schema 交 `20261017`
 *    就会读成"查无此档"，而那句读数看起来完全像"今天没人调用过"——把调用方的笔误
 *    伪装成事实是最贵的一种错（同族：browserHost 返回空结果冒充"宿主没有"）。 */
async function readAuditDay(ctx: vscode.ExtensionContext, rawDate: unknown, rawLimit: unknown) {
  const input = String(rawDate ?? new Date().toISOString().slice(0, 10));
  const date = /^\d{8}$/.test(input) ? `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}` : input;
  // 深度战役修（2026-10-19）：date 白名单——这颗直拼 `trace-<date>.jsonl` 文件名，自由文本＝可拿
  //  exists:true/false 探读工程树内任意 .jsonl 的在场性（读面越出"日档"本职），`?`/`*` 等非法字符还裸抛
  //  EPERM 溜进 HANDLER_ERROR。两形（带连字符 / 8 位数）之外当场 BAD_ARGS。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ToolError('BAD_ARGS', `[API_BAD_ARGS] date 实参不合日档形状：${input.slice(0, 40)}`, '',
      '只收 YYYY-MM-DD 或 8 位纯数字（审计一日一档）；列有哪些日档＝sys.selfCheck 的 audit 段');
  }
  const limit = Math.min(Math.max(Number(rawLimit ?? 50), 1), AUDIT_CAP);
  const uri = vscode.Uri.joinPath(projectRoot(ctx), '.vv', 'audit', `trace-${date}.jsonl`);
  let raw: string;
  try { raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); }
  catch { return { exists: false, date, total: 0, lines: [] as any[] }; }
  const all = raw.split('\n').filter(Boolean);
  const lines = all.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  return { exists: true, date, total: all.length, lines: lines as any[] };
}

/** 端点词表（与 toolRegistry.ToolSurface 同一份四值）。*/
const SURFACES: readonly string[] = ['ui', 'rpc', 'mcp', 'cli'];

/** 预演问的是**哪条线**：诊断工具本身⛔ 挂在所有端点上（不然 agent 从 mcp 进来连"我能不能调用"都问不了），
 *  所以"这一枪打得响吗"必须由实参说出问的端点/身份，缺省＝调用方自己那条。
 *  ⚠ 这⛔ 是绕闸通道：只回一份判断，⛔ 调 handler⛔ 改任何状态——真打那枪照旧过四道闸。
 *  词表外的 `surface` 值⛔ 静默采纳（那会把"写错了"读成"那条线不通"），回落到调用方自己那条并如实记一笔。 */
function targetCaller(a: Record<string, unknown>, caller: ToolCaller): { probe: ToolCaller; askedSurface: string; surfaceFallback: boolean } {
  const askedSurface = typeof a.surface === 'string' ? a.surface : caller.surface;
  const known = SURFACES.includes(askedSurface);
  const subject = typeof a.subject === 'string' && a.subject ? a.subject : caller.subject;
  return {
    probe: { surface: (known ? askedSurface : caller.surface) as ToolSurface, subject, interactive: caller.interactive },
    askedSurface, surfaceFallback: !known,
  };
}

/** 闸前预演（D1/D2 共用）：照 executeTool 的硬序把①登记 ②surfaces ③grants ②必填 ④审批**判一遍**，
 *  ⛔ 调 handler ⇒ 零副作用。agent 的"我这一枪会不会被拦"必须有便宜答案，⛔ 靠真打一枪看现象。 */
function probeTool(id: string, probeArgs: Record<string, unknown>, caller: ToolCaller) {
  const c = loadApiContract();
  const def = getTool(id);
  const ct = c.tools[id];
  const missingArgs = (def?.schema.required ?? []).filter((k) => probeArgs?.[k] === undefined);
  const surfaceOpen = canSurface(id, caller.surface);
  const granted = checkGrant(caller.subject, id);
  // 闸②有两半（总闸 / 这颗的 surfaces），最坏情况下 agent 要听的正是"哪一半关的"：
  // 前者＝产品一行开关（放开 agent 的杠杆），后者＝这颗工具本身没这条线。判据仍⛔ 重算 `surfaceOpen`，
  // 这里只负责把**原因**说清（⛔ 让两处各判一次再对不上——canSurface 是唯一主人）。
  const globalOpen = (loadApiContract().surfacesGlobal?.[caller.surface] ?? true) !== false;
  const isOwnUi = caller.surface === 'ui' && caller.subject === 'ui' && caller.interactive === true;
  const blockers = [
    ...(!def ? ['未登记：registry ⛔ 这颗 id（闸①两半之一）'] : []),
    ...(!ct ? ['契约缺账：vv-api.defaults.json ⛔ 这颗 id（闸①两半的另一半）'] : []),
    ...(!surfaceOpen ? [`端点未开放：闸②按 surface=${caller.surface} 拒（${globalOpen ? `契约里这颗的 surfaces 没带 ${caller.surface}` : '契约总闸 surfacesGlobal 关着——这是放开这条线的产品开关，⛔ 改工程 api.json，它只许关'}）`] : []),
    ...(!granted ? [`档案未授权：闸③按 subject=${caller.subject} 拒（改 .vv/api.grants.json）`] : []),
    ...(missingArgs.length ? [`缺必填实参：${missingArgs.join(', ')}`] : []),
  ];
  return {
    id, surface: caller.surface, subject: caller.subject,
    surfaceOpen, surfaceGlobalOpen: globalOpen, surfaceInTool: !!ct?.surfaces.includes(caller.surface),
    granted, needsApproval: !!ct?.requiresApproval && !isOwnUi,
    requiresApproval: !!ct?.requiresApproval, missingArgs, blockers,
    verdict: blockers.length ? 'blocked' : 'ready',
  } as const;
}

/** 上账入口（activate 调一次；幂等）。 */
/** activate 期注入（extension.ts）：编译面板执行体（ensurePanel 闭包住在 activate 域，工具本体住这里给元数据闸扫到）。 */
let compileRunner: ((ctx: vscode.ExtensionContext, uri?: vscode.Uri) => Promise<void>) | null = null;
export function setCompileRunner(fn: (ctx: vscode.ExtensionContext, uri?: vscode.Uri) => Promise<void>): void { compileRunner = fn; }

export function registerDomainTools(): void {
  if (registered) return;
  registered = true;

  /* ============ bindings 族：绑定链（读=链合并，写=目录层表） ============ */

  registerTool({
    id: 'bindings.get', title: '读绑定', description: '给 doc（根相对 .djs/.v 路径）＝该文档的链合并生效绑定（近层覆盖远层、值折回根相对）；不给 doc＝项目根表原文。幂等只读。',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对文档路径（可省）' } } },
    handler: async (ctx, a) => ({ bindings: await getAllBindings(ctx, a.doc ? String(a.doc) : undefined) }),
  });

  registerTool({
    id: 'bindings.set', title: '写绑定', description: '直写某目录层 `.verilogviz.json` 的一条绑定（part=null＝删该键）；值按层目录相对化落盘。手编内容珍贵的语义与 UI 同源。',
    schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '目录层（根相对；缺省=项目根表）' },
        celltype: { type: 'string', description: '实例/键名' },
        // part 的 null＝删键是合法语义（拆表），但声明只写 string——深度战役二波类型闸当场揪出声明不实，
        // 归位数组形（与 dispatch 域 line: ['number','null'] 同款先例）：闸读声明，声明就得把真语义说全。
        part: { type: ['string', 'null'], description: '部件文件（根相对或相对该目录；null/空＝删）' },
      },
      required: ['celltype'],
    },
    handler: async (ctx, a) => {
      const dir = a.dir ? String(a.dir) : '';
      await setBindingInDir(ctx, dir, String(a.celltype), a.part ? String(a.part) : null);
      broadcastBindingsChanged();
      return { ok: true, dir: dir || '/', file: META_FILE };
    },
  });

  registerTool({
    id: 'bindings.audit', title: '审计绑定完整性', description: '枚举文档子部件实例中「表里没录、正靠同名兜底」的条目（盘上内容模拟画布解析链，BFS 带预算）。幂等只读。',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对文档路径' } }, required: ['doc'] },
    handler: async (ctx, a) => ({ hits: await collectInstanceHits(ctx, String(a.doc)) }),
  });

  registerTool({
    id: 'bindings.complete', title: '写全绑定', description: 'audit+一键写全：把自动命中且未录入的实例按「顶层同源=裸键/深层=前缀」策略落文档目录表；已录入⛔ 覆写。',
    schema: { type: 'object', properties: { doc: { type: 'string' } }, required: ['doc'] },
    handler: async (ctx, a) => {
      const doc = String(a.doc);
      const hits = await collectInstanceHits(ctx, doc);
      const written = await completeFromHits(ctx, doc, hits);
      broadcastBindingsChanged();
      return { written, hits: hits.length };
    },
  });

  registerTool({
    id: 'bindings.materialize', title: '固化自动绑定', description: '把「未录入且能自动同名命中」的解析写进文档目录表（.djs=同目录/根同名打分，.v=依赖闭包）；已记录⛔ 动。返回固化条目。',
    schema: { type: 'object', properties: { doc: { type: 'string' } }, required: ['doc'] },
    handler: async (ctx, a) => {
      const root = projectRoot(ctx);
      const docRel = String(a.doc);
      const uri = vscode.Uri.joinPath(root, ...docRel.split('/'));
      const done: string[] = [];
      if (/\.djs$/i.test(docRel)) {
        const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        const cts = [...new Set(((JSON.parse(content)?.cells || []) as Array<{ type?: string; celltype?: string }>)
          .filter((c) => c?.type === 'Subcircuit' && c.celltype).map((c) => String(c.celltype)))];
        const names = new Set((await new ProjectStore(vscodeFs(root), '@root').listSandboxTree()).files.map((f) => f.name));
        const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
        done.push(...await materializeBindings(ctx, docRel, cts, async (n) =>
          names.has(`${dir}/${n}.djs`) ? `${dir}/${n}.djs` : names.has(`${n}.djs`) ? `${n}.djs` : null));
      } else {
        const job = await closureOf(ctx, uri);
        const inst = new Set<string>();
        for (const f of job.files) {
          const { parseVerilogInstances } = await import('./verilogParseLite');
          for (const i of parseVerilogInstances(f.content)) if (i !== job.topModule) inst.add(i);
        }
        // 「谁定义了这个模块」问一颗主人 `scanDefs`（全工作区真扫描，与「写全配置」链同源）。
        // 修前这里拿闭包 job.files 建"裸名→文件"表：闭包只含**已录入绑定**的文件，而本工具服务的
        // 正是**未录入**实例 ⇒ 按构造永远命不中（一键落表对 .v 工程恒交回 0 颗＝"点了没反应"）。
        const defs = await scanDefs();
        done.push(...await materializeBindings(ctx, docRel, [...inst], async (n) => {
          const def = defs.get(n);
          if (!def) return null;
          const hit = pathRel(projectRoot(ctx), def);
          return hit === docRel ? null : hit;                              // ⛔ 把自己录成部件
        }));
      }
      if (done.length) broadcastBindingsChanged();
      return { done };
    },
  });

  /* ============ R160 批次四 四-2：绑定链可解释性双枪（P4 案族——"为什么解析成这个"一枪说透） ============ */

  registerTool({
    id: 'res.readBindingTables', title: '逐层绑定表原文',
    description: 'L3：给 doc（或 dir）＝从根到该目录链上每一层 `.verilogviz.json` 的**原文**（bindings.get 只给合并结果；这里看得见每层 circuits/bindings/协议外键）。单表 >32KB 截前 200 键并标 truncated。幂等只读。',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对文档路径' }, dir: { type: 'string', description: '或只给目录（该目录到根的链）' } } },
    handler: async (ctx, a) => {
      const doc = a.doc ? String(a.doc) : (a.dir !== undefined ? `${String(a.dir)}/_` : '_');
      const chain = [...dirChain(doc)].reverse();                 // 根→文档目录（与合并序同向）
      const layers: Array<Record<string, unknown>> = [];
      let truncated = false;
      for (const dir of chain) {
        const m = await readMetaAt(ctx, dir);
        if (!m) { layers.push({ dir: dir || '/', path: metaPathOf(dir), exists: false }); continue; }
        let bindings: Record<string, unknown> = m.bindings;
        if (JSON.stringify(bindings).length > 32768) {
          const ks = Object.keys(bindings);
          bindings = Object.fromEntries(ks.slice(0, 200).map((k) => [k, bindings[k]]));
          truncated = true;
        }
        layers.push({ dir: dir || '/', path: metaPathOf(dir), exists: true, circuits: m.circuits, bindings, extraKeys: m._extra ? Object.keys(m._extra) : [] });
      }
      return { chain: layers, truncated };
    },
  });

  registerTool({
    id: 'bindings.explain', title: '单实例解析轨迹',
    description: 'L4 主枪：这颗实例**为什么**解析成这个文件（或为什么没解析成）。逐层轨迹＝与闭包同一把尺的镜像：'
      + '前缀键先于裸键、近层压远层、键值都按层折叠（bindingsForFile 的 outKey 算法，⛔ 第二套判据）；'
      + '终点检查（文件在否/含不含该模块/djs 可不可解析/在不在 circuits 名单）；verdict＋hint（下一步打哪颗带什么实参）。幂等只读。',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对宿主文档' }, instance: { type: 'string', description: '实例名/celltype' } }, required: ['doc', 'instance'] },
    handler: async (ctx, a) => {
      const doc = String(a.doc); const inst = String(a.instance);
      const docUri = vscode.Uri.joinPath(projectRoot(ctx), ...doc.split('/'));
      let text = '';
      try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(docUri)); }
      catch { return { doc, instance: inst, verdict: 'DOC_UNREADABLE', hint: `读不到「${doc}」：路径按根相对给；res.listProject / res.listSandbox 可列真名` }; }
      // ① 实例在场性（解析器眼里；文档本身坏＝跳过此检交给轨迹说话）
      const isDjs = /\.djs$/i.test(doc);
      let declared: string[] = [];
      let declaredOk = true;
      try {
        declared = isDjs
          ? [...new Set((((JSON.parse(text)?.cells || []) as Array<{ type?: string; celltype?: string }>)
              .filter((c) => c?.type === 'Subcircuit' && c.celltype).map((c) => String(c.celltype))))]
          : parseVerilogInstances(text);
      } catch { declaredOk = false; }
      if (declaredOk && declared.length && !declared.includes(inst)) {
        return { doc, instance: inst, verdict: 'NO_SUCH_INSTANCE', instances: declared.slice(0, 50),
          hint: `解析器眼里「${doc}」没有这颗实例；先对名字（res.parseFile 可看解析原样输出）` };
      }
      // ② 逐层轨迹（closureOf 合并查表的镜像：merged[`${doc}::${inst}`] ?? merged[inst]）
      const chain = dirChain(doc);                                 // 近→远
      const mergedKey = `${doc}::${inst}`;
      const tried: Array<{ layer: string; key: string; keyKind: 'prefix' | 'bare'; hit: boolean; foldedKey?: string }> = [];
      let hit: { layer: string; key: string; keyKind: 'prefix' | 'bare'; raw: string; folded: string } | null = null;
      for (const dir of chain) {                                   // 一趟过每层：前缀键按折叠名对账（⛔ 只猜表层写法）
        const m = await readMetaAt(ctx, dir);
        if (!m) { tried.push({ layer: dir || '/', key: mergedKey, keyKind: 'prefix', hit: false }); tried.push({ layer: dir || '/', key: inst, keyKind: 'bare', hit: false }); continue; }
        for (const k of Object.keys(m.bindings)) {
          if (!k.includes('::')) continue;
          const at = k.lastIndexOf('::');
          if (k.slice(at + 2) !== inst) continue;
          const foldedKey = `${resolveLayerValue(dir, normalizePartName(k.slice(0, at)))}${k.slice(at)}`;
          const isHit = foldedKey === mergedKey;
          tried.push({ layer: dir || '/', key: k, keyKind: 'prefix', hit: isHit, ...(foldedKey !== k ? { foldedKey } : {}) });
          if (isHit && !hit) {
            const raw = String(m.bindings[k]);
            hit = { layer: dir || '/', key: k, keyKind: 'prefix', raw, folded: resolveLayerValue(dir, normalizePartName(raw)) };
          }
        }
      }
      if (!hit) for (const dir of chain) {
        const m = await readMetaAt(ctx, dir);
        const has = !!m && m.bindings[inst] !== undefined && String(m.bindings[inst]) !== '';
        tried.push({ layer: dir || '/', key: inst, keyKind: 'bare', hit: has });
        if (has && !hit) {
          const raw = String(m!.bindings[inst]);
          hit = { layer: dir || '/', key: inst, keyKind: 'bare', raw, folded: resolveLayerValue(dir, normalizePartName(raw)) };
        }
      }
      const docDir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
      if (!hit) {
        return { doc, instance: inst, verdict: 'BINDING_MISSING', tried,
          hint: `未录入绑定。写一颗：bindings.set { dir:"${docDir}", celltype:"${doc.includes('/') ? inst : `${doc.split('/').pop()}::${inst}`}", part:"<定义文件根相对>" }（R152：⛔ 同名兜底，必须显式）` };
      }
      // ③ 终点检查（与 closureOf 同款分岔）
      const v = hit.folded;
      const base: Record<string, unknown> = { doc, instance: inst, hit, tried };
      if (isVerilogPath(v)) {
        try {
          const t2 = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectRoot(ctx), ...v.split('/'))));
          const mods = parseVerilogModules(t2);
          if (!mods.includes(inst)) return { ...base, verdict: 'BINDING_UNRESOLVED_RECORD', defines: mods.slice(0, 8), hint: `「${v}」里没有模块 ${inst}（它定义的是：${mods.slice(0, 4).join('、') || '无'}）——改绑定值或补模块` };
          return { ...base, verdict: 'resolved', via: 'recorded', file: v };
        } catch { return { ...base, verdict: 'BINDING_UNRESOLVED_RECORD', hint: `记录指向的「${v}」不存在——bindings.set 改值或把文件放回` }; }
      }
      if (/\.(djs|gate)$/i.test(v)) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectRoot(ctx), ...v.split('/')))));
          const cells = Array.isArray(parsed?.cells) ? parsed.cells.length : -1;
          const role = (await getCircuitsSet(ctx)).has(v) ? 'circuit' : 'part';
          return { ...base, verdict: 'resolved', via: 'recorded', file: v, cells, role,
            ...(role === 'circuit' ? { warn: '绑到了一份在 circuits 名单里的电路（名单=显式取消部件）——多数时候这不是本意' } : {}) };
        } catch { return { ...base, verdict: 'UNRESOLVED_REF', hint: `部件「${v}」不存在或不是合法电路 json——bindings.set 改值` }; }
      }
      return { ...base, verdict: 'SCHEMA_INVALID', hint: `绑定值「${v}」不支持：只认 .v/.sv/.vh 定义或 .djs/.gate 部件` };
    },
  });

  /* ============ R160 批次四 四-3：解析器输出并呈＋实例层次树（P5/P3——"解析器眼里长什么样"与"树显示的同一份数据"） ============ */

  /** 深度战役（2026-10-19）归位修：res.* 路径族对 sanitizeRel 拒签（`..`/绝对/盘符）折 BAD_ARGS——
   *  ⛔ 让宿主内核的 "Parent directory traversal is not allowed" 裸抛溜进 HANDLER_ERROR（把"你递了颗坏路径"
   *  归责成"工具内部炸了"，正是 v2 要根除的形）。四-3/4-4 四颗 path 实参工具共用这把尺。 */
  const relOrBadArgs = (s: string): string => {
    try { return sanitizeRel(s); }
    catch { throw new ToolError('BAD_ARGS',
      '[API_BAD_ARGS] path/entry/dir 实参被拒（工程根之外的形状：.. / 绝对 / 盘符）', '',
      '路径按工程根相对给（.. / 绝对 / 盘符开头都拒）——res.listProject / res.listSandbox 列在册名'); }
  };


  /** 回包帽 256KB（P9 纪律）：超限就逐个砍最长数组（折半），并标 truncated——列表总数⛔ 静默失真。 */
  const capLists256 = (obj: Record<string, any>, cap = 262144): Record<string, any> => {
    if (JSON.stringify(obj).length <= cap) return obj;
    const getArr = (path: string): any[] | null => {
      let cur: any = obj;
      for (const seg of path.split('.')) { cur = cur?.[seg]; }
      return Array.isArray(cur) ? cur : null;
    };
    for (;;) {
      const keys: string[] = [];
      const walk = (o: any, p: string) => {
        for (const k of Object.keys(o ?? {})) {
          const v = o[k]; const q = p ? `${p}.${k}` : k;
          if (Array.isArray(v) && v.length > 1) keys.push(q);
          else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, q);
        }
      };
      walk(obj, '');
      let best: string | null = null; let bestLen = 0;
      for (const q of keys) { const arr = getArr(q); if (arr && arr.length > bestLen) { bestLen = arr.length; best = q; } }
      if (!best) break;
      const arr = getArr(best)!;
      arr.splice(Math.ceil(arr.length / 2));
      if (JSON.stringify(obj).length <= cap) break;
    }
    obj.truncated = true;
    obj.capBytes = cap;
    return obj;
  };

  registerTool({
    id: 'res.parseFile', title: '解析器原样输出摊开（双栏并呈）',
    description: 'L4（P5）：同一份文件字节喂**两颗解析器**——main 栏＝主仓 shared/verilogParse（模块端口 parseModulePorts、例化端口连接 parseInstantiations，编译校验血统）；'
      + 'lite 栏＝扩展侧 verilogParseLite（树/编译面板血统）。divergence 报两套输出差集、primitivesIgnored 报三张原语跳表的差——'
      + '分岔（dff 族一颗表跳一颗不跳＝r80 案底）**如实并呈**⛔ 掩盖，收敛＝独立战役（裁决 §八.1）。'
      + '.djs 单栏（cells/subcircuits/inputs/outputs＝审计族同词表）。帽 256KB（截数组标 truncated）。幂等只读。',
    schema: { type: 'object', properties: { path: { type: 'string', description: '根相对 .v/.sv/.vh 或 .djs' } }, required: ['path'] },
    handler: async (ctx, a) => {
      const rel = relOrBadArgs(String(a.path));
      const root = projectRoot(ctx);
      let text: string;
      try { text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...rel.split('/')))); }
      catch { return { path: rel, verdict: 'NOT_FOUND', hint: `读不到「${rel}」——路径按根相对给；res.listProject / res.listSandbox 可列真名` }; }
      if (/\.djs$/i.test(rel)) {
        let cells: any[] = []; let parseError: string | null = null;
        try {
          const pj = JSON.parse(text);
          cells = Array.isArray(pj?.cells) ? pj.cells : [];
          if (!Array.isArray(pj?.cells)) parseError = '顶层没有 cells 数组';
        } catch (e) { parseError = String((e as Error)?.message || e).slice(0, 160); }
        const names = (t: string) => [...new Set(cells.filter((c: any) => c?.type === t && c.celltype).map((c: any) => String(c.celltype)))];
        const nets = (t: string) => cells.filter((c: any) => c?.type === t).map((c: any) => String(c?.net ?? '?'));
        return capLists256({ path: rel, kind: 'djs', bytes: text.length, parseError,
          cells: cells.length, subcircuits: names('Subcircuit'), inputs: nets('Input'), outputs: nets('Output') });
      }
      if (!isVerilogPath(rel)) return { path: rel, verdict: 'BAD_EXT', hint: '只收 .v/.sv/.vh（编译域）与 .djs（沙盒域）；其他文本走 res.readProjectFile' };
      const mainMods = mainParse.parseVerilogModules(text);
      const portsMap = mainParse.parseModulePorts(text);
      const insts = mainParse.parseInstantiations(text);
      const mainPVIs = mainParse.parseVerilogInstances(text);   // 主仓自己的 instances 栏（dff 族与 instantiations 分岔的证人）
      const liteMods = parseVerilogModules(text);           // 名字没让渡——toolsDomain 的裸名恒指 lite（文件头 import 为准）
      const liteInsts = parseVerilogInstances(text);
      const liteLines = parseVerilogInstancesWithLines(text);
      const instMods = [...new Set(insts.map((i) => i.moduleName))];
      const MI = mainParse.VERILOG_INSTANCES_PRIMITIVES; const MN = mainParse.VERILOG_INSTANTIATIONS_PRIMITIVES; const LT = VERILOG_LITE_PRIMITIVES;
      const diff = (a: readonly string[], b: readonly string[]) => a.filter((w) => !b.includes(w));
      return capLists256({
        path: rel, kind: 'verilog', bytes: text.length,
        parsers: {
          main: {
            modules: mainMods.map((name) => ({ name,
              ports: (portsMap.get(name)?.ports ?? []).map((p) => ({ name: p.name, direction: p.direction, width: p.width, isSigned: p.isSigned })),
              // 口径如实：ports 只吃 ANSI 式声明（非 ANSI 的端口在体内——这一格给空数组是 parseModulePorts 现行为，⛔ 工具层修饰）
            })),
            instances: insts.map((i) => ({ name: i.instanceName, module: i.moduleName, line: i.lineNumber,
              connections: i.ports.map((p) => ({ port: p.portName, expr: p.connectedExpr })) })),
          },
          lite: { modules: liteMods, instances: liteInsts, instancesWithLines: liteLines },
        },
        divergence: {
          modules: { onlyMain: mainMods.filter((m) => !liteMods.includes(m)), onlyLite: liteMods.filter((m) => !mainMods.includes(m)) },
          instances: { onlyMain: instMods.filter((m) => !liteInsts.includes(m)), onlyLite: liteInsts.filter((m) => !instMods.includes(m)) },
          // 主栏 own 两面（parseVerilogInstances 跳 dff 族、parseInstantiations 不跳＝r80 案底的本体）——⛔ 只看跨栏差会漏它
          mainSelfDiff: instMods.filter((m) => !mainPVIs.includes(m)),
        },
        primitivesIgnored: {
          onlyInstancesTable: diff(MI, MN), onlyInstantiationsTable: diff(MN, MI),
          liteVsMainInstances: { onlyLite: diff(LT, MI), onlyMain: diff(MI, LT) },
          note: '三张跳表的差集＝"同一颗词被一颗表当原语跳掉、被另一颗表放过"的分岔名单（P5 案底；dff 族在册）',
        },
      });
    },
  });

  registerTool({
    id: 'compile.hierarchy', title: '实例层次树（与树同一把主人）',
    description: 'L4（P3）：entry（根相对 .v）为根、depth（帽 4）全展开成平表——用的就是**层次树的下钻主人**'
      + '（hierInstancesOf/buildHierDefIndex 抽自 HierarchyTree，环守卫同一把 chain 尺）；line＝parseVerilogInstancesWithLines 首现行（同判据两形，一把尺）。'
      + '树显示什么，agent 就问到什么。预算 500 颗＋回包 64KB 帽（truncated+total 如实）。幂等只读。',
    schema: { type: 'object', properties: { entry: { type: 'string', description: '根相对 .v 入口' }, depth: { type: 'number', description: '下钻深度（帽 4，缺省 4）' } }, required: ['entry'] },
    handler: async (ctx, a) => {
      const rel = relOrBadArgs(String(a.entry));
      if (!isVerilogPath(rel)) return { entry: rel, verdict: 'BAD_EXT', hint: '只认 .v/.sv/.vh（与 compile.closure 同域）；.djs 的层级见 bindings.audit / res.parseFile' };
      const root = projectRoot(ctx);
      const entryUri = vscode.Uri.joinPath(root, ...rel.split('/'));
      try { await vscode.workspace.fs.stat(entryUri); } catch { return { entry: rel, verdict: 'NOT_FOUND', hint: `入口「${rel}」不存在——res.listProject 列真名` }; }
      const defMap = await buildHierDefIndex();
      const capD = Math.min(4, Math.max(1, Math.floor(Number(a.depth)) || 4));
      const lineCache = new Map<string, Map<string, number>>();
      const lineOf = async (uri: vscode.Uri, mod: string): Promise<number | null> => {
        let m = lineCache.get(uri.path);
        if (!m) {
          m = new Map();
          try {
            const t = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
            for (const e of parseVerilogInstancesWithLines(t)) if (!m!.has(e.name)) m.set(e.name, e.line);
          } catch { /* 读不到＝整图 null，如实 */ }
          lineCache.set(uri.path, m);
        }
        return m.get(mod) ?? null;
      };
      const relOf = (u: vscode.Uri) => rootRel(root, u);
      const nodes: Array<Record<string, unknown>> = [];
      let budget = 500; let truncated = false;
      const queue: Array<{ uri: vscode.Uri; chain: string; depth: number }> = [{ uri: entryUri, chain: '', depth: 0 }];
      while (queue.length && budget > 0) {
        const cur = queue.shift()!;
        let kids;
        try { kids = await hierInstancesOf(cur.uri, cur.chain, defMap); } catch { continue; }
        for (const nd of kids) {
          if (budget-- <= 0) { truncated = true; break; }
          nodes.push({ chain: nd.chain ?? nd.label, instance: nd.label, module: nd.label,
            defFile: nd.uri ? relOf(nd.uri) : null, line: await lineOf(cur.uri, nd.label), depth: cur.depth + 1 });
          if (nd.uri && cur.depth + 1 < capD) queue.push({ uri: nd.uri, chain: String(nd.chain ?? nd.label), depth: cur.depth + 1 });
        }
      }
      if (queue.length && !truncated) truncated = true;
      let out: Record<string, unknown> = { entry: rel, root: rel, depthCap: capD, total: nodes.length, truncated, nodes };
      if (JSON.stringify(out).length > 65536) {
        let lo = 0; let hi = nodes.length;
        while (lo < hi - 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (JSON.stringify({ ...out, nodes: nodes.slice(0, mid) }).length <= 65536) lo = mid; else hi = mid;
        }
        out = { ...out, nodes: nodes.slice(0, lo), truncated: true,
          note: `nodes 已按 64KB 帽截到 ${lo} 颗（total＝全量 ${nodes.length}——⛔ 把截断当全貌）` };
      }
      return out;
    },
  });

  /* ============ R161 批次六：写面全放开（用户拍板）——契约在册三颗 compile.* 补 registry 真身（一把主人薄壳） ============ */
  registerTool({
    id: 'compile.compileAndShow', title: '编译并查看电路',
    description: 'L6：把一颗编译域源码（根相对 .v/.sv/.vh）编译并把电路推上画布面板；缺省 path＝活动编辑器。与命令面板/编辑器标题按钮同颗执行体（ensurePanel 懒建面板 + 闭包编译 + 推送）。幂等（重推覆盖），返回 {via}。',
    schema: { type: 'object', properties: { path: { type: 'string', description: '根相对 .v/.sv/.vh；省略＝当前活动文本编辑器' } } },
    handler: async (ctx, a) => {
      if (!compileRunner) throw new ToolError('HANDLER_ERROR', '[API_HANDLER_ERROR] compile.compileAndShow：执行体未注入（activate 未走完？）', '', '稍后重试；持续即报——activate 时序问题');
      const uri = a.path === undefined ? undefined : vscode.Uri.joinPath(projectRoot(ctx), ...relOrBadArgs(String(a.path)).split('/'));
      await compileRunner(ctx, uri);
      return { via: a.path === undefined ? 'activeEditor' : 'path' };
    },
  });

  // 伴生那颗也落地（R161 批次六）：audit=现扫未录入实例只读报——与 completeBindings 打「发现→修复」一对，
  //   并把契约挂账的最后一颗 RPC 兼容面 pending 吃光（sys.selfCheck drift 从此归零）。
  registerTool({
    id: 'compile.auditBindings', title: '审计未录入实例（只读）',
    description: '读：列该文档各层「同名兜底解析、未录入绑定配置」的实例（宿主按盘现算＝画布提示条同一把尺 collectInstanceHits）。返回 {doc, count, hits:[{ctx,name,file}]}。幂等只读。',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对文档路径' } }, required: ['doc'] },
    handler: async (ctx, a) => {
      const docRel = relOrBadArgs(String(a.doc));
      const hits = await collectInstanceHits(ctx, docRel);
      return { doc: docRel, count: hits.length, hits };
    },
  });

registerTool({
    id: 'compile.completeBindings', title: '批量落绑定（写全配置）',
    description: 'L6：与画布提示条「写全配置」同一颗内核（collectInstanceHits 现扫该文档各层未录入实例 → completeFromHits 把现解析按层目录落表；已录条目一颗不碰、值按层相对）。可带 hits（compile.auditBindings 的产出原样回喂＝精控重放）。返回 {doc, scanned, written}。广播 bindingsChanged 让活画布即时销账。',
    schema: { type: 'object', properties: {
      doc: { type: 'string', description: '根相对文档路径（.v/.sv/.vh/.djs）' },
      hits: { type: 'array', description: '可选：预取命中对 [{ctx,name,file}]（一般省略＝宿主现扫）' },
    }, required: ['doc'] },
    handler: async (ctx, a) => {
      const docRel = relOrBadArgs(String(a.doc));
      const pairs = (Array.isArray(a.hits) && a.hits.length)
        ? (a.hits as Array<{ ctx: string; name: string; file: string }>)
        : await collectInstanceHits(ctx, docRel);
      const written = await completeFromHits(ctx, docRel, pairs);
      broadcastBindingsChanged();
      return { doc: docRel, scanned: pairs.length, written: written.length };
    },
  });

  /* ============ R160 批次四 四-4c：project.doctor（L5 聚合——一枪"几处坏、各处哪坏、分别打哪颗"） ============ */

  registerTool({
    id: 'project.doctor', title: '工程语义体检（内核聚合）',
    description: 'L5：一枪回答"这份工程现在几处坏、各坏在哪、分别打哪颗修"——聚合层⛔ 第三把尺：'
      + 'missing＝collectInstanceHits 原样；unresolved＝各层表值经 readMetaAt+resolveLayerValue 折叠后现场核实（与 explain 终点同判据）；'
      + 'tables＝盘上 .verilogviz.json 逐份 parse/形状判；closure＝closureOf（缺省吃最近编译单 entry）；probe＝D1 闸前预演（⛔ 执行）。'
      + 'verdicts 按 error→warn→info 排序；**info 级默认收拢，deep:true 显式展**（裁决 §8.3）。宿主预算 60、帽 128KB（truncated+total）。幂等只读。',
    schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '只体检这个目录子树（根相对；缺省全工程）' },
        probe: { type: 'string', description: '顺带预演一颗工具的闸（名字=sys.listTools；⛔ 执行＝零副作用）' },
        deep: { type: 'boolean', description: 'true＝展开 info 级读数（默认只 error/warn）' },
      },
    },
    handler: async (ctx, a, caller) => {
      const root = projectRoot(ctx);
      const dirF = a.dir ? relOrBadArgs(String(a.dir)) : '';
      const inDir = (relName: string) => !dirF || relName === dirF || relName.startsWith(`${dirF}/`);
      const HOST_CAP = 60;
      const store = new ProjectStore(vscodeFs(root), '@root');
      const [tree, sb] = await Promise.all([store.listTree(), store.listSandboxTree()]);
      const vfiles = tree.files.map((f) => f.name).filter(inDir);
      const dfiles = sb.files.map((f: { name: string }) => f.name).filter(inDir);

      // ① files 扫描：verilog 正则内核不抛（best-effort——语义发现住 bindings/closure 段，此栏对 .v 恒空＝如实）；
      //    .djs 的 parse 失败是有判据的（JSON.parse/cells 形状＝res.parseFile 同式）。
      const parseErrors: Array<{ path: string; msg: string; line: number | null }> = [];
      let djsScanned = 0;
      for (const name of dfiles) {
        if (djsScanned++ >= 300) break;
        try {
          const pj = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...name.split('/')))));
          if (!Array.isArray(pj?.cells)) parseErrors.push({ path: name, msg: '顶层没有 cells 数组', line: null });
        } catch (e) { parseErrors.push({ path: name, msg: String((e as Error)?.message || e).slice(0, 160), line: null }); }
      }

      // ② tables：逐目录探 .verilogviz.json 原文（parse/形状判＝与各层 readMetaAt 容忍面互补——它吞的坏这里点名）
      const malformed: Array<{ path: string; why: string }> = [];
      const tableDirs = ['', ...await collectTableDirs(root, root.fsPath.replace(/[\\/]+$/, '').toLowerCase())];   // 根表''层与 tableDirsOf 同法（G1 扫描含根）
      for (const dirRel of tableDirs) {
        if (!inDir(dirRel ? `${dirRel}/x` : 'x')) continue;
        const uri = vscode.Uri.joinPath(root, ...(dirRel ? dirRel.split('/') : []), META_FILE);
        let raw: Uint8Array | null = null;
        try { raw = await vscode.workspace.fs.readFile(uri); } catch { continue; }   // 无表＝不是坏
        try {
          const meta = JSON.parse(new TextDecoder().decode(raw));
          if (!meta || typeof meta !== 'object') { malformed.push({ path: (dirRel ? dirRel + '/' : '') + META_FILE, why: '顶层不是对象' }); continue; }
          if (meta.circuits !== undefined && !Array.isArray(meta.circuits)) malformed.push({ path: (dirRel ? dirRel + '/' : '') + META_FILE, why: 'circuits 不是数组' });
          if (meta.bindings !== undefined && (typeof meta.bindings !== 'object' || meta.bindings === null || Array.isArray(meta.bindings))) malformed.push({ path: (dirRel ? dirRel + '/' : '') + META_FILE, why: 'bindings 不是对象' });
        } catch (e) { malformed.push({ path: (dirRel ? dirRel + '/' : '') + META_FILE, why: `JSON 解析失败：${String((e as Error)?.message || e).slice(0, 120)}` }); }
      }

      // ③ bindings 逐宿主（hosts＝.v∪.djs 名单，预算 60）：missing＝audit 内核；unresolved＝表值现核
      const hostsOut: Array<Record<string, unknown>> = [];
      let truncatedHosts = false;
      const hosts = [...vfiles, ...dfiles];
      for (const doc of hosts.slice(0, HOST_CAP)) {
        if (hosts.length > HOST_CAP) truncatedHosts = true;
        const misses = await collectInstanceHits(ctx, doc);
        const rec = await getAllBindings(ctx, doc);                       // 链折叠根相对生效表
        const unresolved: Array<{ key: string; value: string; why: string }> = [];
        for (const [k, v] of Object.entries(rec)) {                       // 生效值现场核实（文件在否/含不含该模块——explain 终点同款检查）
          const inst = k.includes('::') ? k.slice(k.lastIndexOf('::') + 2) : k;
          try {
            const vu = vscode.Uri.joinPath(root, ...String(v).split('/'));
            const t = new TextDecoder().decode(await vscode.workspace.fs.readFile(vu));
            if (isVerilogPath(String(v))) {
              const mods = mainParse.parseVerilogModules(t);
              if (!mods.includes(inst)) unresolved.push({ key: k, value: String(v), why: `文件里没有模块「${inst}」（它定义的是：${mods.slice(0, 4).join('、') || '无'}）` });
            } else if (/\.(djs|gate)$/i.test(String(v))) {
              try { JSON.parse(t); } catch { unresolved.push({ key: k, value: String(v), why: '部件文件 JSON 解析失败' }); }
            }
          } catch { unresolved.push({ key: k, value: String(v), why: '指向的文件不存在' }); }
        }
        if (misses.length || unresolved.length) {
          hostsOut.push({ doc, missing: [...new Set(misses.map((h) => h.name))].slice(0, 30), unresolved: unresolved.slice(0, 20) });
        }
      }

      // ④ closure：显式 entry 或最近编译单（lastJobInfo）——无则如实 null
      let closure: Record<string, unknown> | null = null;
      const last = lastJobInfo();
      const closureEntry = last ? last.entry : '';   // §4.8：无显式入口参数——有最近编译单就顺检，没有如实 null
      if (closureEntry) {
        try {
          const job = await closureOf(ctx, argUri(closureEntry));
          closure = { entry: closureEntry, ok: !(job.bindingErrors && job.bindingErrors.length), bindingErrors: job.bindingErrors ?? [] };
        } catch (e) { closure = { entry: closureEntry, ok: false, bindingErrors: [`闭包计算失败：${String((e as Error)?.message || e).slice(0, 160)}`] }; }
      } else closure = { entry: null, ok: true, bindingErrors: [] };

      // ⑤ probe＝D1 同一颗预演核（⛔ 执行）
      const probe = a.probe ? probeToolNoExec(String(a.probe), ctx, caller) : null;

      // verdicts 聚合排序（B 码表在册，sev 三档；info 默认收拢只计数）——纯搬运，判据全来自上面各段。
      const verdicts: Array<Record<string, unknown>> = [];
      const info: Array<Record<string, unknown>> = [];
      for (const m of malformed) {
        verdicts.push({ id: 'B2', sev: 'error', what: '配置表坏了（整层失效）', where: m.path,
          nextTool: '(人类)在编辑器里改这份 json', nextArgs: m.why });
      }
      for (const pe of parseErrors) {
        verdicts.push({ id: 'B3', sev: 'error', what: '.djs 解析失败（画布会拒开）', where: pe.path,
          nextTool: 'res.parseFile', nextArgs: { path: pe.path } });
      }
      for (const h of hostsOut) {
        if ((h.missing as unknown[]).length) {
          verdicts.push({ id: 'B1', sev: 'error', what: `${(h.missing as unknown[]).length} 个子部件实例未录入绑定（R152 编译会拦）`, where: String(h.doc),
            nextTool: 'bindings.complete', nextArgs: { doc: String(h.doc) } });
        }
        for (const u of (h.unresolved as Array<Record<string, unknown>>)) {
          verdicts.push({ id: 'B4', sev: 'warn', what: `绑定记录对不上：${String(u.key)}→${String(u.value)}`, where: String(h.doc),
            nextTool: 'bindings.explain', nextArgs: { doc: String(h.doc), instance: String(u.key).includes('::') ? String(u.key).slice(String(u.key).lastIndexOf('::') + 2) : String(u.key) } });
        }
      }
      for (const be of ((closure?.bindingErrors as string[]) || []).slice(0, 30)) {
        verdicts.push({ id: 'B5', sev: 'error', what: be.slice(0, 200), where: String(closure?.entry ?? ''), nextTool: 'bindings.explain', nextArgs: be });
      }
      info.push({ id: 'I0', sev: 'info', what: `扫描面：verilog ${vfiles.length} 颗 / 沙盒 ${dfiles.length} 颗（宿主预算 ${HOST_CAP}${truncatedHosts ? '，超出未检——按 dir 分批' : ''}）` });
      for (const dirRel of tableDirs.filter(inDir0)) {
        info.push({ id: 'I1', sev: 'info', what: '目录层在场配置表', where: (dirRel ? dirRel + '/' : '') + META_FILE, nextTool: 'res.readBindingTables', nextArgs: { dir: dirRel } });
      }
      const sevRank: Record<string, number> = { error: 0, warn: 1, info: 2 };
      verdicts.sort((x, y) => sevRank[String(x.sev)] - sevRank[String(y.sev)]);
      const out: Record<string, any> = {
        files: { scanned: vfiles.length + Math.min(djsScanned, dfiles.length), parseErrors },
        bindings: { hosts: hostsOut, truncated: truncatedHosts },
        tables: { malformed },
        closure, probe,
        verdicts: a.deep === true ? [...verdicts, ...info] : verdicts,
        infoSuppressed: a.deep === true ? 0 : info.length,
      };
      out.total = out.verdicts.length;
      const j = JSON.stringify(out);
      if (j.length > 131072) {
        out.verdicts = out.verdicts.slice(0, 100);
        out.truncated = true;
        out.note = `verdicts 按 128KB 帽截到 100 条（total=${j.length}B 原读数——⛔ 当全貌；deep 与 dir 分批收敛）`;
      }
      return out;
      // inDir 的目录版谓词（dirRel ''＝根）
      function inDir0(dirRel: string): boolean { return !dirF || dirRel === dirF || dirRel.startsWith(`${dirF}/`) || dirF.startsWith(dirRel + '/'); }
      // D1 预演同一颗（本地函数直调；⛔ 执行——describeTool 同款零副作用）
      function probeToolNoExec(id: string, _c: typeof ctx, caller0: ToolCaller) {
        return probeTool(id, {}, { ...caller0 });
      }
    },
  });

  /* ============ circuits 族：部件/电路角色（显式取消名单在根表） ============ */

  registerTool({
    id: 'circuits.list', title: '读电路名单', description: '根表 circuits 显式名单（取消部件表）；名单外的 .djs 全是部件。幂等只读。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => ({ circuits: [...await getCircuitsSet(ctx)].sort() }),
  });

  registerTool({
    id: 'circuits.toggle', title: '翻转部件角色', description: '名单有=当前电路 → 翻回部件；没有 → 标为电路（显式取消语义）。树/画布联动由宿主订阅完成。',
    schema: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] },
    handler: async (ctx, a) => {
      const uri = argUri(a.uri);
      await togglePartRole(ctx, uri);
      const isCircuit = (await getCircuitsSet(ctx)).has(pathRel(projectRoot(ctx), uri));
      broadcastBindingsChanged();
      return { isCircuit };
    },
  });

  /* ============ res 族：readResource（pull 式零副作用，圈死工程根） ============ */

  registerTool({
    id: 'res.readProjectFile', title: '读工程文件', description: '读工程根下的文本文件（sanitizeRel 拒 `..`/绝对路径穿越；>2MB 拒）。幂等只读。',
    schema: { type: 'object', properties: { path: { type: 'string', description: '根相对路径' } }, required: ['path'] },
    handler: async (ctx, a) => {
      // 错误契约 v2（R160 四-4）：这颗是"三码归位"的样板——穿越＝调用方写错（BAD_ARGS）、
      // 查无＝现场问题（NOT_FOUND）、过大＝目标问题（TOO_LARGE），⛔ 都挤进 HANDLER_ERROR 让 agent 猜。
      const rel = relOrBadArgs(String(a.path));   // 同款首刀并成一族一把尺（helper 见四-3 区头）
      const root = projectRoot(ctx);
      const uri = vscode.Uri.joinPath(root, ...rel.split('/'));
      let st: { size: number; type?: number } | null = null;
      try { st = await vscode.workspace.fs.stat(uri); } catch { st = null; }
      if (!st) {
        throw new ToolError('NOT_FOUND', `[API_NOT_FOUND]「${rel}」查无此档`, '', 'res.listProject（.v/.sv/.vh）/ res.listSandbox（.djs）列在册名再打');
      }
      if ((st as { type?: number }).type === 2) {
        throw new ToolError('BAD_ARGS', `[API_BAD_ARGS]「${rel}」是目录不是文件`, '', '列目录内容＝res.listProject / res.listSandbox（按 dir 视野）');
      }
      // 错误契约 v2（R160 四-4）：过大拒读＝调用方问题不是工具炸——收编 TOO_LARGE 码（旧版裸 Error 会被
      //   执行器折成 HANDLER_ERROR，把"你塞了颗 5MB 的"读成"工具内部故障"，归责反向）。
      if (st.size > 2 * 1024 * 1024) {
        throw new ToolError('TOO_LARGE',
          `[API_TOO_LARGE] 文件过大（${st.size}B > 2MB）：⛔ 整读`, '',
          '按段/专用工具读：.v/.djs 语义看 res.parseFile（自带 256KB 帽截标），其余 res.listProject 定位后换小目标');
      }
      return { path: rel, size: st.size, content: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) };
    },
  });

  registerTool({
    id: 'res.listProject', title: '列编译域文件', description: '工程树（编译域 .v/.sv/.vh + 全量目录，跳过 node_modules/点开头；深度 16 护栏）。幂等只读。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const t = await new ProjectStore(vscodeFs(projectRoot(ctx)), '@root').listTree();
      return { files: t.files.map((f) => ({ name: f.name, kb: Math.round(f.size / 102.4) / 10 })), folders: t.folders };
    },
  });

  registerTool({
    id: 'res.listSandbox', title: '列沙盒域文件', description: '工程树的沙盒那份（.djs）。幂等只读。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const t = await new ProjectStore(vscodeFs(projectRoot(ctx)), '@root').listSandboxTree();
      return { files: t.files.map((f) => ({ name: f.name, kb: Math.round(f.size / 102.4) / 10 })), folders: t.folders };
    },
  });

  /* ============ compile 族（只读分析；compileAndShow 的 UI 面仍在命令层） ============ */

  registerTool({
    id: 'compile.closure', title: '依赖闭包', description: '.v 入口的编译依赖闭包（拓扑文件名单+顶层模块）。R152 绑定权威：未显式绑定的实例进 bindingErrors（配套 bindings.set 补录）。幂等只读；⛔ 文件内容（大）。',
    schema: { type: 'object', properties: { uri: { type: 'string', description: '入口 .v（根相对或 fsPath）' } }, required: ['uri'] },
    handler: async (ctx, a) => {
      const job = await closureOf(ctx, argUri(a.uri));
      return { topModule: job.topModule, files: job.files.map((f) => f.name), bindingErrors: job.bindingErrors ?? [] };
    },
  });

  /* ============ sys 族：discoverTools / readLogs / getStatus ============ */

  registerTool({
    id: 'sys.listTools', title: '工具发现', description: '§15 discoverTools：全部上账工具的 id/标题/描述/参数 schema/契约属性。agent 必须以它为准，⛔ 靠经验猜签名。',
    schema: { type: 'object', properties: {} },
    handler: async () => {
      const c = loadApiContract();
      return {
        apiVersion: c.apiVersion,
        surfacesGlobal: c.surfacesGlobal ?? {},
        tools: listTools().map((tool) => {
          const ct = c.tools[tool.id];
          return {
            id: tool.id, title: t(tool.title), description: t(tool.description), schema: tSchema(tool.schema),   // i18n：元数据渲染层翻译（数据存中文）
            perm: ct?.perm, sideEffects: ct?.sideEffects, surfaces: ct?.surfaces,
            requiresApproval: !!ct?.requiresApproval, ref: ct?.ref, since: ct?.since,
          };
        }),
      };
    },
  });

  registerTool({
    id: 'sys.ping', title: '活体探针',
    description: 'L0 半毫秒探针：扩展活着没、activate 活到哪一步（检查点账，半活假象终结者）、MCP 桥听没听、挂了多久。零实参零副作用，agent 进门第一枪。',
    schema: { type: 'object', properties: {} },
    handler: async () => ({ alive: true, activation: activationSnapshot(), bridge: bridgeSnapshot() }),
  });

  registerTool({
    id: 'sys.getStatus', title: '宿主状态', description: '契约版本/调用面/工具账规模/工程根＋活体三格（activation 检查点/bridge 桥态/openDocs 活画布/lastCompile 最近编译单）。幂等只读。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const c = loadApiContract();
      return {
        apiVersion: c.apiVersion,
        surfacesGlobal: c.surfacesGlobal ?? {},
        contractTools: Object.keys(c.tools).length,
        registeredTools: listTools().length,
        projectRoot: projectRoot(ctx).fsPath.replace(/\\/g, '/'),
        activation: activationSnapshot(),
        bridge: bridgeSnapshot(),
        openDocs: openDocsSnapshot(),
        lastCompile: lastJobInfo(),
      };
    },
  });

  registerTool({
    id: 'sys.ctxSnapshot', title: '宿主隐式态快照（如实转述）',
    description: 'L2「现场是什么」：活动编辑器/最后文本 uri/沙盒粘滞档/编译 Panel 与最近编译单/活画布清单/可见页签。'
      + '专治 P3（隐式上下文劫持族）：agent ⛔ 猜"现在是谁"——一切写操作的目标仍须显式实参，这颗只供**看见**。全字段可 null，null 也是真话。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const ed = vscode.window.activeTextEditor;
      const sb = getActiveSandboxDocUri();
      const circuits = sb ? await getCircuitsSet(ctx) : new Set<string>();
      const norm = (u: vscode.Uri | undefined | null): string | null => (u ? u.fsPath.replace(/\\/g, '/') : null);
      const tg = (vscode.window as any).tabGroups;
      const visibleTabs = (tg?.all ?? []).flatMap((g: any) => g.tabs ?? []).map((t: any) => ({
        label: String(t.label ?? ''),
        kind: t.input?.viewType ? `custom:${t.input.viewType}` : (t.input?.uri ? 'editor' : 'other'),
        active: !!t.isActive,
      }));
      return {
        activeEditor: ed ? { path: norm(ed.document.uri), languageId: ed.document.languageId } : null,
        lastTextUri: norm(getLastTextUri()),
        // role 口径与沙盒树同一把尺：circuits 名单（根相对名）里有＝circuit，其余＝part（协议 v0.4 缺省语义）
        activeSandboxDoc: sb ? {
          name: norm(sb),
          role: circuits.has(rootRel(projectRoot(ctx), sb)) ? 'circuit' : 'part',
        } : null,
        compilePanel: { open: hostState.panelOpen, lastJob: lastJobInfo() },
        openDocs: openDocsSnapshot(),
        visibleTabs,
      };
    },
  });

  registerTool({
    id: 'sys.readAudit', title: '读调用审计', description: '§14/§15 readLogs：读 `.vv/audit/trace-YYYY-MM-DD.jsonl`（带连字符，与 apiAudit 落盘那颗串逐字一致）最近 N 行（缺省 50，帽 200）；未开户=空账。幂等只读。',
    schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD（缺省今天）。落盘名就是这颗串直接拼出来的，⛔ 另一种分隔——为免调用方猜，8 位纯数字（YYYYMMDD）也归一接受' }, limit: { type: 'number', description: '行数（缺省 50）' } },
    },
    handler: async (ctx, a) => readAuditDay(ctx, a.date, a.limit),
  });

  registerTool({
    id: 'sys.describeTool', title: '单颗工具深档（含闸门预演）',
    description: '深度 D1：一颗工具的**全部真相**＝registry 卡（标题/描述/参数 schema）+ 契约卡（perm/sideEffects/surfaces/ref/审批/since）+ 闸前预演（这一枪会不会被①②③④哪道拦、缺哪颗必填）+ 该工具最近的审计行（带 traceId）。⛔ 执行 handler＝零副作用。agent ⛔ 靠真打一枪来试签名。',
    schema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '工具 id 逐字（`fs.rename`／`host.getConfig`…）；rpc 的 method 名⛔ 裸写，要带 `host.` 前缀' },
        args: { type: 'object', description: '打算交的实参（只用于验必填项，⛔ 落盘⛔ 执行）' },
        surface: { type: 'string', enum: ['ui', 'rpc', 'mcp', 'cli'], description: '按哪条端点判闸②（缺省＝调用方自己那条）。诊断工具挂在所有端点上，所以从 agent 线问"画布那条线通不通"是正当问题' },
        subject: { type: 'string', description: '按哪个身份判闸③（缺省＝调用方自己）。⛔ 绕闸通道：只回一份判断，⛔ 执行' },
      },
      required: ['tool'],
    },
    handler: async (ctx, a, caller) => {
      const id = String(a.tool ?? '');
      const probeArgs = (a.args && typeof a.args === 'object') ? a.args as Record<string, unknown> : {};
      const tgt = targetCaller(a, caller);
      const gates = probeTool(id, probeArgs, tgt.probe);
      const c = loadApiContract();
      const def = getTool(id);
      const ct = c.tools[id];
      const ref = ct?.ref ?? id;
      // 最近 5 行按 `ref` 聚合（账本的正本读法）：⛔ 用 `tool`——拒单那几行 `tool` 是 null（⛔ 存在的工具⛔ 名字上账）。
      const day = await readAuditDay(ctx, undefined, AUDIT_CAP);
      const recent = day.lines.filter((l) => l && l.ref === ref).slice(-5)
        .map((l) => ({ ts: l.ts, verdict: l.verdict, subject: l.subject, channel: l.channel, ms: l.ms, note: l.note, traceId: l.traceId }));
      return {
        tool: id, ref,
        asked: { surface: gates.surface, subject: gates.subject, askedSurface: tgt.askedSurface, surfaceFallback: tgt.surfaceFallback },
        caller: { subject: caller.subject, surface: caller.surface, interactive: caller.interactive },
        card: def ? { id: def.id, title: t(def.title), description: t(def.description), schema: tSchema(def.schema) } : null,   // i18n：元数据渲染层翻译
        contract: ct ? { perm: ct.perm, sideEffects: ct.sideEffects, surfaces: ct.surfaces, ref: ct.ref, requiresApproval: !!ct.requiresApproval, since: ct.since ?? null } : null,
        gates, recent,
        auditDate: day.date, auditExists: day.exists,
      };
    },
  });

  registerTool({
    id: 'sys.selfCheck', title: '调用层自检（agent 进门第一枪）',
    description: '深度 D2：一枪回答"这套 API 现在能不能用、哪道闸在拦、拦了去哪查"——生效契约规模与调用面开关、registry∧契约**双向**漂移、工程覆盖 `.vv/api.json` 载入结果与被拒原因、授权档案在不在跑及其告警、审计通道三张脸（未开户/仍在缓冲/日文件为空）＋当日 verdict 统计与最近拒单（含 traceId）。可选 `probe` 顺带预演一颗工具。⛔ 任何写操作。',
    schema: {
      type: 'object',
      properties: {
        probe: {
          type: 'object',
          description: '闸前预演一颗（与 sys.describeTool 同一把尺）；给了就顺带答"这颗我现在能打吗"',
          properties: {
            tool: { type: 'string' }, args: { type: 'object' },
            surface: { type: 'string', enum: ['ui', 'rpc', 'mcp', 'cli'], description: '按哪条端点判（缺省＝调用方自己那条）' },
            subject: { type: 'string', description: '按哪个身份判闸③（缺省＝调用方自己）' },
          },
          required: ['tool'],
        },
      },
    },
    handler: async (ctx, a, caller) => {
      const c = loadApiContract();
      const ids = listTools().map((t) => t.id);
      const contractIds = Object.keys(c.tools);
      // 漂移分两颗，⛔ 合成一颗喊"有问题"：registeredOffContract＝契约在说谎（闸①当场拒，真故障）；
      // pendingHandlers＝契约上了账而 handler 还没收编（文档挂账清单，系统照常可用）。
      const drift = {
        registeredOffContract: ids.filter((i) => !c.tools[i]),
        pendingHandlers: contractIds.filter((i) => !getTool(i)),
      };
      const override = apiOverrideSnapshot();
      const grants = grantsSnapshot();
      const ch = await auditChannelState(ctx);
      const day = await readAuditDay(ctx, undefined, AUDIT_CAP);
      const byVerdict: Record<string, number> = {};
      for (const l of day.lines) if (l && typeof l.verdict === 'string') byVerdict[l.verdict] = (byVerdict[l.verdict] ?? 0) + 1;
      const denials = day.lines.filter((l) => l && l.verdict && l.verdict !== 'auto' && l.verdict !== 'approved').slice(-5)
        .map((l) => ({ ts: l.ts, ref: l.ref, verdict: l.verdict, subject: l.subject, channel: l.channel, note: l.note, traceId: l.traceId }));
      const findings = [
        ...drift.registeredOffContract.map((i) => `registry 有 handler 而契约⛔ 上账：${i}（闸①会以 not-registered 拒这颗）`),
        ...override.rejects.map((r) => `工程 .vv/api.json：${r}`),
        ...grants.notes.map((n) => `授权档案 .vv/api.grants.json：${n}`),
        ...(!ch.ready ? ['审计通道未开户（工程⛔ `.vv/`）＝调用不留账，事后无从查证'] : []),
        ...(ch.pending ? [`审计缓冲中 ${ch.pending} 行未落盘（催一下：verilogViz.auditFlush）`] : []),
      ];
      const probe = a.probe && typeof a.probe === 'object' ? a.probe as { tool?: string; args?: Record<string, unknown>; surface?: string; subject?: string } : undefined;
      return {
        apiVersion: c.apiVersion, schemaVersion: c.schemaVersion ?? null,
        surfacesGlobal: c.surfacesGlobal ?? {},
        contractTools: contractIds.length, registeredTools: ids.length,
        drift, override, grants, audit: { ready: ch.ready, pending: ch.pending, date: day.date, exists: day.exists, total: day.total, byVerdict, denials },
        caller: { subject: caller.subject, surface: caller.surface, interactive: caller.interactive },
        // verdict 只由**真故障**决定：缓冲/未收编都只是状态，把它们混进"坏了"会让这颗永远响、永远没人看。
        verdict: (drift.registeredOffContract.length || override.rejects.length || grants.notes.length || !ch.ready) ? 'attention' : 'ready',
        findings,
        ...(probe ? { probe: probeTool(String(probe.tool ?? ''), probe.args ?? {}, targetCaller(probe, caller).probe) } : {}),
      };
    },
  });
}
