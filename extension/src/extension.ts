/**
 * VS Code 壳（Extension Host 侧）。骨架照微软官方 sample `webview-sample`
 * （`createWebviewPanel` + `localResourceRoots` + `asWebviewUri` + `cspSource` + nonce +
 * `onDidReceiveMessage`），片 5（全面原生）后的形态：
 *   · **编译画布 Panel**（`verilogVisualizer`）——空态引导，收 compilePanel 推来的编译单；
 *   · **`.djs` custom editor**（`verilogViz.doc`，./customEditors.ts）——交互电路文档；
 *   · **侧边栏三板块**（./trees.ts）+ 命令/菜单/设置全部 `contributes`（package.json）；
 *   · webview 不再装旧 React 应用：RPC 面收到 6 颗（./dispatch.ts），文件管理归原生 Explorer。
 */
import * as vscode from 'vscode';
import { broadcastConfigChanged, broadcastBindingsChanged, dispatch, projectRoot, registerWebviewSink, unregisterWebviewSink } from './dispatch';
import { clearActiveCanvas, pushToActiveCanvas, setActiveCanvas } from './activeCanvas';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';
import { AUTOOPEN_ENV, isBuiltIntoThisApp, shouldAutoOpen } from './startupPolicy';
import { ModuleTree, HierarchyTree, SandboxTree, openAtModule, getActiveSandboxDocUri,
  CodeFilesTree, SandboxPartsTree, SandboxHierarchyTree, onActiveSandboxDocChange } from './trees';
import { DOC_VIEW_TYPE, VvDocProvider } from './customEditors';
import { compileAndShow, recompileOnSave, flushPendingCompile, closureOf, type EnsurePanel } from './compilePanel';
import { newVerilogFile, newSandboxFile, newSandboxFolder, openExamples } from './examples';
import {
  deleteFile, duplicateFile, duplicateFolder, importFiles, openDoc, renameFile, togglePartRole,
  getCircuitsSet, openBindingConfig, materializeBindings,
  collectInstanceHits, completeFromHits, normalizeBindingsDisk, META_FILE
} from './sandboxFiles';
import { openBindingPanel } from './bindingPanel';
import { loadProjectApiOverride } from './apiSurface';
import { loadProjectGrants } from './apiGrants';
import { initProject } from './vvProject';
import { flushAudit } from './apiAudit';
import { parseVerilogInstances } from './verilogParseLite';
import { ProjectStore, type FsLike } from './projectStore';
import { VvFilesWebviewProvider } from './filesWebview';

const VIEW_TYPE = 'verilogVisualizer';

let currentPanel: vscode.WebviewPanel | undefined;

/** `workspace.fs` 的各方法回的是 `Thenable`（不是 Promise）⇒ 必须 await 一次再回 */
const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

