// `.djs` 电路文档的 custom editor（片 5-A2）。
// 骨架照微软官方 custom-editor-sample（CustomEditorProvider + CustomDocument + backup/save/revert），
// 差别只有两处：
//   · webview 不吃示例页，吃 `doc.html`（纯画布入口：SandboxCanvas + PromptDialog/ConfirmDialog，无 yosys）；
//   · 消息协议：能力调用沿用 vvh RPC（走 dispatch，与 Panel 同一份）；文档流用单向通知
//     `{vvh:'doc', op}` —— 宿主→webview `init`/`revert`，webview→宿主 `edit`（webview 侧 debounce）。
//     ⛔ 不走 CustomDocument 的双向确认协议：SandboxCanvas 的 commit 本就是全量序列化落串，
//     没有增量操作可回放，双向协议只会多一层状态机。脏标/撤销用 edit 事件 + 快照栈兜住。
//
// 真源语义（F1）：沙盒正文从 localStorage 迁到工作区真文件——打开=读盘，保存=宿主写盘
// （webview ⛔ 参与写盘，只负责把最新 content 推上来），Explorer/git/侧边栏沙盒树看到的就是真文件。
import * as vscode from 'vscode';
import { dispatchAndReply, projectRoot, registerWebviewSink, unregisterWebviewSink, broadcastBindingsChanged, vscodeFs } from './dispatch';
import { clearActiveCanvas, setActiveCanvas } from './activeCanvas';
import { ensureDirsMeta, getCircuitsSet, completeFromHits } from './sandboxFiles';
import { setActiveSandboxDoc } from './trees';
import { ProjectStore } from './projectStore';
import { rootRel } from './verilogDomain';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';

export const DOC_VIEW_TYPE = 'verilogViz.doc';

/** 部件解析的兄弟文档：同文件夹 + 根目录的全部 `.djs`（gateSystem 的部件源，顶替 localStorage） */
export interface SiblingDoc { name: string, content: string, role: 'part' | 'circuit' }

