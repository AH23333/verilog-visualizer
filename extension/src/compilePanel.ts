// 编译域文件（`.v/.sv/.vh`）的编译查看（片 5-A3）：源码文件的主人是**原生文本编辑器**；画布是派生视图——
// 标题按钮/Ctrl+F5 → 依赖闭包（工作区扫描 + **绑定表权威覆盖**）→ 推给画布 Panel。
// 保存自动重编译：面板开着且保存的文件在闭包里 → 同一入口重算重推。
//
// R152 权威裁决（用户）：「绑定即权威」——**所有被例化的模块都必须显式绑定**，⛔ 同名自动兜底。
// `.verilogviz.json` 里录了 `<模块名>: <某.v/.djs>` 的，闭包照表取（解不到＝报错）；
// 没录的 ⇒ 直接报错（编译拦下，引导「写全配置」/「部件绑定」弹窗录制）。与沙盒画布同一条绑定真理。
import * as vscode from 'vscode';
import * as path from 'path';
import { projectRoot } from './dispatch';
import { bindingsForFile } from './sandboxFiles';
import { parseVerilogModules, parseVerilogInstances, parseVerilogInstancesWithLines } from './verilogParseLite';
import { findVerilogUris, isVerilogPath, rootRel, stripVerilogExt } from './verilogDomain';
import { djsToVerilog } from './djsVerilog';

/** 推给 webview 的编译单：files 全量给（yosys 要看依赖闭包），topModule 定根 */
export interface CompileJob {
  files: Array<{ name: string, content: string }>;
  topModule: string;
  entryName: string;
  /** R152：绑定解析失败清单（未录入 / 录入的文件缺失或不含该模块 / `.djs` 部件转换失败）——编译拦下并红字告知 */
  bindingErrors?: string[];
  /** 诊断锚点（与 bindingErrors **逐条等长平行**）：缺失绑定的部件在宿主源文件里的 1-based 行号
   *  ——Problems 从"全锚文件首行"改锚实例行（用户裁决：报错要落在出事的地方）。给不出行＝缺条目。 */
  bindingAnchors?: Array<{ file: string; line: number | null }>;
}

/** 画布 Panel 的打开/复用（extension.ts 注入，避免反向依赖） */
export type EnsurePanel = (context: vscode.ExtensionContext) => Promise<vscode.WebviewPanel> | vscode.WebviewPanel;

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** 工作区全部**编译域**文件（.v/.sv/.vh）的 模块名→定义文件 索引（每次现扫；源码是用户正在编辑的东西，⛔ 缓存陈旧定义）。
 *  bindParts/materialize 的「自动同名」预览也吃它（一个主人一份扫描）。 */
export async function scanDefs(): Promise<Map<string, vscode.Uri>> {
  const map = new Map<string, vscode.Uri>();
  for (const uri of await findVerilogUris()) {
    try {
      for (const mod of parseVerilogModules(await readText(uri))) if (!map.has(mod)) map.set(mod, uri);
    } catch { /* 读不到的文件跳过 */ }
  }
  return map;
}

const toRel = (root: vscode.Uri, uri: vscode.Uri): string => rootRel(root, uri);   // 根相对名一颗主人

/**
 * 依赖闭包：从入口文件出发，例化了谁就把谁的**定义文件**拉进来，直到闭包（环守卫＝visited 集）。
 * R152 绑定权威（用户裁决）：**所有被例化的模块都必须显式绑定**——⛔ 再无同名自动兜底。
 *   录了 ⇒ 按表取（缺失/不含该模块 ⇒ bindingErrors）；未录入 ⇒ bindingErrors（编译报错）。
 *   值 `.v/.sv` ⇒ 定义文件直接入闭包；值 `.djs/.gate` 部件 ⇒ `djsToVerilog` 转 module 入闭包，
 *   其子部件（Subcircuit）按**该部件所在目录**的绑定表递归解析。
 * 每层按其**文档目录**的绑定链解析（`bindingsForFile`）——跨目录部件各用各层的表。
 */