export function activate(context: vscode.ExtensionContext) {
  const storeFactory = () => new ProjectStore(vscodeFsLike(projectRoot(context)), '@root');
  const moduleTree = new ModuleTree();
  const hierarchyTree = new HierarchyTree();
  const sandboxTree = new SandboxTree(storeFactory);
  const codeFilesTree = new CodeFilesTree();
  const sandboxPartsTree = new SandboxPartsTree(storeFactory, () => getCircuitsSet(context));
  const sandboxHierarchyTree = new SandboxHierarchyTree();
  // R148 原位 webview 化：两颗「文件」视图（codeFiles/sandboxFiles）改用 WebviewView——
  // 空白/文件夹/文件行三级右键全部真实可用（webview/context 通道，平台内唯一通路；
  // 重构前本就是 webview 自绘树，此形态＝对等回归）。用户否掉"另起新区"的方案，不并排新视图。
  const filesViewCode = new VvFilesWebviewProvider('code', context, (rel) => {
    void vscode.commands.executeCommand('verilogViz.openFile', vscode.Uri.joinPath(projectRoot(context), ...rel.split('/')));
  });
  const filesViewSandbox = new VvFilesWebviewProvider('sandbox', context, (rel) => {
    void vscode.commands.executeCommand('verilogViz.openDoc', vscode.Uri.joinPath(projectRoot(context), ...rel.split('/')));
  });

  const ensurePanel: EnsurePanel = (ctx) => openPanel(ctx);

  /** view/item/context 的实参形状（真宿主：带 resourceUri 的项传 Uri，否则传整个 TreeItem）——两种都接住。
   *  R147：webview/context 的命令实参＝data-vscode-context 的 JSON（{vvPath:...}）⇒ 也接住折成 Uri。 */
  const menuUri = (arg: any): vscode.Uri | undefined => {
    if (arg?.fsPath) return arg;
    if (arg?.resourceUri) return arg.resourceUri;
    if (typeof arg?.vvPath === 'string' && arg.vvPath) return vscode.Uri.joinPath(projectRoot(context), ...arg.vvPath.split('/'));
    return undefined;
  };

  /** root 相对 posix 名（绑定链/目录表的定位键） */
  const rel = (root: vscode.Uri, uri: vscode.Uri): string => {
    const rootFs = root.fsPath.replace(/[\\/]+$/, '');
    return uri.fsPath.slice(rootFs.length + 1).replace(/\\/g, '/');
  };

  /** 树刷新总闸：watcher 增删、refreshTrees 命令、三颗新建命令都汇到这（六树一盘账 + 两颗 webview 文件视图） */
  const refreshAllTrees = () => {
    moduleTree.refresh(); hierarchyTree.refresh(); sandboxTree.refresh();
    codeFilesTree.refresh(); sandboxPartsTree.refresh();
    void filesViewCode.render(); void filesViewSandbox.render();
  };

  // 活动栏**双容器**（用户裁决：编译与沙盒分家，各自 文件/模块(部件)/层次结构 三视图）：
  //   · 「代码编译」（">_" 图标）：codeFiles / modules / hierarchy —— .v 世界的三棵
  //   · 「沙盒编辑」（沙盒图标）：sandboxFiles / sandboxParts / sandboxHierarchy —— .djs 世界的三棵
  // ⚠ 必须 createTreeView（⛔ registerTreeDataProvider）：只有前者认 `showCollapseAll: true`，
  //   基座 TreeViewPane 才把自带的「折叠全部」标题按钮点亮（treeView.ts 自动注册的
  //   workbench.actions.treeView.<id>.collapseAll，受 treeView.<id>.enableCollapseAll 上下文键门控）。
  const treeViewOf = (id: string, provider: vscode.TreeDataProvider<any>) =>
    vscode.window.createTreeView(id, { treeDataProvider: provider, showCollapseAll: true });
  // R147：两颗「文件 · 右键可用」webview view（空白/行右键全菜单——TreeView 做不到的那份，见 filesWebview 头注）
  const vvViewOf = (id: string, provider: vscode.WebviewViewProvider) =>
    vscode.window.registerWebviewViewProvider(id, provider, { webviewOptions: { retainContextWhenHidden: true } });
  context.subscriptions.push(
    vvViewOf('verilogViz.codeFiles', filesViewCode),
    treeViewOf('verilogViz.modules', moduleTree),
    treeViewOf('verilogViz.hierarchy', hierarchyTree),
    vvViewOf('verilogViz.sandboxFiles', filesViewSandbox),
    treeViewOf('verilogViz.sandboxParts', sandboxPartsTree),
    treeViewOf('verilogViz.sandboxHierarchy', sandboxHierarchyTree),
    // 沙盒层次树的数据源：活动 .djs 文档的子电路实例（customEditors init/edit 时上报）
    onActiveSandboxDocChange(() => sandboxHierarchyTree.refresh()),
    vscode.commands.registerCommand('verilogVisualizer.refreshTrees', refreshAllTrees),
    // 树项点击的两颗落点（trees.ts 的 item.command 引用；⛔ 只引用不注册＝"点了报 command not found"）
    vscode.commands.registerCommand('verilogViz.openModuleAt', (uri, mod) => openAtModule(uri, String(mod))),
    vscode.commands.registerCommand('verilogViz.openFile', (uri) => void vscode.window.showTextDocument(uri)),
    // 右键菜单里的「打开定义」：view/item/context 只递 Uri/TreeItem，拿⛔ 到我们的字段 ⇒ 模块名从 TreeItem.label 取
    vscode.commands.registerCommand('verilogViz.openModuleItem', (a: any, b: any) => {
      const uri = menuUri(a) ?? menuUri(b);
      const mod = String(b?.label ?? a?.label ?? '');
      if (uri && mod) void openAtModule(uri, mod);
    }),

    // .v → 画布（编译单由这里推；入口＝标题按钮 / Ctrl+F5 / 命令面板带参）
    vscode.commands.registerCommand('verilogViz.compileAndShow', (uri?: vscode.Uri) => compileAndShow(context, uri, ensurePanel)),
    // 标题栏按钮 → 活动画布（Panel 或 custom editor；没人听就静默落空）
    vscode.commands.registerCommand('verilogViz.sim.togglePause', () => void pushToActiveCanvas({ vvh: 'push', op: 'sim', action: 'togglePause' })),
    vscode.commands.registerCommand('verilogViz.sim.stepOnce', () => void pushToActiveCanvas({ vvh: 'push', op: 'sim', action: 'stepOnce' })),
    vscode.commands.registerCommand('verilogViz.exportSvg', () => void pushToActiveCanvas({ vvh: 'push', op: 'export', format: 'svg' })),
    // R144：这三颗也接目录右键实参（menuUri 宽容：标题钮时实参是 view 对象⇒undefined⇒落根）
    vscode.commands.registerCommand('verilogViz.newVerilogFile', (arg: any) => newVerilogFile(context, menuUri(arg)).then(refreshAllTrees)),
    vscode.commands.registerCommand('verilogViz.newSandboxFile', (arg: any) => newSandboxFile(context, (uri) => openDoc(uri), menuUri(arg)).then(refreshAllTrees)),
    vscode.commands.registerCommand('verilogViz.newSandboxFolder', (arg: any) => newSandboxFolder(context, menuUri(arg)).then(refreshAllTrees)),
    vscode.commands.registerCommand('verilogViz.openExamples', () => openExamples(context, (uri) => compileAndShow(context, uri, ensurePanel))),

    // 沙盒树的文件右键（片 5-B：旧 SandboxFileTree 菜单的原生落点；role 存项目根 .verilogviz.json）
    // ⚠ 菜单实参形状宽容（menuUri）：右键来自 view/item/context 时可能是 Uri 也可能是 TreeItem
    vscode.commands.registerCommand('verilogViz.openDoc', (arg: any) => { const uri = menuUri(arg); if (uri) void openDoc(uri); }),
    vscode.commands.registerCommand('verilogViz.renameFile', async (arg: any) => { const uri = menuUri(arg); if (uri) { await renameFile(context, uri); refreshAllTrees(); broadcastBindingsChanged(); } }),
    vscode.commands.registerCommand('verilogViz.deleteFile', async (arg: any) => { const uri = menuUri(arg); if (uri) { await deleteFile(context, uri); refreshAllTrees(); broadcastBindingsChanged(); } }),
    vscode.commands.registerCommand('verilogViz.duplicateFile', (arg: any) => { const uri = menuUri(arg); if (uri) void duplicateFile(context, uri); }),
    vscode.commands.registerCommand('verilogViz.togglePartRole', async (arg: any) => {
      const uri = menuUri(arg);
      if (!uri) return;
      await togglePartRole(context, uri);
      sandboxTree.refresh(); sandboxPartsTree.refresh();
    }),
    // 部件绑定（用户多次强调）：两模式文件右键的「部件绑定…」都走这颗——
    //   .djs ⇒ 解析文档里的子电路实例；.v ⇒ 解析依赖闭包里的子模块；
    //   QuickPick 两级（选实例 → 选部件文件）后写**文档目录层**的 `.verilogviz.json`。
    //   R144「自动兜底显形」：一级列表逐项标注当前生效解析（已录入/自动同名/无来源），
    //   ⛔ 再出现"表看不见、行为却正常"的暗魔法。
    vscode.commands.registerCommand('verilogViz.bindParts', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri();
      if (!uri) { void vscode.window.showInformationMessage('先在文件（.djs 或 .v/.sv）上右键。'); return; }
      if (!/\.(v|sv|djs)$/i.test(uri.fsPath)) {
        void vscode.window.showInformationMessage('只能在 .v/.sv/.djs 文件上打开部件绑定。');
        return;
      }
      await openBindingPanel(context, uri);
    }),

    // R144「固化绑定」：把当前**自动同名命中**且未录入的解析结果一键写进目录表（记录即权威的正方向）。
    // 已录入的条目⛔ 覆盖（手编内容珍贵）；固化后行为不变——变的是"文件说的和画布做的终于对得上"。
    vscode.commands.registerCommand('verilogViz.materializeBindings', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri();
      if (!uri) { void vscode.window.showInformationMessage('先在文件（.djs 或 .v）上右键。'); return; }
      const root = projectRoot(context);
      const docRel = rel(root, uri);
      let done: string[] = [];
      if (/\.djs$/i.test(uri.fsPath)) {
        const content = new TextDecoder().decode(await then(vscode.workspace.fs.readFile(uri)));
        const cts = [...new Set(((JSON.parse(content)?.cells || []) as Array<{ type?: string; celltype?: string }>)
          .filter((c) => c?.type === 'Subcircuit' && c.celltype).map((c) => String(c.celltype)))];
        const names = new Set((await new ProjectStore(vscodeFsLike(root), '@root').listSandboxTree()).files.map((f) => f.name));
        const dir = docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '';
        done = await materializeBindings(context, docRel, cts, async (n) =>
          names.has(`${dir}/${n}.djs`) ? `${dir}/${n}.djs` : names.has(`${n}.djs`) ? `${n}.djs` : null);
      } else {
        const job = await closureOf(context, uri);
        const inJob = new Map(job.files.map((f) => [f.name.replace(/\.sv?$/i, ''), f.name]));
        const inst = new Set<string>();
        for (const f of job.files) for (const i of parseVerilogInstances(f.content)) if (i !== job.topModule) inst.add(i);
        done = await materializeBindings(context, docRel, [...inst], async (n) => {
          const hit = inJob.get(n);
          return hit && /\.(v|sv)$/i.test(hit) && hit !== docRel ? hit : null;   // ⛔ 把自己录成部件
        });
      }
      sandboxPartsTree.refresh(); sandboxHierarchyTree.refresh();
      broadcastBindingsChanged();
      void vscode.window.showInformationMessage(done.length
        ? `已固化 ${done.length} 条自动绑定进该目录的 ${META_FILE}：${done.slice(0, 3).join('、')}${done.length > 3 ? '…' : ''}`
        : '没有需要固化的自动绑定（未录入的要么已按记录走，要么无同名可解）。');
    }),

    // R146 绑定完整性·核查：全层枚举「⛔ 表里没录、靠同名兜底」的实例——配置不齐当场可见。
    // 带直达动作：［写全配置］一键落表（等同 complete 命令），［打开配置］直开该层文件。
    vscode.commands.registerCommand('verilogViz.auditBindings', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri() ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri || !/\.(v|sv|djs)$/i.test(uri.fsPath)) { void vscode.window.showInformationMessage('先在 .v/.sv/.djs 文件上右键。'); return; }
      const docRel = rel(projectRoot(context), uri);
      const hits = await collectInstanceHits(context, docRel);
      if (!hits.length) { void vscode.window.showInformationMessage(`「${docRel}」的绑定配置是完整的：全部子部件实例都有记录（或本就无实例）。`); return; }
      const sample = hits.slice(0, 4).map((h) => `${h.ctx === docRel ? '' : `${h.ctx}::`}${h.name}→${h.file}`).join('、');
      const act = await vscode.window.showWarningMessage(
        `「${docRel}」有 ${hits.length} 个子部件实例⛔ 录入绑定配置，正靠同名兜底解析：${sample}${hits.length > 4 ? ' …' : ''}`,
        '写全配置', '打开绑定配置');
      if (act === '写全配置') {
        const written = await completeFromHits(context, docRel, hits);
        refreshAllTrees(); broadcastBindingsChanged();
        void vscode.window.showInformationMessage(`已写全 ${written.length} 条：绑定配置现在是这张电路的完整图景（可打开核对/手改）。`);
      } else if (act === '打开绑定配置') await openBindingConfig(context, uri);
    }),

    // R146 绑定完整性·写全：一键把全层自动命中落进文档目录的 .verilogviz.json
    //（画布上的实时提示条走 doc 消息通道回宿主；这颗命令＝不打开画布也能用，与核查同落表逻辑）。
    vscode.commands.registerCommand('verilogViz.completeBindings', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri() ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri || !/\.(v|sv|djs)$/i.test(uri.fsPath)) { void vscode.window.showInformationMessage('先在 .v/.sv/.djs 文件上右键。'); return; }
      const docRel = rel(projectRoot(context), uri);
      const hits = await collectInstanceHits(context, docRel);
      const written = await completeFromHits(context, docRel, hits);
      refreshAllTrees(); broadcastBindingsChanged();
      void vscode.window.showInformationMessage(written.length
        ? `已写全 ${written.length} 条绑定进「${docRel.includes('/') ? docRel.slice(0, docRel.lastIndexOf('/')) : '项目根'}」的 ${META_FILE}。`
        : `无需写全：${docRel} 的实例解析记录已是完整状态。`);
    }),

    // 审计通道催落（测试收口/排障手催；正常运行靠 30 行/5 秒批量自动）
    vscode.commands.registerCommand('verilogViz.auditFlush', async () => flushAudit(context)),

    // 协议步⑥：.vv/ 工程骨架初始化（幂等——已有文件一颗不覆，只补缺）
    vscode.commands.registerCommand('verilogViz.initProject', async (arg: any) => {
      const r = await initProject(context);
      void vscode.window.showInformationMessage(r.created.length
        ? `已初始化 .vv/：${r.created.map((p) => p.split('/').pop()).join(' + ')}${r.kept.length ? `（${r.kept.length} 个已存在，保持原样）` : ''}`
        : '工程配置就绪，无需初始化（.vv/project.json 与规则表都在位）。');
      void arg;
    }),

    // R144 右键补全家（照旧 UI 清单）：复制文件夹 / 导入文件（目录右键定位落点，标题钮＝项目根）
    vscode.commands.registerCommand('verilogViz.duplicateFolder', async (arg: any) => {
      const uri = menuUri(arg);
      if (!uri) return;
      await duplicateFolder(context, uri);
      refreshAllTrees();
    }),
    vscode.commands.registerCommand('verilogViz.importFiles', async (arg: any) => {
      const uri = menuUri(arg);
      let dir = projectRoot(context);
      if (uri) {
        const isDir = await then(vscode.workspace.fs.stat(uri)).then((s) => (s as any).type === 2, () => false);
        dir = isDir ? uri : vscode.Uri.joinPath(uri, '..');   // 目录右键＝落进目录；文件右键＝落进它所在目录
      }
      const written = await importFiles(context, dir);
      if (written?.length) {
        refreshAllTrees();
        void vscode.window.showInformationMessage(`已导入 ${written.length} 个文件：${written.slice(0, 3).join('、')}${written.length > 3 ? '…' : ''}`);
      }
    }),

    // R137：「打开绑定配置」——目录级 .verilogviz.json 直开原生编辑器（无则建空表）。
    // 入口：树文件/文件夹右键、explorer .djs/.v 右键、命令面板。手改保存 → watcher 广播回灌画布。
    vscode.commands.registerCommand('verilogViz.openBindingConfig', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri();
      await openBindingConfig(context, uri ?? null);
    }),

    // ⛔ 让人去猜"文件落在哪"：这颗命令直接开那个目录，并把路径抄进剪贴板（真机点验第 4 格要用）
    vscode.commands.registerCommand('verilogVisualizer.revealProjectDir', async () => {
      const root = projectRoot(context);
      try { await vscode.workspace.fs.createDirectory(root); } catch { /* 已存在也算成功 */ }
      try { await vscode.commands.executeCommand('revealFileInOS', root); } catch { /* 某些平台不支持 ⇒ 下面仍给路径 */ }
      await vscode.env.clipboard.writeText(root.fsPath);
      void vscode.window.showInformationMessage(`项目根目录：${root.fsPath}（路径已复制）`);
    }),
  );

  // 树的刷新时机（trees.ts 头注释承诺的那三条）：
  //   ① 工作区里 .v/.djs 的增删改 ⇒ 三棵树都重建（模块树读 .v、沙盒树读 .djs）
  //   ② 打开/切换文件夹 ⇒ 项目根换了，三棵树的数据源整体换轨
  //   ③ 活动编辑器变化 ⇒ 层次树的根跟随当前 .v 文件
  for (const glob of ['**/*.v', '**/*.djs', '**/.verilogviz.json']) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(refreshAllTrees);                // 新文件/新目录立刻进树（标题按钮建的也走这条）
    watcher.onDidChange(() => { moduleTree.refresh(); hierarchyTree.refresh(); if (glob.includes('verilogviz')) broadcastBindingsChanged(); });
    watcher.onDidDelete(() => { refreshAllTrees(); if (glob.includes('verilogviz')) broadcastBindingsChanged(); });
    context.subscriptions.push(watcher);
  }
  // 协议⑤：工程层 .vv/api.json 契约覆盖（只收窄/只关开关；固有属性越权＝整份拒）。
  void loadProjectApiOverride(context).then((rejects) => {
    if (rejects.length) {
      void vscode.window.showWarningMessage("API 工程覆盖被拒绝：" + rejects.join("；") + "（已沿用默认账）");
    }
  }).catch(() => { /* 读不到工程覆盖＝默认账，常态 */ });

  // 协议⑨闸③：工程授权档案 .vv/api.grants.json（可选提交；缺席＝闸不生效——activate 一次性加载，热更新需重启窗口）
  void loadProjectGrants(context).then((notes) => {
    if (notes.length) {
      void vscode.window.showWarningMessage("API 授权档案告警：" + notes.join("；") + "（该条不生效，详见 .vv/api.grants.json）");
    }
  }).catch(() => { /* 读档案失败＝无闸；闸 1/2 照办 */ });

  // M7 归一清扫（一次性、幂等）：盘上 `x.djs.djs` 裁尾 + 各层绑定表值归一写回（前缀键随迁）。
  // 后台跑不拦 activate；零改动不打扰（有改动才广播+轻报）——第二遍起必然静默。
  void normalizeBindingsDisk(context).then((r) => {
    if (!r.files.length && !r.tables.length) return;
    broadcastBindingsChanged(); refreshAllTrees();
    void vscode.window.showInformationMessage(
      `绑定盘归一：${r.files.length} 个双后缀文件已裁尾、${r.tables.length} 张配置表值已归一（记录语义不变）。`);
  }).catch(() => { /* 后台清扫失败不拦启动；表值读取侧本就归一，功能不受阻 */ });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      moduleTree.refresh(); hierarchyTree.refresh(); sandboxTree.refresh();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => hierarchyTree.refresh()),
    // 设置（contributes.configuration）改了 → 所有活画布各自 patch
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('verilogViz') || e.affectsConfiguration('editor.fontSize')) broadcastConfigChanged();
    }),
    // `.v` 保存 → 画布开着就自动重编译（verilogViz.compile.autoRecompile，默认开）
    vscode.workspace.onDidSaveTextDocument((doc) => { if (doc) void recompileOnSave(context, doc, ensurePanel); }),
  );

  // `.djs` 电路文档 = custom editor（双击即开交互画布，原生软盘保存）
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DOC_VIEW_TYPE, new VvDocProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel) {
        currentPanel = panel;
        wirePanel(context, panel);
      },
    });
  }
  // 开发宿主（官方 flag `--extensionDevelopmentPath`，或 F5）与**我们自己的二进制**里直接把窗口弹出来：
  // 被别人安装的扩展⛔ 抢着开——那是别人的编辑器。规则本体在 `./startupPolicy.ts`（无 vscode 依赖，可无头判）。
  if (shouldAutoOpen({
    extensionMode: context.extensionMode,
    developmentMode: vscode.ExtensionMode.Development,
    builtIntoThisApp: isBuiltIntoThisApp(context.extensionUri.fsPath, vscode.env.appRoot),
    envFlag: process.env[AUTOOPEN_ENV],
  })) {
    void openPanel(context);
  }
}

