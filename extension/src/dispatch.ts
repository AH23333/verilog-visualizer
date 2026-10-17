// dispatch：webview → 宿主能力的唯一路由。
// RPC 面**现读 9 颗**（getConfig/saveExportFile/publishProblems/appendOutput/copyToSandbox/
// importLegacyData/getAllBindings/setDocBindings/jumpToSource）：文件 CRUD/配置文件/剪贴板那批
// 随旧 React UI 一起退役——文件管理归原生 Explorer 与我们的两颗树，配置归
// contributes.configuration，画布要的文件内容由宿主**推**（compile/doc init）。
// ⚠ 颗数是**对账锁**的结果不是抄的：vscodeShell.test 钉「vv-api.defaults 的 rpc 投影 == 本文件
// 的 case 表」双向（漏登/幽灵都红），所以这里写死的数字改一行代码就会点红台账。
// Panel（verilogVisualizer）与 custom editor（verilogViz.doc）两条装载线共用这一份。
import * as vscode from 'vscode';
import type { FsLike } from './projectStore';
import { getAllBindings, setDocBindings, ensureDirsMeta, setBindingInDir } from './sandboxFiles';
import { loadApiContract, toolIdForRpc, canSurface } from './apiSurface';
import { auditToolCall, type AuditVerdict } from './apiAudit';
import { checkGrant } from './apiGrants';

/** Problems 面板接管：webview 编译后经 publishProblems 落到这里。
 *  ⚠ **惰性创建**：extensionHost.test 的 vscode 桩没有 createDiagnosticCollection/
 *  createOutputChannel，模块加载期求值会当场炸（host.ts 文件头"形状 1"同族教训）——
 *  必须等 activate 期（桩已就位）后首次使用时才建。 */
let diagnostics: vscode.DiagnosticCollection | undefined;
let output: vscode.OutputChannel | undefined;
function diag(): vscode.DiagnosticCollection { return (diagnostics ??= vscode.languages.createDiagnosticCollection('Verilog Viz')); }
function out(): vscode.OutputChannel { return (output ??= vscode.window.createOutputChannel('Verilog Visualizer')); }

/** `workspace.fs` 的各方法回的是 `Thenable`（不是 Promise）⇒ 必须 await 一次再回，
 *  ⛔ 用 `as any`/`as unknown as Promise` 把类型糊过去（那会让 ProjectStore 里的 try/catch 收不到 rejection） */
const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

/**
 * 工程配置的家：⚠ **一直**是 `globalStorageUri/project_files`，跟着工作区走的是源文件（见 `projectRoot`）。
 * 分成两颗是有理由的：把 `project_config.json` 扔进用户打开的那个文件夹＝在他的仓库里造一颗
 * 没人要求的文件。片 5 起配置整体换成 `contributes.configuration`，这颗目录只剩旧档迁移（片B）还读。
 */
export function configRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'project_files');
}

/**
 * 项目根＝**打开的那个文件夹**（R139 片 3 换轨）。
 * 没打开任何文件夹时退回旧家（`globalStorageUri/project_files`）。
 * 多根工作区只认第一颗（在册取舍）；扫描跳过 `node_modules` 与点开头目录（`ProjectStore.SKIP_DIRS`）。
 */
export function projectRoot(context: vscode.ExtensionContext): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri : configRoot(context);
}