export async function closureOf(context: vscode.ExtensionContext, entry: vscode.Uri): Promise<CompileJob> {
  const root = projectRoot(context);
  const entryRel = toRel(root, entry);
  const cfg0 = vscode.workspace.getConfiguration('verilogViz');
  const bindingErrors: string[] = [];
  const files = new Map<string, { name: string, content: string }>();
  const seen = new Set<string>();                       // 真实文件（fsPath）与合成文件（名）统一去重
  const synthSeen = new Set<string>();
  const bindCache = new Map<string, Record<string, string>>();
  const anchors: Array<{ file: string; line: number | null }> = [];   // 与 bindingErrors 逐条平行（见 CompileJob 注）
  const bindingsFor = async (ownerRel: string): Promise<Record<string, string>> => {
    const dir = ownerRel.includes('/') ? ownerRel.slice(0, ownerRel.lastIndexOf('/')) : '';
    if (!bindCache.has(dir)) bindCache.set(dir, await bindingsForFile(context, dir ? `${dir}/_` : '_'));
    return bindCache.get(dir)!;
  };
  // 队列项：真实文件与合成（`.djs` 转换产物）同构——都带 name/content/ownerRel（ownerRel 决定其绑定目录）
  const queue: Array<{ name: string; content: string; ownerRel: string }> = [{ name: entryRel, content: '', ownerRel: entryRel }];
  seen.add(entryRel.toLowerCase());
  let entryText = '';
  while (queue.length) {
    const item = queue.shift()!;
    let content = item.content;
    if (!content) {
      try { content = await readText(vscode.Uri.joinPath(root, ...item.name.split('/'))); } catch { continue; }
    }
    files.set(item.name.toLowerCase(), { name: item.name, content });
    if (!entryText) entryText = content;
    const ovs = await bindingsFor(item.ownerRel);
    // 实例行锚点：每错误条目都要有对应锚（⛔ 平行数组断位）——文件级错误全给真实行，真机点击落例化处
    const instLine = new Map(parseVerilogInstancesWithLines(content).map((r) => [r.name, r.line]));
    const anchorOf = (name: string): { file: string; line: number | null } =>
      ({ file: item.name, line: instLine.get(name) ?? null });
    for (const inst of parseVerilogInstances(content)) {
      // R145 多层精控：`宿主文档::实例名` 前缀键只约束那一层；无命中回落裸键。⛔ 无同名兜底。
      const ov = ovs[`${item.name}::${inst}`] ?? ovs[`${item.ownerRel}::${inst}`] ?? ovs[inst];
      if (!ov) {
        bindingErrors.push(`[BINDING_MISSING] 模块「${inst}」（在 ${item.name}）未录入绑定配置：右键「写全配置」或用「部件绑定」弹窗录制`);
        anchors.push(anchorOf(inst));
        continue;
      }
      if (isVerilogPath(ov)) {
        const def = vscode.Uri.joinPath(root, ...ov.split('/'));
        try {
          const defText = await readText(def);
          const defMods = parseVerilogModules(defText);
          if (!defMods.includes(inst)) {
            bindingErrors.push(`[BINDING_UNRESOLVED_RECORD] 模块「${inst}」按记录取「${ov}」，但该文件里没有它（recorded → ${ov}；该文件内定义的是：${defMods.slice(0, 4).join('、') || '无'}${defMods.length > 4 ? '…' : ''}）`);
            anchors.push(anchorOf(inst));
            continue;
          }
        } catch {
          bindingErrors.push(`[BINDING_UNRESOLVED_RECORD] 模块「${inst}」按记录取「${ov}」，但文件不存在（recorded → ${ov}）`);
          anchors.push(anchorOf(inst));
          continue;
        }
        const key = def.fsPath.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ name: toRel(root, def), content: '', ownerRel: toRel(root, def) });
      } else if (/\.(djs|gate)$/i.test(ov)) {
        // M2：`.djs/.gate` 部件 → 转 Verilog module 注入闭包；子部件按部件所在目录递归。
        const genName = ov.replace(/\.(djs|gate)$/i, '') + `.${inst}.v`;
        if (synthSeen.has(genName.toLowerCase())) continue;
        synthSeen.add(genName.toLowerCase());
        let cells: unknown;
        try {
          cells = (JSON.parse(await readText(vscode.Uri.joinPath(root, ...ov.split('/')))) || {}).cells;
        } catch {
          bindingErrors.push(`[UNRESOLVED_REF] 模块「${inst}」按记录取部件「${ov}」，但文件不存在或不是合法电路 json（recorded → ${ov}）`);
          anchors.push(anchorOf(inst));
          continue;
        }
        const conv = djsToVerilog(cells as never, inst);
        if (conv.errors.length) { bindingErrors.push(...conv.errors.map((e) => `（${ov}）${e}`)); anchors.push(...conv.errors.map(() => anchorOf(inst))); continue; }
        queue.push({ name: genName, content: conv.verilog, ownerRel: ov });
      } else {
        bindingErrors.push(`[SCHEMA_INVALID] 模块「${inst}」绑定为「${ov}」：不支持的绑定目标（只认编译域 .v/.sv/.vh 定义或 .djs/.gate 部件）`);
        anchors.push(anchorOf(inst));
      }
    }
  }
  const topModule = cfg0.get<string>('compile.topModule') || parseVerilogModules(entryText)[0] || stripVerilogExt(path.basename(entry.fsPath));
  return {
    files: [...files.values()], topModule, entryName: entryRel,
    ...(bindingErrors.length ? { bindingErrors, bindingAnchors: anchors } : {}),
  };
}

