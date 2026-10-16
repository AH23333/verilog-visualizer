import * as vscode from 'vscode';
import { projectRoot, registerWebviewSink, unregisterWebviewSink } from './dispatch';
import { vscodeFs } from './dispatch';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';
import { bindingsForFile, setBinding, META_FILE, openBindingConfig } from './sandboxFiles';
import { closureOf } from './compilePanel';
import { parseVerilogInstances } from './verilogParseLite';
import { ProjectStore } from './projectStore';

const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

function rel(root: vscode.Uri, uri: vscode.Uri): string {
  const rootFs = root.fsPath.replace(/[\\/]+$/, '');
  const fsPath = uri.fsPath.replace(/\\/g, '/');
  const r = rootFs.replace(/\\/g, '/');
  if (fsPath.startsWith(r)) {
    const rest = fsPath.slice(r.length);
    return rest.replace(/^\/+/, '').replace(/\\/g, '/');
  }
  return uri.fsPath.replace(/\\/g, '/');
}

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
    const inJobSet = new Set(job.files.map((f) => f.name));
    const instances: BindingInstance[] = [...tally].map(([name, count]) => {
      const recKey1 = `${docRel}::${name}`;
      const recRaw = recorded[recKey1] || recorded[name] || null;
      const rec = recRaw && /\.(v|sv|djs|gate)$/i.test(recRaw) ? recRaw : (recRaw && /\.(v|sv|djs|gate)$/i.test(String(recRaw)) ? recRaw : null);
      let auto: string | null = null;
      if (inJobSet.has(`${name}.v`)) auto = `${name}.v`;
      else if (inJobSet.has(`${name}.sv`)) auto = `${name}.sv`;
      else if (sparts.includes(`${dir}/${name}.djs`)) auto = `${dir}/${name}.djs`;
      else if (sparts.includes(`${name}.djs`)) auto = `${name}.djs`;
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

async function pushData(context: vscode.ExtensionContext, p: vscode.WebviewPanel, uri: vscode.Uri) {
  const data = await bindingDataFor(context, uri);
  p.title = `部件绑定：${basename(data.docRel)}`;
  await p.webview.postMessage({ vvh: 'binding', op: 'data', data });
}

export async function openBindingPanel(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  panelUri = uri;
  if (panel) {
    const data = await bindingDataFor(context, uri);
    panel.title = `部件绑定：${basename(data.docRel)}`;
    panel.reveal(vscode.ViewColumn.Active);
    await panel.webview.postMessage({ vvh: 'binding', op: 'data', data });
    return;
  }
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
    if (msg.op === 'ready') {
      return void pushData(context, panel!, uri);
    }
    if (msg.op === 'save') {
      const changes = msg.changes || msg.bindings || {};
      let written = 0;
      for (const [name, part] of Object.entries(changes)) {
        if (!name) continue;
        const v = part as string | null;
        if (v && v.trim()) {
          await setBinding(context, name, v, uri);
          written++;
        } else {
          await setBinding(context, name, null, uri);
        }
      }
      await pushData(context, panel!, uri);
      await panel!.webview.postMessage({ vvh: 'binding', op: 'saved', written });
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
  if (panel && panelContext && panelUri) {
    void pushData(panelContext, panel, panelUri);
  }
}
