import * as vscode from 'vscode';
import { projectRoot, registerWebviewSink, unregisterWebviewSink } from './dispatch';
import { vscodeFs } from './dispatch';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';
import { bindingsForFile, setBinding, META_FILE, openBindingConfig, collectInstanceHits, relFrom } from './sandboxFiles';
import { closureOf, scanDefs } from './compilePanel';
import { parseVerilogInstances, parseVerilogModules } from './verilogParseLite';
import { ProjectStore } from './projectStore';
import { isBindingTargetValue, isVerilogPath, rootRel } from './verilogDomain';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

// 根相对名转交一颗主人（R153 深度自检：本仓曾有六份各自实现，其中三份截前缀＝盘符大小写一漂就交坏值）
function rel(root: vscode.Uri, uri: vscode.Uri): string { return rootRel(root, uri); }

function basename(rel: string): string {
  const parts = rel.split('/');
  return parts[parts.length - 1];
}

export interface BindingInstance {
  name: string;
  count?: number;
  auto: string | null;
  recorded: string | null;
  /** 2026-10-18 多层点名：深层行的宿主文件（根相对）；顶层行不带＝形状向后兼容 */
  ctx?: string;
  /** 写回/选中主键：顶层＝裸 name；深层＝`宿主::实例` 前缀键（表语义同一把尺） */
  key?: string;
}
export interface BindingData {
  docRel: string;
  docName: string;
  mode: 'djs' | 'verilog';
  instances: BindingInstance[];
  parts: string[];
  meta: string;
}

