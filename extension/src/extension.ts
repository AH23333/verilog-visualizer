/**
 * VS Code 壳（Extension Host 侧）。骨架照微软官方 sample `webview-sample`
 * （`createWebviewPanel` + `localResourceRoots` + `asWebviewUri` + `cspSource` + nonce +
 * `onDidReceiveMessage`），片 5（全面原生）后的形态：
 *   · **编译画布 Panel**（`verilogVisualizer`）——空态引导，收 compilePanel 推来的编译单；
 *   · **`.djs` custom editor**（`verilogViz.doc`，./customEditors.ts）——交互电路文档；
 *   · **侧边栏三板块**（./trees.ts）+ 命令/菜单/设置全部 `contributes`（package.json）；
 *   · webview 不再装旧 React 应用：RPC 面收到 9 颗（./dispatch.ts，颗数由 vscodeShell 的对账锁钉住），
 *     文件管理归原生 Explorer。
 */
import * as vscode from 'vscode';
import { broadcastConfigChanged, broadcastBindingsChanged, dispatchAndReply, projectRoot, registerWebviewSink, unregisterWebviewSink } from './dispatch';
import { clearActiveCanvas, pushToActiveCanvas, setActiveCanvas } from './activeCanvas';
import { loadWebviewHtml, webviewRoots } from './webviewAssets';
import { AUTOOPEN_ENV, isBuiltIntoThisApp, shouldAutoOpen } from './startupPolicy';
import { ModuleTree, HierarchyTree, SandboxTree, FileTreeDragAndDrop, openAtModule, getActiveSandboxDocUri,
  CodeFilesTree, SandboxPartsTree, SandboxHierarchyTree, onActiveSandboxDocChange } from './trees';
import { DOC_VIEW_TYPE, VvDocProvider, refreshAllDocSiblings } from './customEditors';
import { compileAndShow, recompileOnSave, flushPendingCompile, recompileOnExternalChange, trackLastTextEditor, type EnsurePanel } from './compilePanel';
import { newVerilogFile, newSandboxFile, newSandboxFolder, openExamples } from './examples';
import {
  openDoc, togglePartRole, getCircuitsSet, openBindingConfig,
  collectInstanceHits, completeFromHits, normalizeBindingsDisk, META_FILE,
  scanDirChoices, importFilters, describeDeletion, ensureDirsMeta,
  migrateAfterExternalRename, migrateAfterExternalDelete
} from './sandboxFiles';
import { openBindingPicker } from './bindingPanel';
import { loadApiContract, loadProjectApiOverride } from './apiSurface';
import { loadProjectGrants } from './apiGrants';
import { initProject } from './vvProject';
import { flushAudit } from './apiAudit';
import { uniqueName } from './naming';
import { executeTool, CALLER_UI, onToolExecuted } from './toolRegistry';
import { registerFilesystemTools } from './toolsFs';
import { registerDomainTools } from './toolsDomain';
import { registerRpcTools } from './dispatch';
import { ProjectStore, type FsLike } from './projectStore';
import { watcherGlobs, isBindablePath, rootRel } from './verilogDomain';

const VIEW_TYPE = 'verilogVisualizer';

let currentPanel: vscode.WebviewPanel | undefined;

  /** `workspace.fs` 的各方法回的是 `Thenable`（不是 Promise）⇒ 必须 await 一次再回 */
const then = <T>(t: { then(onOk: (v: T) => void, onErr?: (e: unknown) => void): void }): Promise<T> =>
  new Promise<T>((res, rej) => t.then(res, (e) => rej(e)));

