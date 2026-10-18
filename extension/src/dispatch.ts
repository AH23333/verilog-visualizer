// dispatch：webview → 宿主能力的唯一路由（**闸与账都在 executeTool**，本文件只余名册与实现体）。
// RPC 面**现读 9 颗**（正本＝下面那颗 `RPC_METHODS`）：文件 CRUD/配置文件/剪贴板那批
// 随旧 React UI 一起退役——文件管理归原生 Explorer 与我们的两颗树，配置归
// contributes.configuration，画布要的文件内容由宿主**推**（compile/doc init）。
// ⚠ 颗数是**对账锁**的结果不是抄的：`vscodeShell.test` 三向钉死——「契约 vv-api.defaults 的 rpc 投影
// == RPC_METHODS」「RPC_METHODS == 前端 vscodeHost 真在调的方法」「RPC_METHODS == dispatchCore 的 case 表」
// （漏登/幽灵/死码都红，且都读源码文本、⛔ 等运行期），所以加一颗方法要三处一起齐。
// Panel（verilogVisualizer）与 custom editor（verilogViz.doc）两条装载线共用这一份。
import * as vscode from 'vscode';
import type { FsLike } from './projectStore';
import { getAllBindings, setDocBindings, ensureDirsMeta, setBindingInDir } from './sandboxFiles';
import { executeTool, getTool, registerTool, ToolError, type ToolSchema } from './toolRegistry';

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

// ── 协议 §9.4/§9.5：RPC 面＝统一执行器的一条投影（阶段三第一刀，卷六十二遗留①）────────────
// 修前的形状：`dispatch` 自己带一份四闸（surfaces→grants→HITL）＋一层审计壳，
// 与 `executeTool` 那份是**两套并行实现**——同一句"谁能调用什么"有两个主人，
// 两边各修各的：RPC 侧⛔ 实参必填检查、审计 subject 写成通道名、"approved" 由契约反推而⛔ 真审批。
// 现在：本文件只留**名册 + 实现体**，闸与账全部归 `toolRegistry.executeTool`（唯一执行入口）。
// 名册这颗 `RPC_METHODS` 是 rpc 面的身份清单正本：`registerRpcTools` 按它上账（运行时活着的用途），
// 对账锁（vscodeShell）拿它与契约的 rpc 投影双向比（⛔ 一份"只为文档存在"的死名单）。
// ⛔ 在 `dispatch` 里再拿它挡一次幽灵 method：前置抛错会绕过账本（见下面那句注释）。
export const RPC_METHODS = [
  'getConfig', 'saveExportFile', 'publishProblems', 'appendOutput', 'copyToSandbox',
  'importLegacyData', 'getAllBindings', 'setDocBindings', 'jumpToSource',
] as const;
export type RpcMethod = typeof RPC_METHODS[number];

/** webview → 宿主的一次调用。闸与审计都在 executeTool 里（`subject='ui'`＝本扩展画布这个身份，
 *  端点记在 `surface` 上、落账为 `channel`）。 */
export async function dispatch(context: vscode.ExtensionContext, method: string, args: any): Promise<unknown> {
  // ⛔ 在本函数"先挡野 method"：那样抛的错⛔ 不进 executeTool 的账，§9.5「每次调用必进账，含被拒」
  // 当场破洞——agent 试一个不存在的名字，账上一片干净＝那件事没发生过（修前 dispatch 就是这么漏的，
  // 而它自己那句注释还写着"审计那行由 executeTool 记"：措辞与实现对不上，证人也没测到这一格）。
  // 查册交给执行器（registry ∧ 契约 双查）：`host.<method>` 不在册 ⇒ verdict=not-registered + [API_NOT_REGISTERED]。
  return executeTool(context, { surface: 'rpc', subject: 'ui', interactive: false }, `host.${method}`, args ?? {});
}

/** webview 请求的回包唯一形状（Panel 与 custom editor 两条装载线共用；⛔ 各写一份）。
 *  `trace`＝`executeTool` 为这次调用发的那串（只对被闸拦下的 `ToolError` 有值）：
 *  画布/agent 拿到"被拒"时同时拿到账本行号，⛔ 只能复述现象回来找人。 */
export async function dispatchAndReply(
  context: vscode.ExtensionContext,
  post: (m: unknown) => void,
  msg: { id: string; method: string; args?: any },
): Promise<void> {
  try {
    post({ vvh: 'res', id: msg.id, ok: true, data: await dispatch(context, msg.method, msg.args || {}) });
  } catch (e) {
    post({
      vvh: 'res', id: msg.id, ok: false, data: undefined,
      error: String(e instanceof Error ? e.message : e),
      trace: e instanceof ToolError ? e.traceId : undefined,
    });
  }
}