/** 文档里的子电路实例（去重 celltype 名单）：沙盒「层次结构」树的数据源 */
function subcircuitsOf(content: string): string[] {
  try {
    const cells = (JSON.parse(content)?.cells || []) as Array<{ type?: string; celltype?: string }>;
    return [...new Set(cells.filter((c) => c?.type === 'Subcircuit' && c.celltype).map((c) => String(c.celltype)))];
  } catch { return []; }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

// 根相对名转交一颗主人（工作区外的文档仍按绝对路径认，⛔ 混进相对名里——口径在 verilogDomain.rootRel）
function relName(root: vscode.Uri, uri: vscode.Uri): string { return rootRel(root, uri); }

export class VvCircuitDocument implements vscode.CustomDocument {
  /** 快照栈：undo 恢复上一版并把 webview 拉回去（custom editor 的 Ctrl+Z 免费档） */
  private readonly _history: string[] = [];

  constructor(readonly uri: vscode.Uri, public content: string) { }

  /** webview 推来的最新全量序列化（宿主⛔ 主动写盘——落盘只发生在 save/backup） */
  pushEdit(content: string, fire: (e: vscode.CustomDocumentEditEvent<VvCircuitDocument>) => void): void {
    if (content === this.content) return;
    const previous = this.content;
    this._history.push(previous);
    this.content = content;
    const apply = async (value: string) => {
      this.content = value;
      await this.panel?.webview.postMessage({ vvh: 'doc', op: 'revert', content: value });
    };
    fire({
      document: this,
      label: '编辑电路',
      undo: async () => {
        const prev = this._history.pop();
        if (prev !== undefined) await apply(prev);
      },
      redo: async () => { await apply(content); },
    });
  }

  /** resolve 后挂上；revert/undo 要把 webview 拉回去 */
  panel?: vscode.WebviewPanel;

  pushToWebview(msg: unknown): Thenable<boolean> {
    return this.panel ? this.panel.webview.postMessage(msg) : Promise.resolve(false);
  }

  /** CustomDocument 契约：文档关闭（宿主侧唯一钩子；webview 侧的清理挂在 onDidDispose） */
  dispose(): void { this.panel = undefined; }
}

export class VvDocProvider implements vscode.CustomEditorProvider<VvCircuitDocument> {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<VvCircuitDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;

  constructor(private readonly _context: vscode.ExtensionContext) { }

  async openCustomDocument(uri: vscode.Uri): Promise<VvCircuitDocument> {
    return new VvCircuitDocument(uri, await readText(uri));
  }

  async resolveCustomEditor(document: VvCircuitDocument, panel: vscode.WebviewPanel): Promise<void> {
    document.panel = panel;
    // R160（问题S）：注册进活文档表——refreshAllTrees 总闸据此把最新 siblings 推给画布
    const track = trackOpenDoc(document);
    panel.onDidDispose(() => track.dispose(), null, this._context.subscriptions);
    // 画布与仿真循环在后台：切走⛔ 停表（retainContext 一关，回来就是重新加载、电路没了）
    panel.webview.options = { enableScripts: true, localResourceRoots: webviewRoots(this._context) };
    // ⚠ dispose 后 `panel.webview` 这个 getter 会当场抛 "Webview is disposed"（真机实测）——
    // 引用必须在 onDidDispose **外面**先取好，回调里只用闭包里这份。
    const webview = panel.webview;

    const sendInit = async () => {
      await document.pushToWebview({
        vvh: 'doc', op: 'init',
        docName: relName(projectRoot(this._context), document.uri),
        content: document.content,
        siblings: await this._siblings(document.uri),
      });
    };

    webview.onDidReceiveMessage(async (msg: any) => {
      if (!msg || typeof msg.vvh !== 'string') return;
      // 官方 sample 的就绪握手：webview 挂载完先发 ready，宿主这才发 init——
      // ⛔ 在 html 赋值后立刻 postMessage：webview 没装载完时消息会**被丢弃**（真机实测＝黑屏画布）。
      if (msg.vvh === 'doc' && msg.op === 'ready') { void sendInit(); return; }
      if (msg.vvh === 'doc' && msg.op === 'edit') {
        const content = String(msg.content ?? '');
        document.pushEdit(content, (e) => this._onDidChange.fire(e));
        // 沙盒层次树跟随：编辑改变子电路实例集合时上报（trees.ts 的 activeSandboxDoc）
        setActiveSandboxDoc(relName(projectRoot(this._context), document.uri), subcircuitsOf(content));
        return;
      }
      // R146 绑定完整性：画布提示条「写全配置」交来**实解真相**（autoHits pairs），
      // 落该文档目录层的 .verilogviz.json；写完回推 bindingsWritten，画布清账重展＝条自灭。
      if (msg.vvh === 'doc' && msg.op === 'completeBindings') {
        const docName = String(msg.docName || relName(projectRoot(this._context), document.uri));
        try {
          const done = await completeFromHits(this._context, docName, Array.isArray(msg.hits) ? msg.hits : []);
          await document.pushToWebview({ vvh: 'doc', op: 'bindingsWritten', written: done.length });
          broadcastBindingsChanged();
        } catch (e) {
          void vscode.window.showErrorMessage(`写全绑定失败：${String(e instanceof Error ? e.message : e)}`);
        }
        return;
      }
      if (msg.vvh !== 'req' || typeof msg.id !== 'string') return;
      // 回包形状与 Panel 那条线同一份主人（dispatch.ts）
      await dispatchAndReply(this._context, (m) => { void webview.postMessage(m); }, msg);
    }, null, this._context.subscriptions);

    panel.onDidDispose(() => {
      clearActiveCanvas(webview);
      unregisterWebviewSink(webview);
      if (document.panel === panel) document.panel = undefined;
    }, null, this._context.subscriptions);

    const html = await loadWebviewHtml(this._context, webview, 'doc.html');
    webview.html = html ?? this._missingEntryHtml();
    setActiveCanvas(webview, 'doc');
    registerWebviewSink(webview);
    // 沙盒层次树：打开文档即上报它的子电路实例
    setActiveSandboxDoc(relName(projectRoot(this._context), document.uri), subcircuitsOf(document.content));
  }

  async saveCustomDocument(document: VvCircuitDocument, _token: vscode.CancellationToken): Promise<void> {
    await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(document.content));
  }

  async saveCustomDocumentAs(document: VvCircuitDocument, destination: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(document.content));
  }

  async revertCustomDocument(document: VvCircuitDocument, _token: vscode.CancellationToken): Promise<void> {
    document.content = await readText(document.uri);
    await document.pushToWebview({ vvh: 'doc', op: 'revert', content: document.content, siblings: await this._siblings(document.uri) });
  }

  async backupCustomDocument(document: VvCircuitDocument, context: vscode.CustomDocumentBackupContext, _token: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    const destination = context.destination;
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(document.content));
    return { id: destination.toString(), delete: async () => { await vscode.workspace.fs.delete(destination, { useTrash: false }); } };
  }

  /** 部件源：同文件夹 + 根目录的其余 `.djs`（打开时读死一份；外部改盘走 revert/重开）。
   *  role：`.verilogviz.json` 的 circuits 名单是**显式取消**表（缺省全部件——refreshGates/
   *  绑定解析都靠它），在名单里的才降为 circuit。 */
  private async _siblings(docUri: vscode.Uri): Promise<SiblingDoc[]> {
    return siblingsOf(this._context, docUri);
  }

  private _missingEntryHtml(): string {
    return `<!DOCTYPE html><html lang="zh-CN"><body style="font-family:var(--vscode-font-family);padding:2em">
      找不到画布文档入口（doc.html）。<br><br>
      先跑 <code>pnpm build</code>（产出 <code>dist/doc.html</code>），开发态即可直接打开；
      打包分发时再跑 <code>pnpm webview:sync</code> 把产物复制进 <code>extension/webview/</code>。
    </body></html>`;
  }
}