export function activate(context: vscode.ExtensionContext) {
  registerFilesystemTools();   // 统一调用层批次一：文件系统十工具上账（幂等）
  registerDomainTools();       // 批次二：bindings/circuits/res/compile/sys 四族十四工具（§15 范式）
  registerRpcTools();          // 阶段三第一刀：RPC 那 9 颗也上同一张执行器（闸与账⛔ 有两套）
  const storeFactory = () => new ProjectStore(vscodeFsLike(projectRoot(context)), '@root');
  const moduleTree = new ModuleTree();
  const hierarchyTree = new HierarchyTree();
  const sandboxTree = new SandboxTree(storeFactory, () => getCircuitsSet(context));
  const codeFilesTree = new CodeFilesTree(storeFactory);
  const sandboxPartsTree = new SandboxPartsTree(storeFactory, () => getCircuitsSet(context));
  const sandboxHierarchyTree = new SandboxHierarchyTree();

  const ensurePanel: EnsurePanel = (ctx) => openPanel(ctx);

  /** view/item/context 的实参形状（真宿主三种都见过：带 resourceUri 的项传 Uri、整颗 TreeItem、
   *  以及 **provider 的数据节点 Node{label,uri,kind}**——2026-10-18 用户实锤：树右键「部件绑定」
   *  「编译并查看电路」报"先在文件上右键"＝第三种没接住，uri 静默丢光全走兜底）。 */
  const menuUri = (arg: any): vscode.Uri | undefined => {
    if (arg?.fsPath) return arg;
    if (arg?.resourceUri) return arg.resourceUri;
    if (arg?.uri?.fsPath) return arg.uri;                  // 数据节点形（trees.ts 的 Node{uri}）
    return undefined;
  };

  /** root 相对 posix 名（绑定链/目录表的定位键） */
  // 根相对名转交一颗主人（这颗原是"截前缀"的一份：盘符大小写一漂就交半截路径）
  const rel = (root: vscode.Uri, uri: vscode.Uri): string => rootRel(root, uri);

  /** 树刷新总闸：watcher 增删、refreshTrees 命令、新建命令都汇到这（六树一盘账）。
   *  R160（问题S）：顺带把最新部件源推给所有活画布——新建/删除/改名 .djs 不再要重开页。 */
  const refreshAllTrees = () => {
    moduleTree.refresh(); hierarchyTree.refresh(); sandboxTree.refresh();
    codeFilesTree.refresh(); sandboxPartsTree.refresh();
    void refreshAllDocSiblings(context);
  };

  // X6 域设防（2026-10-17）：导入命令按入口分域——对话框归命令层，机械体走 fs.import 工具
  // （域过滤/落盘/落表/审计全在工具内）；跨界文件当面告示 skipped。
  const doImport = (exts: string[]) => async (arg: any) => {
    const uri = menuUri(arg);
    let dir = projectRoot(context);
    if (uri) {
      const isDir = await then(vscode.workspace.fs.stat(uri)).then((s) => (s as any).type === 2, () => false);
      dir = isDir ? uri : vscode.Uri.joinPath(uri, '..');   // 目录右键＝落进目录；文件右键＝落进它所在目录
    }
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: '导入', filters: importFilters(exts) as any });
    if (!picked || !picked.length) return;
    const result = await executeTool(context, CALLER_UI, 'fs.import', { destDir: dir.fsPath, sources: picked.map((u) => u.fsPath), exts }) as { written: string[]; skipped: number };
    if (result.written.length) {
      refreshAllTrees();
      void vscode.window.showInformationMessage(
        `已导入 ${result.written.length} 个文件：${result.written.slice(0, 3).join('、')}${result.written.length > 3 ? '…' : ''}` +
        (result.skipped ? `（另有 ${result.skipped} 个非本域文件已跳过）` : ''));
    } else if (result.skipped) {
      void vscode.window.showInformationMessage('没有可导入的文件：所选文件都不属于本视图的域（编译域＝.v/.sv/.vh，沙盒域＝.djs）。');
    }
  };

  // 活动栏**双容器**（用户裁决：编译与沙盒分家，各自 文件/模块(部件)/层次结构 三视图）：
  //   · 「代码编译」（">_" 图标）：codeFiles / modules / hierarchy —— .v 世界的三棵
  //   · 「沙盒编辑」（沙盒图标）：sandboxFiles / sandboxParts / sandboxHierarchy —— .djs 世界的三棵
  // ⚠ 必须 createTreeView（⛔ registerTreeDataProvider）：只有前者认 `showCollapseAll: true`，
  //   基座 TreeViewPane 才把自带的「折叠全部」标题按钮点亮（treeView.ts 自动注册的
  //   workbench.actions.treeView.<id>.collapseAll，受 treeView.<id>.enableCollapseAll 上下文键门控）。
  // F 族（F1/F3/F4/F6）接线：树内拖移走共源 moveToFile（G1 迁移/自环拒/(n) 去重与 C9 一条路），
  // OS 拖入走 E6 同口径域过滤 + (n) 落盘；完成统一刷树+广播（G3/G4——⛔ 只指望 watcher 竞速）。
  // ⚠ 本仓 @types/vscode(1.140) 的拖拽 API 是 **TreeViewOptions.dragAndDropController**（构造参数），
  //   ⛔ 当 TreeView 可写属性赋（TS2339 实测）。
  const moveDropped = async (srcs: vscode.Uri[], destDir: vscode.Uri, skipped: number) => {
    let moved = 0;
    for (const src of srcs) {
      try { await executeTool(context, CALLER_UI, 'fs.move', { src: src.fsPath, destDir: destDir.fsPath }); moved++; }
      catch { /* 单颗失败不拦整批（错误已告示/已审计） */ }
    }
    if (moved || skipped) {
      const destName = rel(projectRoot(context), destDir) || '项目根';
      const note = skipped ? `；另有 ${skipped} 个非本域文件被域限制拦下` : '';
      void vscode.window.showInformationMessage(`已移动 ${moved} 项到「${destName}」${note}（绑定记录随迁）。`);
    }
  };
  const writeDropped = async (files: Array<{ name: string; bytes: Uint8Array }>, destDir: vscode.Uri, skipped: number) => {
    const written: string[] = [];
    for (const f of files) {
      const final = await uniqueName(destDir, f.name);
      const uri = vscode.Uri.joinPath(destDir, final);
      await then(vscode.workspace.fs.writeFile(uri, f.bytes));
      written.push(rel(projectRoot(context), uri));
    }
    await ensureDirsMeta(context, written);          // 「目录有部件就有表」与 E6 导入同口径
    if (written.length) refreshAllTrees();
    if (written.length || skipped) {
      void vscode.window.showInformationMessage(`已拖入 ${written.length} 个文件${skipped ? `（另有 ${skipped} 个非本域文件已跳过）` : ''}。`);
    }
  };
  const codeDrop = new FileTreeDragAndDrop('verilogViz.codeFiles', ['v', 'sv', 'vh'], moveDropped, writeDropped);
  const sandboxDrop = new FileTreeDragAndDrop('verilogViz.sandboxFiles', ['djs'], moveDropped, writeDropped);

  const treeViewOf = (
    id: string,
    provider: vscode.TreeDataProvider<any>,
    drop?: vscode.TreeDragAndDropController<vscode.TreeItem>,
  ) => vscode.window.createTreeView(id, { treeDataProvider: provider, showCollapseAll: true, ...(drop ? { dragAndDropController: drop } : {}) });
  // F 族：两棵文件树要挂拖拽控制器（构造参数进 TreeViewOptions）
  const codeFilesTv = treeViewOf('verilogViz.codeFiles', codeFilesTree, codeDrop);
  const modulesTv = treeViewOf('verilogViz.modules', moduleTree);
  const hierarchyTv = treeViewOf('verilogViz.hierarchy', hierarchyTree);
  const sandboxFilesTv = treeViewOf('verilogViz.sandboxFiles', sandboxTree, sandboxDrop);
  const sandboxPartsTv = treeViewOf('verilogViz.sandboxParts', sandboxPartsTree);
  const sandboxHierarchyTv = treeViewOf('verilogViz.sandboxHierarchy', sandboxHierarchyTree);
  context.subscriptions.push(
    codeFilesTv, modulesTv, hierarchyTv, sandboxFilesTv, sandboxPartsTv, sandboxHierarchyTv,
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
    // 真机实锤（2026-10-18）：view 右键传的是数据节点（Node{uri}），⛔ 当 Uri 直喂——
    //   过 menuUri 三形通吃（explorer 右键＝Uri、标题钮＝无参走活动档、树右键＝Node）。
    vscode.commands.registerCommand('verilogViz.compileAndShow', (arg?: any) => compileAndShow(context, menuUri(arg), ensurePanel)),
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
    // 统一调用层批次一：文件命令=「UI（输入框/确认弹窗）+ executeTool 薄壳」；机械体/迁移/审计在工具内，
    // 刷树由 onToolExecuted 订阅统一做（sideEffects≠none），广播在 handler 内——命令层⛔ 再各自刷。
    vscode.commands.registerCommand('verilogViz.renameFile', async (arg: any) => {
      const uri = menuUri(arg); if (!uri) return;
      const name = uri.path.split('/').pop() || uri.fsPath;
      const next = await vscode.window.showInputBox({ prompt: '重命名', value: name });
      if (!next || next === name) return;
      await executeTool(context, CALLER_UI, 'fs.rename', { uri: uri.fsPath, newName: next }).catch(() => undefined);
    }),
    vscode.commands.registerCommand('verilogViz.deleteFile', async (arg: any) => {
      const uri = menuUri(arg); if (!uri) return;
      const name = uri.path.split('/').pop() || uri.fsPath;
      const { isDir, files } = await describeDeletion(context, uri);
      // X7/G6：目录删除的确认要亮出规模（子的规模 + 绑定记录将同葬的警告——不让人盲删）
      const pick = isDir
        ? await vscode.window.showWarningMessage(`删除目录「${name}」？其中含 ${files} 个文件；指向目录内文件的部件记录与绑定将一并清除。`, { modal: true }, '删除')
        : await vscode.window.showWarningMessage(`删除「${name}」？`, { modal: true }, '删除');
      if (pick !== '删除') return;
      await executeTool(context, CALLER_UI, 'fs.delete', { uri: uri.fsPath }).catch(() => undefined);
    }),
    vscode.commands.registerCommand('verilogViz.duplicateFile', async (arg: any) => {
      const uri = menuUri(arg); if (!uri) return;
      await executeTool(context, CALLER_UI, 'fs.duplicateFile', { uri: uri.fsPath });
      refreshAllTrees();   // X5：命令体主动张榜（onToolExecuted 也会刷，双保险口径不变）
    }),
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
    vscode.commands.registerCommand('verilogViz.bindParts', async (arg: any, focusArg?: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri();
      if (!uri) { void vscode.window.showInformationMessage('先在文件（.djs 或 .v/.sv/.vh）上右键。'); return; }
      if (!isBindablePath(uri.fsPath)) {
        void vscode.window.showInformationMessage('只能在编译域（.v/.sv/.vh）或沙盒域（.djs）文件上打开部件绑定。');
        return;
      }
      // 层次树行（点击 command 带第二参＝实例名 / 右键传行 Node{label}，本层⛔ 挂文件 uri）
      //   ⇒ 弹窗打开后**定位到那一条**（修用户实锤"点 alu_top 弹到别的、找不到那颗行"）。
      const focus = typeof focusArg === 'string' && focusArg
        ? focusArg
        : (!menuUri(arg) && typeof arg?.label === 'string' ? arg.label : undefined);
      await openBindingPicker(context, uri, focus);
    }),

    // R144「固化绑定」：机械体已上账为 bindings.materialize 工具（批次二）——命令=薄壳+告示。
    // 已录入的条目⛔ 覆盖（手编内容珍贵）；固化后行为不变——变的是"文件说的和画布做的终于对得上"。
    vscode.commands.registerCommand('verilogViz.materializeBindings', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri();
      if (!uri) { void vscode.window.showInformationMessage('先在文件（.djs 或 .v）上右键。'); return; }
      const docRel = rel(projectRoot(context), uri);
      const r = await executeTool(context, CALLER_UI, 'bindings.materialize', { doc: docRel }).catch(() => undefined) as { done: string[] } | undefined;
      void vscode.window.showInformationMessage(r?.done.length
        ? `已固化 ${r.done.length} 条自动绑定进该目录的 ${META_FILE}：${r.done.slice(0, 3).join('、')}${r.done.length > 3 ? '…' : ''}`
        : '没有需要固化的自动绑定（未录入的要么已按记录走，要么无同名可解）。');
    }),

    // R146 绑定完整性·核查：全层枚举「⛔ 表里没录、靠同名兜底」的实例——配置不齐当场可见。
    // 带直达动作：［写全配置］一键落表（等同 complete 命令），［打开配置］直开该层文件。
    vscode.commands.registerCommand('verilogViz.auditBindings', async (arg: any) => {
      const uri = menuUri(arg) ?? getActiveSandboxDocUri() ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri || !isBindablePath(uri.fsPath)) { void vscode.window.showInformationMessage('先在编译域（.v/.sv/.vh）或沙盒域（.djs）文件上右键。'); return; }
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
      if (!uri || !isBindablePath(uri.fsPath)) { void vscode.window.showInformationMessage('先在编译域（.v/.sv/.vh）或沙盒域（.djs）文件上右键。'); return; }
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

    // R144 右键补全家（照旧 UI 清单）：复制文件夹（目录右键定位落点，标题钮＝项目根）
    vscode.commands.registerCommand('verilogViz.duplicateFolder', async (arg: any) => {
      const uri = menuUri(arg);
      if (!uri) return;
      await executeTool(context, CALLER_UI, 'fs.duplicateFolder', { uri: uri.fsPath });
      refreshAllTrees();
    }),
    // 导入三分域（X6）：定义在 push 体外的 doImport 工厂（menuUri/refreshAllTrees 闭包共享）
    vscode.commands.registerCommand('verilogViz.importFiles', doImport(['v', 'sv', 'djs'])),
    vscode.commands.registerCommand('verilogViz.importVerilogFiles', doImport(['v', 'sv', 'vh'])),
    vscode.commands.registerCommand('verilogViz.importSandboxFiles', doImport(['djs'])),
    // C9「移动到…」：QuickPick 选目标目录（含「项目根」）→ fs.move 工具（(n) 去重 + G1 随迁）
    vscode.commands.registerCommand('verilogViz.moveTo', async (arg: any) => {
      const uri = menuUri(arg);
      if (!uri) { void vscode.window.showInformationMessage('先在文件/目录上右键再选「移动到…」。'); return; }
      const dirs = await scanDirChoices(context);
      const pick = await vscode.window.showQuickPick(
        dirs.map((d) => ({ label: d.rel || '项目根（磁盘顶层）', description: d.rel || undefined, dir: d })),
        { placeHolder: '移动到哪个目录？（绑定记录随迁）' },
      );
      if (!pick) return;
      await executeTool(context, CALLER_UI, 'fs.move', { src: uri.fsPath, destDir: pick.dir.uri.fsPath }).catch(() => undefined);
    }),
    // C10/C11：工具层管剪贴板/定位，命令层只管告示（根相对口径在告示里同亮）
    vscode.commands.registerCommand('verilogViz.copyPath', async (arg: any) => {
      const uri = menuUri(arg); if (!uri) return;
      const r = await executeTool(context, CALLER_UI, 'fs.copyPath', { uri: uri.fsPath }) as { path: string };
      void vscode.window.showInformationMessage(`已复制路径：${rel(projectRoot(context), uri)}（绝对＝${r.path}）`);
    }),
    vscode.commands.registerCommand('verilogViz.revealInOS', (arg: any) => {
      const uri = menuUri(arg);
      if (uri) void executeTool(context, CALLER_UI, 'fs.revealInOS', { uri: uri.fsPath });
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

  // 统一调用层联动：任何 fs.* 工具成功执行 ⇒ 有副作用的刷六树（命令层⛔ 再各自刷；广播在 handler 内）
  context.subscriptions.push(onToolExecuted(({ toolId }) => {
    if ((loadApiContract().tools[toolId]?.sideEffects ?? 'none') !== 'none') refreshAllTrees();
  }));

  // 树的刷新时机（trees.ts 头注释承诺的那三条）：
  //   ① 工作区里 .v/.sv/.vh/.djs 的增删改 ⇒ 三棵树都重建（模块树读 .v、沙盒树读 .djs）
  //   ② 打开/切换文件夹 ⇒ 项目根换了，三棵树的数据源整体换轨
  //   ③ 活动编辑器变化 ⇒ 层次树的根跟随当前 .v 文件
  // X2（2026-10-17）：`**/*.v` 一颗挡不住 .sv——改名/新建 .sv 不自动刷新的窟窿补上三域各自一颗。
  // 片 C2 起这一排 glob 由 `verilogDomain` 从两颗域界**生成**（在这里再列一遍扩展名＝第三份主人）。
  for (const glob of [...watcherGlobs(), '**/.verilogviz.json']) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(refreshAllTrees);                // 新文件/新目录立刻进树（标题按钮建的也走这条）
    watcher.onDidChange((uri) => {
      moduleTree.refresh(); hierarchyTree.refresh();
      // R160（批1问题H）：外部改盘（agent/Write 直写 .v）⛔ 走编辑器保存事件——此前诊断永远挂旧账。
      //   闭包内的 .v 盘变更补同一脚重编译（lastJob 不在＝从未编译 ⇒ recompileOnSave 自带守卫）。
      void recompileOnExternalChange(context, uri, ensurePanel);
      if (glob.includes('verilogviz')) broadcastBindingsChanged();
    });
    watcher.onDidDelete(() => { refreshAllTrees(); if (glob.includes('verilogviz')) broadcastBindingsChanged(); });
    context.subscriptions.push(watcher);
  }
  // R160 假 API 案（真宿主 harness 实锤）：这里曾插过一颗 `workspace.onDidFilesChange`——
  //   **该 API 在 extHost 公开面上不存在**（src 与 out/ 双查无；台架桩是我写的假件，自证陷阱又咬一口）。
  //   更险的是它**炸在 activate 中段**：抛错点之前的命令/watcher 照常注册＝扩展"半活"假象
  //   （上屏 H 闭环全过），抛错点之后的改名/删除迁移监听⛔ 挂上＝X 修复静默失踪。
  //   外部改盘重编译的真根因是**闭包收缩死锁**（bindingRefs 射程集已修，watcher.onDidChange 本就触发）。
  // R160（批3问题X）：Explorer 的 F2 改名/Del 删除走 workbench 原生编辑，⛔ 经过扩展的 fs.* 工具
  //   ⇒ 此前绑定账完全不知情（真机实锤：adder.v→adder2.v 根表仍指旧名）。补两颗监听：
  //   盘上搬家 workbench 已做完，这里只补 G1 迁移 + 刷树广播（与 fs.rename/fs.delete 同一把账）。
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (e) => {
      for (const { oldUri, newUri } of e.files) {
        try { await migrateAfterExternalRename(context, oldUri, newUri); } catch { /* 单颗失败不拦整批 */ }
      }
      refreshAllTrees(); broadcastBindingsChanged();
    }),
    vscode.workspace.onDidDeleteFiles(async (e) => {
      for (const uri of e.files) {
        try { await migrateAfterExternalDelete(context, uri); } catch { /* 同上 */ }
      }
      refreshAllTrees(); broadcastBindingsChanged();
    }),
  );
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
    vscode.window.onDidChangeActiveTextEditor((ed) => { hierarchyTree.refresh(); trackLastTextEditor(ed?.document.uri); }),
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
    // 回包形状（含被闸拦下时那串 `trace`）只有一份主人——见 dispatch.ts 的 dispatchAndReply。
    await dispatchAndReply(context, (m) => { void webview.postMessage(m); }, msg);
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
        // X4：符号链接带上 'link' 记号（目录软链 ⇒ walk 侧整支跳过，防循环 symlink 死循环 collect）
        const kind = (t: number): 'file' | 'dir' | 'link' =>
          (t & vscode.FileType.SymbolicLink) ? 'link' : t === vscode.FileType.Directory ? 'dir' : 'file';
        return entries.map(([name, type]) => ({ name, type: kind(type) }));
      } catch { return []; }
    },
  };
}