export async function bindingDataFor(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<BindingData> {
  const root = projectRoot(context);
  const docRel = rel(root, uri);
  const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  const recorded = await bindingsForFile(context, docRel);
  const store = new ProjectStore(vscodeFs(root), '@root');

  if (/\.djs$/i.test(uri.fsPath)) {
    const content = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(uri)));
    const tally = new Map<string, number>();
    const cells = JSON.parse(content)?.cells;
    if (Array.isArray(cells)) {
      for (const c of cells as Array<{ type?: string; celltype?: string }>) {
        if (c?.type === 'Subcircuit' && c.celltype) {
          tally.set(String(c.celltype), (tally.get(String(c.celltype)) || 0) + 1);
        }
      }
    }
    const sandbox = await store.listSandboxTree();
    const sandboxFiles = sandbox.files.map((f) => f.name);
    const parts = sandboxFiles
      .filter((n) => n.toLowerCase() !== docRel.toLowerCase())
      .sort((a, b) => a.localeCompare(b));
    const instances: BindingInstance[] = [...tally].map(([name, count]) => {
      const recKey1 = `${docRel}::${name}`;
      const rec = recorded[recKey1] || recorded[name] || null;
      let auto: string | null = null;
      if (sandboxFiles.includes(`${dir}/${name}.djs`)) auto = `${dir}/${name}.djs`;
      else if (dir && sandboxFiles.includes(`${name}.djs`)) auto = `${name}.djs`;
      else if (sandboxFiles.includes(`${name}.djs`)) auto = `${name}.djs`;
      return { name, count, auto, recorded: rec };
    });
    // 多层点名（2026-10-18）：顶层⛔ 是画布的全部——部件文件的**内部实例**同样要录、要能在这张面板改。
    //   行数据直接吃 `collectInstanceHits({all:true})`（宿主模拟画布解析链的**同一颗主人**，⛔ 第二份打分表）。
    try {
      const deep = await collectInstanceHits(context, docRel, { all: true });
      const seenKey = new Set<string>();
      for (const h of deep) {
        if (h.ctx === docRel) continue;                                    // 顶层行 tally 已聚合
        const key = `${h.ctx}::${h.name}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const rec = recorded[key] || null;
        instances.push({ name: h.name, ctx: h.ctx, key,
          auto: rec ? null : (h.file || null), recorded: rec });
      }
    } catch { /* 深层读不到盘＝只展顶层，⛔ 整颗面板挂掉 */ }
    return {
      docRel,
      docName: docRel,
      mode: 'djs',
      instances,
      parts,
      meta: `${dir ? dir + '/' : ''}${META_FILE}`,
    };
  } else {
    const job = await closureOf(context, uri);
    const tally = new Map<string, number>();
    for (const f of job.files) {
      for (const i of parseVerilogInstances(f.content)) {
        if (i !== job.topModule) tally.set(i, (tally.get(i) || 0) + 1);
      }
    }
    const tree = await store.listTree();
    const sandbox = await store.listSandboxTree();
    const vparts = tree.files.map((f) => f.name);
    const sparts = sandbox.files.map((f) => f.name);
    const parts = [...vparts, ...sparts]
      .filter((n, idx, arr) => arr.findIndex((x) => x === n) === idx)
      .filter((n) => n.toLowerCase() !== docRel.toLowerCase())
      .sort((a, b) => a.localeCompare(b));
    // 「自动同名」的一颗主人＝`scanDefs`（模块名 → **真定义它的文件**，全工作区扫，与「写全配置」同源）。
    // 修前这里拿闭包 `job.files` 建索引：闭包只含**已录入绑定**的文件，而这一栏是给**未录入**实例看的
    // ⇒ 按构造永远命不中（面板对每个未录入实例一直报"未绑定"，盘上明明有那颗实现文件看不见）。
    const defRel = new Map<string, string>();
    for (const [mod, defUri] of await scanDefs()) defRel.set(mod, rel(root, defUri));
    const instances: BindingInstance[] = [...tally].map(([name, count]) => {
      const recKey1 = `${docRel}::${name}`;
      const recRaw = recorded[recKey1] || recorded[name] || null;
      // recorded 值的合法性问一颗主人（原来这里把同一串正则写了两遍，而名单与编译侧已经分岔）
      const rec = recRaw && isBindingTargetValue(recRaw) ? recRaw : null;
      let auto: string | null = defRel.get(name) ?? null;
      if (auto === docRel) auto = null;                     // ⛔ 把自己录成部件
      if (!auto) {
        if (sparts.includes(`${dir}/${name}.djs`)) auto = `${dir}/${name}.djs`;
        else if (sparts.includes(`${name}.djs`)) auto = `${name}.djs`;
      }
      return { name, count, auto, recorded: recRaw && !auto && !rec ? recRaw : (rec || null) };
    });
    return {
      docRel,
      docName: docRel,
      mode: 'verilog',
      instances,
      parts,
      meta: `${dir ? dir + '/' : ''}${META_FILE}`,
    };
  }
}

let panel: vscode.WebviewPanel | undefined;
let panelUri: vscode.Uri | undefined;
let panelContext: vscode.ExtensionContext | undefined;
// 最近一次"从哪颗实例来的"（层次树点击/右键带上）——每次推 data 后跟着推 focus，
// 面板复用/重显都保持定位（用户 2026-10-18 实锤：点 alu_top 打开后满表找不着那颗行）。
let panelFocus: string | undefined;

/** **Webview is disposed 事故绳**（真机实证：面板关闭/复用竞态里 postMessage/改 title 会把
 *  "Webview is disposed" 冒成命令错误）。可抛面收拢成三件：①复用先探测活尸（探到就当无）；
 *  ②一切 webview 触碰走 pushSafe（吞掉 disposed＝面板没了，用户重开就有）；③探尸用「读 html」
 *  这颗 guaranteed-throw 的标准方法。 */
function livePanel(p: vscode.WebviewPanel | undefined): boolean {
  if (!p) return false;
  try { void p.webview.html; return true; } catch { return false; }
}

async function pushSafe(p: vscode.WebviewPanel | undefined, msg: unknown): Promise<void> {
  if (!p) return;
  try { await p.webview.postMessage(msg); } catch { /* 面板没了＝消息自然没处投 */ }
}

/** 一条完整"喂数据"：data 之后**必跟** focus 解析推送（若有）——2026-10-18 实锤：
 *  面板复用路当时只补推了 data 忘推 focus，第二次点层次树行聚焦静默丢。两路共用这颗主人。 */
async function pushDataAndFocus(context: vscode.ExtensionContext, p: vscode.WebviewPanel | undefined, uri: vscode.Uri) {
  if (!p) return;
  const data = await bindingDataFor(context, uri);
  if (!livePanel(p)) return;                       // 数据途中面板关了 ⇒ ⛔ 再去摸 title/postMessage
  try { p.title = `部件绑定：${basename(data.docRel)}`; } catch { return; }
  await pushSafe(p, { vvh: 'binding', op: 'data', data });
  // 聚焦行换到**写回主键**口径：顶层＝裸名；深层＝`宿主::实例`（BindingApp 同一把尺查行）
  if (panelFocus) {
    const key = data.instances.find((i) => i.name === panelFocus || i.key === panelFocus)?.key ?? panelFocus;
    await pushSafe(p, { vvh: 'binding', op: 'focus', name: key });
  }
}

export async function openBindingPanel(context: vscode.ExtensionContext, uri: vscode.Uri, focus?: string): Promise<void> {
  panelUri = uri;
  // focus ⛔ 粘到下一颗文档：每次打开以当次为准（没带＝这轮⛔ 硬聚焦别档的旧行）
  panelFocus = focus;
  if (livePanel(panel)) {
    // 复用路也走同一颗主人：data + focus 一起补——旧版手写一份只推 data，第二次点行聚焦静默丢（2026-10-18 实锤）
    const p = panel!;
    p.reveal(vscode.ViewColumn.Active);
    await pushDataAndFocus(context, p, uri);
    return;
  }
  panel = undefined;                                // 尸体（dispose 事件还没走到的窗口期）就地清掉——再走新建
  panelContext = context;
  panel = vscode.window.createWebviewPanel(
    'verilogViz.binding',
    `部件绑定：${basename(rel(projectRoot(context), uri))}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: webviewRoots(context),
      retainContextWhenHidden: true,
    },
  );
  registerWebviewSink(panel.webview);

  const html = await loadWebviewHtml(context, panel.webview, 'binding.html');
  panel.webview.html = html ?? '<h1>找不到 binding.html（先 pnpm build）</h1>';

  panel.onDidDispose(() => {
    unregisterWebviewSink(panel!.webview);
    panel = undefined;
    panelUri = undefined;
  });

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    if (msg?.vvh !== 'binding') return;
    const p = panel;                                  // 本消息所属代次；处理途中面板被关＝pushSafe 自然吞
    if (msg.op === 'ready') {
      return void pushDataAndFocus(context, p, uri);
    }
    if (msg.op === 'save') {
      const changes = msg.changes || msg.bindings || {};
      // 写前校验：编译域目标（.v/.sv/.vh，一颗主人给名单）必须真的定义了该模块（真机惨案：实例 counter 记到 r50_counter.v，
      // 该文件定义的其实是 r50_counter——"绑定完成"却注定 [BINDING_UNRESOLVED_RECORD]。
      // 零件清单只是文件名维度，语义校验只能在这里把关——改错时把该文件内实际定义一并报出来。
      const errors: string[] = [];
      for (const [name, part] of Object.entries(changes)) {
        if (!name) continue;
        const inst = name.includes('::') ? name.slice(name.lastIndexOf('::') + 2) : name;  // 深层行＝前缀键，模块名在 :: 后
        const v = part as string | null;
        // 候选值口径＝**根相对**（parts 清单直接交来的名字、completeFromHits 交的 file 同一尺；
        //   裸旧值按根解——面板⛔ 产裸相对值，别在这里发明第二把尺）。
        const absOf = (s: string): vscode.Uri => vscode.Uri.joinPath(projectRoot(context), ...s.split('/'));
        if (v && isVerilogPath(v.trim())) {
          let mods: string[] | null = null;
          try {
            mods = parseVerilogModules(new TextDecoder().decode(await then(vscode.workspace.fs.readFile(absOf(v.trim())))));
          } catch { /* 读失败也要报 */ }
          if (!mods) errors.push(`「${inst}」→ ${v}：文件读取失败，先确认路径存在。`);
          else if (!mods.includes(inst)) errors.push(`「${inst}」→ ${v}：该文件里没有名为「${inst}」的模块（它定义的是：${mods.slice(0, 4).join('、') || '无'}${mods.length > 4 ? '…' : ''}）。`);
        } else if (v && /\.(djs|gate)$/i.test(v.trim())) {
          try { await then(vscode.workspace.fs.stat(absOf(v.trim()))); }
          catch { errors.push(`「${inst}」→ ${v}：部件文件不存在。`); }
        }
      }
      if (errors.length) { await pushSafe(p, { vvh: 'binding', op: 'saveError', errors }); return; }
      let written = 0;
      // 面板深层行的 key＝根相对前缀（`sub/ctrl.djs::adder`，读侧折叠后的形状）；**进表必须换成
      //   表层目录相对**（`ctrl.djs::adder`）——bindingsForFile 折叠语义按层相对写，两把尺⛔ 混。
      const docRelNow = rel(projectRoot(context), uri);
      const dirNow = docRelNow.includes('/') ? docRelNow.slice(0, docRelNow.lastIndexOf('/')) : '';
      const tableKey = (k: string): string =>
        k.includes('::') ? `${relFrom(dirNow, k.slice(0, k.lastIndexOf('::')))}${k.slice(k.lastIndexOf('::'))}` : k;
      for (const [name, part] of Object.entries(changes)) {
        if (!name) continue;
        const v = part as string | null;
        if (v && v.trim()) { await setBinding(context, tableKey(name), v.trim(), uri); written++; }
        else { await setBinding(context, tableKey(name), null, uri); }
      }
      await pushDataAndFocus(context, p, uri);
      await pushSafe(p, { vvh: 'binding', op: 'saved', written });
      return;
    }
    if (msg.op === 'openConfig') {
      await openBindingConfig(context, uri);
      return;
    }
  });

  await pushDataAndFocus(context, panel, uri);
}

export function notifyBindingPanelBindingsChanged(): void {
  if (livePanel(panel) && panelContext && panelUri) {
    void pushDataAndFocus(panelContext, panel!, panelUri);
  }
}
