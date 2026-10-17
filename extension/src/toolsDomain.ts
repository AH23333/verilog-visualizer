// ============================================================================
// 统一调用层·领域工具族（批次二，2026-10-17）：按 §15 接口范式补全
//   · discoverTools   → sys.listTools（agent 必须信权威 schema，⛔ 靠经验猜签名）
//   · readLogs        → sys.readAudit（§14 jsonl 账本的读侧——"AI 查调用"落地形态）
//   · getStatus       → sys.getStatus
//   · readResource 族 → res.readProjectFile / res.listProject / res.listSandbox（pull 式零副作用，
//                       让 agent"看懂现状"；sanitizeRel 圈死工程根 ⛔ 穿越）
//   · 领域 Tools      → bindings.*（链合并读/目录层写/审计/写全/固化）、circuits.*（名单读/角色翻转）、
//                       compile.closure（依赖闭包只读）
// 挂账（底座未建，⛔ 装样子）：undo/redo、snapshotState/restoreState（快照栈）、checkPermission
//   （策略引擎）、subscribe（hook 埋点）、readMemory/writeMemory（记忆存储）、长操作 getStatus 句柄。
// ============================================================================
import * as vscode from 'vscode';
import { registerTool, argUri } from './toolRegistry';
import { broadcastBindingsChanged, projectRoot, vscodeFs } from './dispatch';
import { ProjectStore, sanitizeRel } from './projectStore';
import {
  getAllBindings, setBindingInDir, collectInstanceHits, completeFromHits,
  materializeBindings, togglePartRole, getCircuitsSet, pathRel, META_FILE,
} from './sandboxFiles';
import { closureOf, scanDefs } from './compilePanel';
import { loadApiContract } from './apiSurface';
import { listTools } from './toolRegistry';

let registered = false;

const AUDIT_CAP = 200;   // readAudit 单次行数上限（⛔ 整账倒给 agent 撑上下文）

/** 上账入口（activate 调一次；幂等）。 */
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
        part: { type: 'string', description: '部件文件（根相对或相对该目录；null/空＝删）' },
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
      const rel = sanitizeRel(String(a.path));
      const root = projectRoot(ctx);
      const uri = vscode.Uri.joinPath(root, ...rel.split('/'));
      const st = await vscode.workspace.fs.stat(uri);
      if (st.size > 2 * 1024 * 1024) throw new Error(`文件过大（${st.size}B > 2MB）：⛔ 整读（按段/专用工具读）`);
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
        tools: listTools().map((t) => {
          const ct = c.tools[t.id];
          return {
            id: t.id, title: t.title, description: t.description, schema: t.schema,
            perm: ct?.perm, sideEffects: ct?.sideEffects, surfaces: ct?.surfaces,
            requiresApproval: !!ct?.requiresApproval, ref: ct?.ref, since: ct?.since,
          };
        }),
      };
    },
  });

  registerTool({
    id: 'sys.getStatus', title: '宿主状态', description: '契约版本/调用面开关/工具账规模/工程根。幂等只读。',
    schema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const c = loadApiContract();
      return {
        apiVersion: c.apiVersion,
        surfacesGlobal: c.surfacesGlobal ?? {},
        contractTools: Object.keys(c.tools).length,
        registeredTools: listTools().length,
        projectRoot: projectRoot(ctx).fsPath.replace(/\\/g, '/'),
      };
    },
  });

  registerTool({
    id: 'sys.readAudit', title: '读调用审计', description: '§14/§15 readLogs：读 `.vv/audit/trace-YYYY-MM-DD.jsonl`（带连字符，与 apiAudit 落盘那颗串逐字一致）最近 N 行（缺省 50，帽 200）；未开户=空账。幂等只读。',
    schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD（缺省今天）。落盘名就是这颗串直接拼出来的，⛔ 另一种分隔——为免调用方猜，8 位纯数字（YYYYMMDD）也归一接受' }, limit: { type: 'number', description: '行数（缺省 50）' } },
    },
    handler: async (ctx, a) => {
      // ⚠ 日文件名口径与 apiAudit.flushAudit 逐字一致（trace-YYYY-MM-DD.jsonl，带连字符）——
      //   自检抓到的真 bug：读侧曾用无连字符 YYYYMMDD ⇒ 永远 exists:false。
      // ⚠ 归一⛔ 靠描述：这颗是**对外实参**（系统边界），agent 照上一版 schema 交 `20261017`
      //   就会读成"查无此档"，而那句读数看起来完全像"今天没人调用过"——把调用方的笔误
      //   伪装成事实是最贵的一种错（同族：browserHost 返回空结果冒充"宿主没有"）。
      const rawDate = String(a.date ?? new Date().toISOString().slice(0, 10));
      const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
      const limit = Math.min(Math.max(Number(a.limit ?? 50), 1), AUDIT_CAP);
      const uri = vscode.Uri.joinPath(projectRoot(ctx), '.vv', 'audit', `trace-${date}.jsonl`);
      let raw: string;
      try { raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); }
      catch { return { exists: false, date, lines: [] }; }
      const all = raw.split('\n').filter(Boolean);
      const lines = all.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      return { exists: true, date, total: all.length, lines };
    },
  });
}