/** R160（批2问题S）：部件源此前＝**打开时快照**——新建/删除/改名 .djs 后，已开的画布永远
 *  看不见新部件（真机实锤：child.djs 画布的部件清单到关页也不会出 demo.djs）。
 *  修向＝活文档注册表 + refreshAllDocSiblings：宿主 refreshAllTrees 总闸顺带把最新
 *  siblings 推给每一颗画布（webview 侧 DocApp 认 `op:'siblings'` 重挂部件源并刷 gates）。 */
const openDocs = new Set<VvCircuitDocument>();

export function trackOpenDoc(doc: VvCircuitDocument): vscode.Disposable {
  openDocs.add(doc);
  return { dispose: () => { openDocs.delete(doc); } } as vscode.Disposable;
}

export async function refreshAllDocSiblings(context: vscode.ExtensionContext): Promise<void> {
  for (const doc of openDocs) {
    try {
      await doc.pushToWebview({ vvh: 'doc', op: 'siblings', siblings: await siblingsOf(context, doc.uri) });
    } catch { /* 单颗推送失败不拦其余（多半正在 dispose） */ }
  }
}

/** 部件源生成的一颗主人（provider._siblings 与 refreshAllDocSiblings 共用语义）。 */
async function siblingsOf(context: vscode.ExtensionContext, docUri: vscode.Uri): Promise<SiblingDoc[]> {
  const root = projectRoot(context);
  const docRel = relName(root, docUri);
  const docDir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
  // R137：目录里有部件（.djs）就保证该目录的 .verilogviz.json 存在（可见可手编，已存在不覆盖）
  try { await ensureDirsMeta(context, [docRel]); } catch { /* 建表失败不拦装载 */ }
  try {
    const [tree, circuits] = await Promise.all([
      new ProjectStore(vscodeFs(root), '@root').listSandboxTree(),
      getCircuitsSet(context),
    ]);
    const names = tree.files
      .map((f) => f.name)
      .filter((n) => n !== docRel)
      // R145：⛔ 再限"同级+根"——绑定值可以指任何目录（`alt/impl.djs`、`../shared/x.djs`），
      // 候选集缺了它们时**越层记录永远撞不上**＝"录了没生效"的另一条真通路。
      // 层级优先归打分管（resolvePartRef 的 scope score：同级>根>其他），这里只负责全量给到。
      .sort((a, b) => {
        const da = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
        const db = b.includes('/') ? b.slice(0, b.lastIndexOf('/')) : '';
        const pa = (n: string) => (n === docDir ? 0 : n === '' ? 1 : 2);
        return pa(da) - pa(db) || a.localeCompare(b);
      });
    const out: SiblingDoc[] = [];
    for (const name of names) {
      try {
        out.push({
          name, content: await readText(vscode.Uri.joinPath(root, ...name.split('/'))),
          role: circuits.has(name) ? 'circuit' : 'part',
        });
      } catch { /* 读不到的跳过 */ }
    }
    return out;
  } catch { return []; }
}