/** `workspace.fs` → 我们的 `FsLike`（字符串路径以 `@root` 打头，落回 Uri） */
export function vscodeFs(rootUri: vscode.Uri): FsLike {
  const toUri = (abs: string) => {
    const rel = abs.startsWith('@root') ? abs.slice('@root'.length).replace(/^\/+/, '') : abs;
    return rel ? vscode.Uri.joinPath(rootUri, ...rel.split('/')) : rootUri;
  };
  // Thenable → Promise 的转换统一用文件顶那把 `then`（⛔ 在这里再写一份）
  return {
    readFile: (p) => then(vscode.workspace.fs.readFile(toUri(p))),
    writeFile: async (p, d) => { await then(vscode.workspace.fs.writeFile(toUri(p), d)); },
    createDir: async (p) => { await then(vscode.workspace.fs.createDirectory(toUri(p))); },
    remove: async (p, recursive) => { await then(vscode.workspace.fs.delete(toUri(p), { recursive, useTrash: false })); },
    rename: async (from, to) => { await then(vscode.workspace.fs.rename(toUri(from), toUri(to), { overwrite: false })); },
    copy: async (from, to) => { await then(vscode.workspace.fs.copy(toUri(from), toUri(to), { overwrite: true })); },
    stat: async (p) => {
      try {
        const s = await vscode.workspace.fs.stat(toUri(p));
        return { type: s.type === vscode.FileType.Directory ? 'dir' : 'file', size: s.size, mtimeMs: s.mtime };
      } catch { return null; }
    },
    readDir: async (p) => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(toUri(p));
        // X4：符号链接带 'link' 记号（与 extension.vscodeFsLike 同口径；walk 侧目录软链整支跳过）
        const kind = (t: number): 'file' | 'dir' | 'link' =>
          (t & vscode.FileType.SymbolicLink) ? 'link' : t === vscode.FileType.Directory ? 'dir' : 'file';
        return entries.map(([name, type]) => ({ name, type: kind(type) }));
      } catch { return []; }
    },
  };
}

/** 按后缀给对话框配过滤器（当年 Tauri 侧同一件事是按 defaultName 后缀做的，形状照搬） */
function filtersFor(name: string): Record<string, string[]> | undefined {
  const ext = String(name).split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = { svg: 'SVG 图片', json: 'JSON', v: 'Verilog', djs: 'Verilog 电路文档' };
  return { [map[ext] || ext.toUpperCase()]: [ext] };
}

/* ============ 活 webview 登记（配置变化要全量广播） ============ */
const sinks = new Set<vscode.Webview>();
export function registerWebviewSink(webview: vscode.Webview): void { sinks.add(webview); }
export function unregisterWebviewSink(webview: vscode.Webview): void { sinks.delete(webview); }
/** 设置改了 → 所有活画布各自 patch 自己的 settingsStore（CanvasApp/DocApp 认得这条） */
export function broadcastConfigChanged(): void {
  for (const w of sinks) void w.postMessage({ vvh: 'push', op: 'configChanged' });
}
/** `.verilogviz.json` 变了（手编/watcher 或 setBinding 写盘）→ 活画布重读绑定（R137 手改即生效）。 */
export function broadcastBindingsChanged(): void {
  for (const w of sinks) void w.postMessage({ vvh: 'push', op: 'bindingsChanged' });
}

/* ============ 六颗能力 ============ */