export function deactivate() { }

/* ============ 编译画布 Panel（空态引导；编译单由 compilePanel 推） ============ */

function openPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  if (currentPanel) { currentPanel.reveal(column); return currentPanel; }
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'Verilog Visualizer',
    { viewColumn: column, preserveFocus: false },
    {
      enableScripts: true,
      // 画布与仿真循环在后台：切到别的编辑器⛔ 停表（retainContext 一关，回来就是重新加载、电路没了）
      retainContextWhenHidden: true,
      localResourceRoots: webviewRoots(context),
    },
  );
  currentPanel = panel;
  wirePanel(context, panel);
  return panel;
}

function wirePanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
  const webview = panel.webview;

  // 释放登记**必须两条装载路都做**（新开 = openPanel，窗口重启 = serializer）。
  // 加 `=== panel` 守卫：旧面板的 dispose ⛔ 抹掉新面板的登记。
  panel.onDidDispose(() => {
    if (currentPanel === panel) currentPanel = undefined;
    clearActiveCanvas(webview);
    unregisterWebviewSink(webview);
  }, null, context.subscriptions);

  (async () => {
    const html = await loadWebviewHtml(context, webview, 'index.html');
    webview.html = html ?? `<!DOCTYPE html><html lang="zh-CN"><body style="font-family:var(--vscode-font-family);padding:2em">
      找不到前端构建产物。<br><br>
      先跑 <code>pnpm build</code>（产出 <code>dist/index.html</code> 与 <code>dist/doc.html</code>），开发态即可直接打开；
      打包分发时再跑 <code>pnpm webview:sync</code> 把产物复制进 <code>extension/webview/</code>。
    </body></html>`;
    setActiveCanvas(webview, 'panel');
    registerWebviewSink(webview);
  })().catch((e) => void vscode.window.showErrorMessage(`打不开 Verilog 可视化窗口：${String(e instanceof Error ? e.message : e)}`));

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    if (!msg || typeof msg.vvh !== 'string') return;
    // 画布就绪握手（首编译推送被丢的修法，与 doc ready 同族）：ready → 补推挂起的编译单
    if (msg.vvh === 'push' && msg.op === 'ready') { void flushPendingCompile(context, panel); return; }
    if (msg.vvh !== 'req' || typeof msg.id !== 'string') return;
    const reply = (ok: boolean, data?: unknown, error?: string) =>
      void webview.postMessage({ vvh: 'res', id: msg.id, ok, data, error });
    try {
      reply(true, await dispatch(context, msg.method, msg.args || {}));
    } catch (e) {
      reply(false, undefined, String(e instanceof Error ? e.message : e));
    }
  }, null, context.subscriptions);
}

/* ============ 小工具 ============ */

/** `workspace.fs` → ProjectStore 的 FsLike（@root 相对路径落回 Uri；语义与 dispatch.vscodeFs 同一把） */
function vscodeFsLike(rootUri: vscode.Uri): FsLike {
  const toUri = (abs: string) => {
    const rel = abs.startsWith('@root') ? abs.slice('@root'.length).replace(/^\/+/, '') : abs;
    return rel ? vscode.Uri.joinPath(rootUri, ...rel.split('/')) : rootUri;
  };
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
        return entries.map(([name, type]) => ({ name, type: type === vscode.FileType.Directory ? 'dir' as const : 'file' as const }));
      } catch { return []; }
    },
  };
}