/** 相邻两次同一错误集不重复弹窗（保存自动重编译的刷屏守卫） */
let lastErrSig = '';
function reportBindingErrors(job: CompileJob, quiet: boolean): void {
  const errs = job.bindingErrors || [];
  const sig = errs.join('|');
  if (!errs.length) { lastErrSig = ''; return; }
  if (quiet || sig === lastErrSig) return;
  lastErrSig = sig;
  void vscode.window.showErrorMessage(`绑定记录解析失败：${errs[0]}${errs.length > 1 ? `（共 ${errs.length} 条）` : ''}`);
}

/** 面板开着时的"最近一次编译"——保存自动重编译的锚；也是 ready 握手的挂起单 */
let lastJob: { entry: vscode.Uri, closurePaths: Set<string> } | undefined;

/**
 * 画布就绪握手（编译 Panel 侧，与 doc ready 同族）：宿主在 html 赋值后立刻
 * postMessage 会被丢（webview 没装载完）——首编译因此"还没有电路"。webview 挂载完
 * 发 `{vvh:'push', op:'ready'}`，这里把挂起的编译单补推给它。
 */
export async function flushPendingCompile(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): Promise<void> {
  if (!lastJob) return;
  const job = await closureOf(context, lastJob.entry);
  lastJob.closurePaths = new Set(job.files.map((f) => f.name.toLowerCase()));
  await panel.webview.postMessage({ vvh: 'push', op: 'compile', ...job });
  reportBindingErrors(job, true);          // ready 补推＝compileAndShow 的同源重演，⛔ 二次弹
}

/** compileAndShow：入口可来自命令参数（编辑器标题按钮/资源管理器右键）或当前活动编辑器 */
export async function compileAndShow(context: vscode.ExtensionContext, argUri: vscode.Uri | undefined, ensurePanel: EnsurePanel): Promise<void> {
  let uri = argUri ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    // 活动标签是文本但焦点不在编辑器（比如刚点过 Explorer）：退而取活动 Tab 的文本文档
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab?.input instanceof vscode.TabInputText) uri = tab.input.uri;
  }
  if (!uri || !isVerilogPath(uri.fsPath)) {
    // X8 结案（片 C2）：这道门从前写死 `/\.(v|sv)$/`，`.vh` 右键"编译查看"被当场挡回＝挂账的根因。
    void vscode.window.showInformationMessage('先打开一个 Verilog 源码文件（.v/.sv/.vh），再编译查看电路。');
    return;
  }
  const job = await closureOf(context, uri);
  lastJob = { entry: uri, closurePaths: new Set(job.files.map((f) => f.name.toLowerCase())) };
  const panel = await ensurePanel(context);
  await panel.webview.postMessage({ vvh: 'push', op: 'compile', ...job });
  reportBindingErrors(job, false);
}

/** **编译域**（.v/.sv/.vh）保存钩子：面板开着 + 设置允许 + 文件在（或就是）上一次闭包 → 重算重推。
 *  R144：`.verilogviz.json` 的保存也算触发源——手编绑定表 ⇔ 画布即时生效（bindingsChanged），
 *  编译侧必须同权（⛔ "改画布生效、编译要重按 F5"的两面）；global 表改动与是否在闭包无关，直接重算。 */
export async function recompileOnSave(context: vscode.ExtensionContext, doc: vscode.TextDocument, ensurePanel: EnsurePanel): Promise<void> {
  const isMetaFile = doc.uri.path.endsWith('.verilogviz.json');
  if (!isMetaFile && !isVerilogPath(doc.uri.fsPath)) return;
  if (!(vscode.workspace.getConfiguration('verilogViz').get<boolean>('compile.autoRecompile') ?? true)) return;
  if (!lastJob) return;
  const key = toRel(projectRoot(context), doc.uri).toLowerCase();
  const inClosure = isMetaFile || doc.uri.fsPath.toLowerCase() === lastJob.entry.fsPath.toLowerCase() || lastJob.closurePaths.has(key);
  if (!inClosure) return;
  const job = await closureOf(context, lastJob.entry);
  lastJob.closurePaths = new Set(job.files.map((f) => f.name.toLowerCase()));
  const panel = await ensurePanel(context);
  await panel.webview.postMessage({ vvh: 'push', op: 'compile', ...job });
  reportBindingErrors(job, false);         // 自动重编译也报（相邻同签名去重守卫防刷屏）
}