/** 相对名消毒（⛔ `..`/绝对路径逃逸/Windows 非法字符），返回 '/' 分隔的干净相对名 */
function sanitizeRelName(raw: unknown, fallback: string): string {
  const segs = String(raw ?? fallback)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => s.replace(/[*?"<>|:]/g, '_'));
  return segs.join('/') || fallback;
}

// ── 协议 §9.5 审计壳（刀）：计时 + 七 verdict 记账（auto/approved/denied/error/surface-denied/not-registered/not-granted）。
// 账落在 dispatch 外层＝闸前错误也进账（deny/not-registered 正是最想审计的两类）。
export async function dispatch(context: vscode.ExtensionContext, method: string, args: any): Promise<unknown> {
  const t0 = Date.now();
  const toolId = toolIdForRpc(method);
  try {
    const out = await dispatchCore(context, method, args);
    auditToolCall(context, { tool: toolId ?? undefined, ref: method, subject: "rpc",
      verdict: toolId && loadApiContract().tools[toolId].requiresApproval ? "approved" : "auto", ms: Date.now() - t0, args });
    return out;
  } catch (e) {
    const msg = String(e && (e as any).message || e);
    const verdict: AuditVerdict = msg.includes("[API_NOT_REGISTERED]") ? "not-registered"
      : msg.includes("[API_SURFACE_DENIED]") ? "surface-denied"
      : msg.includes("[API_NOT_GRANTED]") ? "not-granted"
      : msg.includes("[API_NOT_APPROVED]") ? "denied" : "error";
    auditToolCall(context, { tool: toolId ?? undefined, ref: method, subject: "rpc", verdict, ms: Date.now() - t0, args, note: msg.slice(0, 200) });
    throw e;
  }
}

async function dispatchCore(context: vscode.ExtensionContext, method: string, args: any): Promise<unknown> {
  // 协议 §9.4 执行钩子（阶段二第二刀）：RPC 面入口先过契约闸（硬序 1→2硬→3→2审批）——
  // ① surfaces 全局开关；② 工具 surfaces（未上账已在 apiSurface 反查拦掉）；③ 档案授权 api.grants.json；
  // ④ requiresApproval 的工具＝最后才暂停弹宿主确认（审批弹窗只在闸 1/3 都通过后发起；§9.4 协议硬序）。
  const toolId = toolIdForRpc(method);
  if (!toolId) throw new Error(`[API_NOT_REGISTERED] ${method} 未在 API 契约登记（加方法必先上账）`);
  if (!canSurface(toolId, 'rpc')) throw new Error(`[API_SURFACE_DENIED] ${method}：端点未对 rpc 开放（工具账 ${toolId}）`);
  // 协议⑨闸③（§9.4 第三行）：调用方档案授权——硬序 1→2(硬)→3→2(审批)，审批弹窗只在闸 1/3 都过后才发起。
  // 阶段二全部 rpc 流量都来自本扩展自己的画布 webview ⇒ subject='ui'（apiGrants.ts 头注）。
  if (!checkGrant('ui', toolId)) {
    throw new Error(`[API_NOT_GRANTED] ${method}：调用方档案（ui）未获工具 ${toolId} 授权（改 .vv/api.grants.json）`);
  }
  const tool = loadApiContract().tools[toolId];
  if (tool.requiresApproval) {
    const pick = await vscode.window.showWarningMessage(
      `API 工具「${toolId}」要求确认后执行（${method}）。${tool.description ?? ''}`, { modal: true } as any, '允许');
    if (pick !== '允许') throw new Error(`[API_NOT_APPROVED] ${method}：用户未批准（verdict=denied）`);
  }
  switch (method) {
    // Settings UI（contributes.configuration）→ 画布：一次拉全量。字体跟随原生 editor.fontSize。
    case 'getConfig': {
      const cfg = vscode.workspace.getConfiguration('verilogViz');
      return {
        compile: {
          topModule: cfg.get<string>('compile.topModule') || undefined,
          yosysOptions: cfg.get<string>('compile.yosysOptions') || undefined,
          noFlatten: cfg.get<boolean>('compile.noFlatten') ?? false,
          noOpt: cfg.get<boolean>('compile.noOpt') ?? false,
          autoRecompile: cfg.get<boolean>('compile.autoRecompile') ?? true,
        },
        sandbox: {
          gridSize: cfg.get<number>('sandbox.gridSize') ?? 16,
          showGrid: cfg.get<boolean>('sandbox.showGrid') ?? true,
          snapToGrid: cfg.get<boolean>('sandbox.snapToGrid') ?? true,
          wireStyle: cfg.get<'metro' | 'orthogonal' | 'straight'>('sandbox.wireStyle') ?? 'metro',
          defaultBits: cfg.get<number>('sandbox.defaultBits') ?? 1,
          autoStartSim: cfg.get<boolean>('sandbox.autoStartSim') ?? true,
          simSpeedMs: cfg.get<number>('sandbox.simSpeedMs') ?? 10,
          foldConstants: cfg.get<boolean>('sandbox.foldConstants') ?? true,
        },
        bindings: {
          policy: cfg.get<string>('bindings.policy') === 'strict' ? 'strict' as const : 'auto' as const,
        },
        editorFontSize: vscode.workspace.getConfiguration('editor').get<number>('fontSize'),
      };
    }

    case 'saveExportFile': {
      // 与 Rust 那颗同语义：取消＝返回 false（⛔ 报错，前端把 false 显示成"导出已取消"）
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(projectRoot(context), args.defaultName),
        filters: filtersFor(args.defaultName),
      });
      if (!target) return false;
      const bytes = Uint8Array.from(Buffer.from(String(args.base64 || ''), 'base64'));
      await vscode.workspace.fs.writeFile(target, bytes);
      return true;
    }

    // Problems/Output 的 workbench 接管（片 4）
    case 'publishProblems': {
      diag().clear();
      const root = projectRoot(context);
      for (const p of (args.items || []) as Array<{ fileName: string; line: number | null; message: string; severity: 'error' | 'warning' }>) {
        try {
          const uri = vscode.Uri.joinPath(root, String(p.fileName));
          const line = Math.max(0, (p.line ?? 1) - 1);
          const d = new vscode.Diagnostic(
            new vscode.Range(line, 0, line, 999),
            String(p.message),
            p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
          );
          d.source = 'Verilog Viz';
          diag().set(uri, [...(diag().get(uri) || []), d]);
        } catch { /* 单条失败不影响其余 */ }
      }
      return null;
    }
    case 'appendOutput': {
      out().append(String(args.text ?? ''));
      return null;
    }

    // 画布 → 沙盒：主电路 + 子部件一批落成工作区 `.djs`（B2：`folder/name` 组织，
    // 子级部件递归入库、按 celltype 名绑定——语义照抄旧 handleCopyToSandbox）。
    case 'copyToSandbox': {
      const root = projectRoot(context);
      const written: string[] = [];
      const taken = new Set<string>();
      for (const f of (args.files || []) as Array<{ name: string; content: string }>) {
        const safe = sanitizeRelName(f.name, 'circuit');
        // 重名自动 (n)（语义照抄 fileStore.getUniqueName）：对盘上现状 + 本批已占用的名字。
        // ⚠ 落盘名是 `<name>.djs`，冲突检查必须对**同一个**名字做（对裸名 stat 永远查不到）。
        let name = safe;
        for (let i = 2; taken.has(name) || await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...`${name}.djs`.split('/')))).then(() => true, () => false); i++) {
          name = `${safe} (${i})`;
        }
        taken.add(name);
        const finalSegs = `${name}.djs`.split('/');
        await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, ...finalSegs.slice(0, -1))));
        await then(vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...finalSegs), new TextEncoder().encode(String(f.content ?? ''))));
        written.push(name + '.djs');
        // M5「复制即显式绑定」：递归复制部件树时，**每个子部件**都把「裸 celltype → 本批落盘
        // 部件相对路径」写进目标目录表（撞名的用改名后路径）。层级/例化关系照旧解析，但⛔ 再
        // 依赖同文件夹同名兜底——日后同名漂移也不换实现（记录即权威）。
        // ⚠ 只处理子部件（非本批第一颗）：主电路改名与实例 celltype 无关，录进表＝死条目。
        if (written.length > 1) {
          const base = safe.includes('/') ? safe.slice(safe.lastIndexOf('/') + 1) : safe;
          const bare = base.replace(/\.djs$/i, '');
          const dirRel = finalSegs.length > 1 ? finalSegs.slice(0, -1).join('/') : '';
          await setBindingInDir(context, dirRel, bare, finalSegs.join('/'));   // 根相对全路径进表（值由函数按目录层相对化）
        }
      }
      // R137「入目录就有表」：落盘目录里出现了部件 .djs 且缺配置 → 建空模板（可见、可手编）。
      await ensureDirsMeta(context, written);
      return written;                                   // 沙盒树经 watcher 自刷（extension.ts 的 .djs watcher）
    }

    // 旧版 localStorage 档一次性迁成工作区真文件（B1）：.v/.djs 都归工作区。
    // 名字逐颗消毒（⛔ `..`/绝对路径逃逸），重名自动 (n)；返回全部落盘名。
    // X18：旧沙盒档里还带着两份**身份**——`role:'part'`（这颗是可编辑部件）与
    // `partBindings`（文件级绑定，值＝批内那颗部件的旧文件 id）。修前只交 {name,content}，
    // 两样整批丢掉 ⇒ 迁完部件退化成普通画布档、显式录入的实现关系无声变成"看同名兜底"，
    // 正是 R152「配置里录了才算」的反面。绑定值⛔ 能按名字连：重名会带 (n)、消毒会改字，
    // 所以前端逐颗带一颗 `key`（旧 id），这里用「同批下标」建 key→落盘名 再连。
    case 'importLegacyData': {
      const root = projectRoot(context);
      const written: string[] = [];
      const taken = new Set<string>();
      type LegacyIn = { name: string; content: string; key?: string; role?: string; bindings?: Record<string, string> };
      const items = (args.items || []) as LegacyIn[];
      const keyToWritten = new Map<string, string>();
      for (const it of items) {
        const withExt = /\.[A-Za-z0-9]+$/.test(sanitizeRelName(it.name, 'legacy')) ? sanitizeRelName(it.name, 'legacy') : sanitizeRelName(it.name, 'legacy') + '.v';
        let name = withExt;
        for (let i = 2; taken.has(name.toLowerCase()) || await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...name.split('/')))).then(() => true, () => false); i++) {
          const dot = withExt.lastIndexOf('.');
          name = dot > 0 ? `${withExt.slice(0, dot)} (${i})${withExt.slice(dot)}` : `${withExt} (${i})`;
        }
        taken.add(name.toLowerCase());
        await then(vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, ...name.split('/').slice(0, -1))));
        await then(vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...name.split('/')), new TextEncoder().encode(String(it.content ?? ''))));
        written.push(name);
        if (it.key) keyToWritten.set(String(it.key), name);
      }
      // 落表走 `setBindingInDir`（单层**合并一条**）⛔ `setDocBindings`（那是整表替换——
      // 迁移是往用户已有的表里加条目，整表替换＝抹掉他手编过的其它绑定）。
      // 旧档的部件语义只存在于 `.djs` 那半颗（`.v` 侧的 role/bindings 一律忽略）。
      const dangling: string[] = [];
      for (const [i, it] of items.entries()) {
        const mine = written[i];
        if (!mine || !/\.djs$/i.test(mine)) continue;
        const dirRel = mine.includes('/') ? mine.slice(0, mine.lastIndexOf('/')) : '';
        if (it.role === 'part') {
          const bare = mine.split('/').pop()!.replace(/\.djs$/i, '');
          await setBindingInDir(context, dirRel, bare, mine);                 // 「我就是这个 celltype 的实现」
        }
        for (const [celltype, boundKey] of Object.entries(it.bindings || {})) {
          const target = keyToWritten.get(String(boundKey));
          if (!target) { dangling.push(`${mine} 的「${celltype}」`); continue; }   // ⛔ 落一条永远解不开的悬空绑定
          await setBindingInDir(context, dirRel, celltype, target);
        }
      }
      if (dangling.length) {
        out().append(`[importLegacyData] ${dangling.length} 条旧绑定解不到同批落盘名（旧档里被绑的那颗没一起搬来），已跳过：\n  ${dangling.join('\n  ')}\n`);
      }
      // 迁移落盘的 .djs 同样触发「目录有部件就有表」（.v 不触发，ensureDirsMeta 内部按 .djs 过滤）
      await ensureDirsMeta(context, written);
      return written;
    }

    // 绑定关系（R137 目录级）：带 doc → 该文档目录链合并（仿 .vscode 层级设置）；
    // 不带 → 项目根表（兼容旧调用）。单条 setBinding 不走 RPC——树右键在 Extension Host 内直调。
    case 'getAllBindings': return getAllBindings(context, typeof args.doc === 'string' && args.doc ? String(args.doc) : undefined);
    case 'setDocBindings':
      await setDocBindings(context, String(args.docName || ''), (args.bindings || {}) as Record<string, string>);
      broadcastBindingsChanged();
      return null;

    // 画布双击器件 → 跳回源码行（旧 UI 的"点画布找代码"反向通道）
    case 'jumpToSource': {
      const uri = vscode.Uri.joinPath(projectRoot(context), String(args.file || ''));
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max(0, Number(args.line ?? 0));
      editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(line, 0, line, 0);
      return null;
    }

    default: throw new Error(`Extension Host 不认识的调用：${method}`);
  }
}
