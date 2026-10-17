import * as vscode from 'vscode';
import { projectRoot, registerWebviewSink, unregisterWebviewSink } from './dispatch';
import { vscodeFs } from './dispatch';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';
import { bindingsForFile, setBinding, META_FILE, openBindingConfig } from './sandboxFiles';
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
  count: number;
  auto: string | null;
  recorded: string | null;
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

async function pushData(context: vscode.ExtensionContext, p: vscode.WebviewPanel | undefined, uri: vscode.Uri) {
  if (!p) return;
  const data = await bindingDataFor(context, uri);
  if (!livePanel(p)) return;                       // 数据途中面板关了 ⇒ ⛔ 再去摸 title/postMessage
  try { p.title = `部件绑定：${basename(data.docRel)}`; } catch { return; }
  await pushSafe(p, { vvh: 'binding', op: 'data', data });
}

export async function openBindingPanel(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  panelUri = uri;
  if (livePanel(panel)) {
    const p = panel!;
    const data = await bindingDataFor(context, uri);
    if (!livePanel(p)) return;
    p.title = `部件绑定：${basename(data.docRel)}`;
    p.reveal(vscode.ViewColumn.Active);
    await pushSafe(p, { vvh: 'binding', op: 'data', data });
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
      return void pushData(context, p, uri);
    }
    if (msg.op === 'save') {
      const changes = msg.changes || msg.bindings || {};
      // 写前校验：编译域目标（.v/.sv/.vh，一颗主人给名单）必须真的定义了该模块（真机惨案：实例 counter 记到 r50_counter.v，
      // 该文件定义的其实是 r50_counter——"绑定完成"却注定 [BINDING_UNRESOLVED_RECORD]。
      // 零件清单只是文件名维度，语义校验只能在这里把关——改错时把该文件内实际定义一并报出来。
      const errors: string[] = [];
      for (const [name, part] of Object.entries(changes)) {
        if (!name) continue;
        const v = part as string | null;
        if (v && isVerilogPath(v.trim())) {
          let mods: string[] | null = null;
          try {
            mods = parseVerilogModules(new TextDecoder().decode(
              await then(vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectRoot(context), ...v.trim().split('/'))))));
          } catch { /* 读失败也要报 */ }
          if (!mods) errors.push(`「${name}」→ ${v}：文件读取失败，先确认路径存在。`);
          else if (!mods.includes(name)) errors.push(`「${name}」→ ${v}：该文件里没有名为「${name}」的模块（它定义的是：${mods.slice(0, 4).join('、') || '无'}${mods.length > 4 ? '…' : ''}）。`);
        } else if (v && /\.(djs|gate)$/i.test(v.trim())) {
          try { await then(vscode.workspace.fs.stat(vscode.Uri.joinPath(projectRoot(context), ...v.trim().split('/')))); }
          catch { errors.push(`「${name}」→ ${v}：部件文件不存在。`); }
        }
      }
      if (errors.length) { await pushSafe(p, { vvh: 'binding', op: 'saveError', errors }); return; }
      let written = 0;
      for (const [name, part] of Object.entries(changes)) {
        if (!name) continue;
        const v = part as string | null;
        if (v && v.trim()) { await setBinding(context, name, v.trim(), uri); written++; }
        else { await setBinding(context, name, null, uri); }
      }
      await pushData(context, p, uri);
      await pushSafe(p, { vvh: 'binding', op: 'saved', written });
      return;
    }
    if (msg.op === 'openConfig') {
      await openBindingConfig(context, uri);
      return;
    }
  });

  await pushData(context, panel, uri);
}

export function notifyBindingPanelBindingsChanged(): void {
  if (livePanel(panel) && panelContext && panelUri) {
    void pushData(panelContext, panel!, panelUri);
  }
}