async function dispatchCore(context: vscode.ExtensionContext, method: string, args: any): Promise<unknown> {
  // 闸（surfaces/grants/HITL）与实参必填检查都⛔ 在这里——统一由 executeTool 过（见上面那段）。
  // 本函数只剩"按名字干活"；名字⛔ 在名册上时 executeTool 的 handler 查账也会挡下。
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
      // 落表走 `setBindingInDir`（单层**合并一条**）⛔ `setDocBindings`（那是画布折叠视图的
      // 专用入口——v0.4 后只覆本档条目，但语义仍比"加一条"重；迁移是往用户已有的表里加条目）。
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
          // R158（协议 §5 v0.4）：旧档的 partBindings 是**那颗文档**的绑定——产前缀键（宿主段相对本层），
          // ⛔ 裸键＝把单文档的旧关系升成目录链全局规则（两域同名串味的写侧族）。部件身份那条（上）留裸：它本就是全局实现身份。
          const base = mine.split('/').pop()!;
          await setBindingInDir(context, dirRel, `${base}::${celltype}`, target);
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

    default:
      // 走到这里＝名册上有这颗而 switch 漏了一体（迁移时的真 bug 形状）。喊得响过"静默返回 undefined"。
      throw new Error(`[API_NOT_REGISTERED] ${method} 在 RPC_METHODS 名册上而 dispatchCore ⛔ 这一体（名册与实现漂移）`);
  }
}

// ── 把名册上的九颗登记成工具（唯一执行入口＝executeTool；闸、账、实参必填检查都在它那里）────
/** rpc 面各颗的**参数 schema**（文档＋校验双用）。`required` 只标"缺了必然失败"的两颗：
 *  其余几颗的旧实现本来就容缺（`args.items || []`、`?? ''`），⛔ 靠新增必填把老调用方判死。 */
const RPC_SCHEMAS: Record<RpcMethod, { title: string; schema: ToolSchema }> = {
  getConfig: {
    title: '读宿主配置', schema: { type: 'object', properties: {} },
  },
  saveExportFile: {
    title: '宿主另存为',
    schema: {
      type: 'object',
      properties: {
        base64: { type: 'string', description: '要写出去的字节（base64；消息过 JSON 通道 ⇒ ⛔ 直接交 Uint8Array）' },
        defaultName: { type: 'string', description: '默认文件名（决定另存对话框的扩展名过滤器）' },
        mime: { type: 'string', description: '调用方语义标注（当前仅用于日志/文档）' },
      },
      required: ['base64', 'defaultName'],
    },
  },
  publishProblems: {
    title: '发 Problems',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '一条 = 一行 Problems；line=null 表示给不出行（⛔ 冒充第 1 行）',
          items: {
            type: 'object',
            properties: {
              fileName: { type: 'string', description: '工作区根相对路径' },
              line: { type: ['number', 'null'], description: '1-based；null = 未知' },
              message: { type: 'string' }, severity: { type: 'string', enum: ['error', 'warning'] },
            },
          },
        },
      },
    },
  },
  appendOutput: {
    title: '写输出面板',
    schema: { type: 'object', properties: { text: { type: 'string', description: '追加的原文（宿主不加工）' } } },
  },
  copyToSandbox: {
    title: '编译图落沙盒',
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '第 0 颗 = 主电路；其余为子部件（逐颗落 `<name>.djs` 并写所在目录绑定表）',
          items: {
            type: 'object',
            properties: { name: { type: 'string', description: '`folder/name`，⛔ 带 .djs 后缀（宿主统一补）' }, content: { type: 'string', description: '画布序列化串 {cells:[…]}' } },
          },
        },
      },
    },
  },
  importLegacyData: {
    title: '旧档一次性搬运',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '旧 localStorage 档；X18 起可带身份三颗（key/role/bindings），带上就跟着落目录绑定表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '无扩展名的条目按 `.v` 落盘（源码那半颗的路径）' },
              content: { type: 'string' },
              key: { type: 'string', description: '旧档批内 id——只当这批的连接键用' },
              role: { type: 'string', enum: ['part'], description: '这颗是可编辑部件' },
              bindings: { type: 'object', description: 'celltype → 同批里那颗部件的旧 id（⛔ 名字：重名/消毒会连错档）' },
            },
          },
        },
      },
    },
  },
  getAllBindings: {
    title: '读绑定链',
    schema: { type: 'object', properties: { doc: { type: 'string', description: '根相对文档路径＝走目录链合并（近层覆盖）；不给＝项目根表原文' } } },
  },
  setDocBindings: {
    title: '写一份文档的绑定表',
    schema: {
      type: 'object',
      properties: {
        docName: { type: 'string', description: '根相对文档路径；表落在它的目录层' },
        bindings: { type: 'object', description: '只覆写**本文档**的条目（v0.4：别档前缀键⛔ 落本表、手编条目一颗不碰；本档一律产前缀键）' },
      },
    },
  },
  jumpToSource: {
    title: '跳到源码行',
    schema: {
      type: 'object',
      properties: { file: { type: 'string', description: '根相对路径' }, line: { type: 'number', description: '0-based（编辑器口径）' } },
      required: ['file'],
    },
  },
};

/** activate 期调用（与 `registerDomainTools` 同拍）。
 *  ⛔ 用 `toolsFs`/`toolsDomain` 那种模块级 `registered` 布尔：那颗标志一旦为真，
 *  `activate` 第二次调用会整批跳过登记——而 M7 幂等测试恰恰靠"再启一遍"活着。
 *  按 id 在场与否跳过：重复 activate＝空转，清场后重激活仍能补齐。 */
export function registerRpcTools(): void {
  for (const method of RPC_METHODS) {
    if (getTool(`host.${method}`)) continue;
    const meta = RPC_SCHEMAS[method];
    registerTool({
      id: `host.${method}`, title: meta.title, description: meta.title,
      schema: meta.schema,
      handler: async (ctx, args) => dispatchCore(ctx, method, args),
    });
  }
}
