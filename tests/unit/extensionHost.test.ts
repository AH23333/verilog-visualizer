// Extension Host 的**整条链**在无头环境里跑一遍（`vscode` 走 vitest.config.ts 的 alias 指到那颗桩）。
// 片 5（全面原生）后的形状：旧 React UI 的 12 颗文件/配置 RPC 死了 ⇒ 那批格子由
// ProjectStore 直调（vscodeShell.test.ts）与 dispatch 级格子接替；新增两块无头可判的核心：
//   · `.djs` custom editor 全生命周期（openCustomDocument → init → edit/脏标 → save/backup → revert）
//   · `verilogViz.compileAndShow`（依赖闭包 → 推编译单 → 保存自动重编译）
// ⚠ 射程（与桩自己那份说明一致）：这里证的是"我们这边的接线对"，⛔ 证 VS Code 那边会这么干——
//   后者仍归真机点验。
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

type Stub = typeof import('./vscodeApiStub');

const GLOBAL_HOME = 'C:/Users/x/AppData/Roaming/VV/User/globalStorage/local.verilog-visualizer-vscode';
const EXT_DIR = 'D:/vv-studio/vscode/extensions/verilog-visualizer';
const DEV = 2, PROD = 1;                               // 与 vscode.ExtensionMode 同值

let vscode: Stub;
beforeEach(async () => {
  vi.resetModules();
  vscode = await import('vscode') as unknown as Stub;
  vscode.resetMachine();
});

/** 一颗最小可用的 ExtensionContext（`extensionUri` 落在 appRoot 里＝内置扩展那一档） */
const ctx = (mode: number) => ({
  subscriptions: [] as any[],
  extensionUri: vscode.Uri.file(EXT_DIR),
  globalStorageUri: vscode.Uri.file(GLOBAL_HOME),
  extensionMode: mode,
});

/**
 * 起一次宿主。**顺序由这里独占**：清场 → 铺内存盘 → activate → 放干那颗异步装载 webview 的 promise。
 * ⚠ 上一版把 `resetMachine()` 留在铺盘之后，于是每个"先 seed 再 boot"的用例都在断言一颗
 *   被自己抹掉的文件——症状是"找不到前端构建产物"，看着像产品缺陷，其实是台架（判据写坏的时候⛔ 响得没说服力）。
 */
async function boot(opts: { folders?: string[], mode?: number, seed?: Record<string, string>, appRoot?: string } = {}) {
  const ext = await import('../../extension/src/extension');
  vscode.resetMachine({
    ...(opts.appRoot ? { appRoot: opts.appRoot } : {}),
    ...(opts.folders ? { workspaceFolders: opts.folders.map((f, i) => ({ uri: vscode.Uri.file(f), name: f, index: i })) } : {}),
  });
  for (const [p, text] of Object.entries(opts.seed || {})) vscode.seedText(p, text);
  ext.activate(ctx(opts.mode ?? PROD) as any);
  await new Promise((r) => setTimeout(r, 0));          // wirePanel 里那颗 async IIFE（读 index.html → 改 HTML）
  return ext;
}

/** 走**真通道**问宿主一句话：面板消息处理器收 req，回 res */
async function rpc(panel: any, method: string, args: Record<string, unknown> = {}) {
  await panel.fired[0]({ vvh: 'req', id: `q-${panel.messageLog.length}`, method, args });
  const res = panel.messageLog[panel.messageLog.length - 1];
  expect(res.vvh).toBe('res');
  return res;
}
/** ⚠ 走桩自己的 `Uri.file`：内存盘的键是 `/d:/...`（带前导斜杠，与真宿主 `uri.path` 同形），
 *   手打串直接 toLowerCase 会少掉那颗斜杠 ⇒ 判据当场假红（上一版就是这个）。 */
const has = (abs: string) => vscode.state.files.has(vscode.Uri.file(abs).path.toLowerCase());

describe('开局面板：判据真的接在 activate 上（⛔ 只是"纯函数存在"）', () => {
  it('开发宿主（`--extensionDevelopmentPath`）⇒ 弹一颗面板', async () => {
    await boot({ mode: DEV });
    expect(vscode.state.panels.length).toBe(1);
  });

  it('我们自己的二进制（Production + 扩展编在 appRoot 里）⇒ 弹', async () => {
    await boot();                                     // EXT_DIR 就在 state.appRoot 底下
    expect(vscode.state.panels.length).toBe(1);
  });

  it('被装进别人的编辑器（Production + 扩展在 appRoot 外）⇒ ⛔ 弹，但命令与 serializer 照挂', async () => {
    await boot({ appRoot: 'D:/Microsoft VS Code/resources/app' });
    expect(vscode.state.panels.length).toBe(0);
    expect([...vscode.state.commands.keys()].sort()).toEqual([
      'verilogVisualizer.refreshTrees', 'verilogVisualizer.revealProjectDir',
      'verilogViz.auditBindings', 'verilogViz.auditFlush', 'verilogViz.bindParts', 'verilogViz.compileAndShow',
      'verilogViz.completeBindings', 'verilogViz.copyPath', 'verilogViz.deleteFile',
      'verilogViz.duplicateFile', 'verilogViz.duplicateFolder', 'verilogViz.exportSvg',
      'verilogViz.importFiles', 'verilogViz.importSandboxFiles', 'verilogViz.importVerilogFiles',
      'verilogViz.initProject', 'verilogViz.materializeBindings', 'verilogViz.moveTo',
      'verilogViz.newSandboxFile',
      'verilogViz.newSandboxFolder', 'verilogViz.newVerilogFile',
      'verilogViz.openBindingConfig',
      'verilogViz.openDoc', 'verilogViz.openExamples', 'verilogViz.openFile',
      'verilogViz.openModuleAt', 'verilogViz.openModuleItem', 'verilogViz.renameFile',
      'verilogViz.revealInOS', 'verilogViz.sim.stepOnce', 'verilogViz.sim.togglePause', 'verilogViz.togglePartRole',
    ]);
    expect(vscode.state.serializerViewTypes).toEqual(['verilogVisualizer']);
  });

  it('面板标题就是 workbench 标签上那行字（真机取证的锚点）', async () => {
    await boot();
    expect(vscode.state.panels[0].title).toBe('Verilog Visualizer');
    expect(vscode.state.panels[0].viewType).toBe('verilogVisualizer');
  });

  it('⛔ 把整个 appRoot 交出去当本地资源根，只给 webview 与 dist 两处', async () => {
    await boot();
    const roots = vscode.state.panels[0].roots.map((u) => u.path.toLowerCase());
    expect(roots).toEqual([
      // 折叠形＝真宿主 joinPath 语义（台架 key/joinPath 同步贴齐后，`a/../b`≡`b`）；
      // 本格的判据不变：⛔ /d:/vv-studio/vscode 整仓（含 .git）出现在白名单里
      '/d:/vv-studio/vscode/extensions/verilog-visualizer/webview',
      '/d:/vv-studio/vscode/extensions/dist',
    ]);
    // `localResourceRoots` 是 webview 能读到的最大范围：给到仓根＝整仓上游源码（含 .git）对一个网页可读
    expect(roots).not.toContain('/d:/vv-studio/vscode');
  });
});

describe('装载前提（manifest）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));

  it('在未信任的工作区里也要被激活（⛔ 让"打开文件夹就只看得到 Welcome"这一族回来）', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(true);
    // ⚠ 声明了 supported 就得给 description：VS Code 在受限模式里会把这句话显示给用户，
    //    没写等于让用户在⛔ 知道为什么放行的地方点了放行
    expect(String(manifest.capabilities.untrustedWorkspaces.description).length).toBeGreaterThan(40);
  });

  it('activationEvents 里有 onStartupFinished（⛔ 它，没人调命令时扩展根本⛔ 激活，面板也⛔ 自己弹）', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  it('main 指的是那份 esbuild 产物（改打包格式忘了同步这里＝宿主加载一颗⛔ 存在的文件）', () => {
    expect(manifest.main).toBe('./dist/extension.cjs');
    expect(fs.existsSync(path.join(ROOT, 'extension', manifest.main.replace(/^\.\//, '')))).toBe(true);
  });

  it('片 5 的四件 contribute 都在：customEditors(.djs)/menus.editor/title(.v 编译)/configuration/keybindings', () => {
    expect(manifest.contributes.customEditors?.[0]?.viewType).toBe('verilogViz.doc');
    expect(manifest.contributes.customEditors?.[0]?.selector?.[0]?.filenamePattern).toBe('*.djs');
    const editorTitle = manifest.contributes.menus?.['editor/title'] ?? [];
    // when 是颗**正则**（`resourceExtname =~ /\.(v|sv)$/`），⛔ 用字面子串 `.v` 判——那在 `\.` 转义里根本不存在
    expect(editorTitle.some((m: any) => m.command === 'verilogViz.compileAndShow'
      && /resourceExtname/.test(String(m.when)) && String(m.when).includes('v|sv'))).toBe(true);
    expect(manifest.contributes.configuration?.properties?.['verilogViz.compile.topModule']).toBeTruthy();
    expect(manifest.contributes.keybindings?.some((k: any) => k.command === 'verilogViz.compileAndShow' && k.key === 'ctrl+f5')).toBe(true);
    // 片 5-B 起的补面：F7 单步（画布语境）+ 资源管理器右键（新建 Verilog / 编译查看）
    expect(manifest.contributes.keybindings?.some((k: any) => k.command === 'verilogViz.sim.stepOnce' && k.key === 'f7')).toBe(true);
    expect((manifest.contributes.menus?.['explorer/context'] ?? []).some((m: any) => m.command === 'verilogViz.newVerilogFile')).toBe(true);
    expect((manifest.contributes.menus?.['editor/title'] ?? []).some((m: any) => m.command === 'verilogViz.exportSvg'
      && /activeCustomEditorId/.test(String(m.when)))).toBe(true);
    // 旧面板整开命令必须死（它的活被自动开局 + compileAndShow 接管）
    expect(manifest.contributes.commands?.some((c: any) => c.command === 'verilogVisualizer.open')).toBe(false);
  });
});

describe('webview 装载（⛔ 白屏那一族）', () => {
  const RAW = '<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="/vite.svg">'
    + '<script src="/digitaljs.js"></script></head><body><div id="root"></div>'
    + '<script type="module" crossorigin src="/assets/index-abc.js"></script></body></html>';

  it('找得到 index.html ⇒ 资产换成 webview URI、CSP 带 nonce', async () => {
    await boot({ folders: ['D:/p'], seed: { [`${EXT_DIR}/webview/index.html`]: RAW } });
    const html = vscode.state.panels[0].html;
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).toMatch(/nonce-[A-Za-z0-9]{32}/);
    expect(html).toContain('vscode-webview://fake/D:/vv-studio/vscode/extensions/verilog-visualizer/webview/assets/index-abc.js');
    expect(html).not.toMatch(/src="\/assets\//);
  });

  it('找不到产物 ⇒ 给一句能读的补救话，⛔ 留一颗空白面板', async () => {
    await boot({ folders: ['D:/p'] });
    const html = vscode.state.panels[0].html;
    expect(html).toContain('找不到前端构建产物');
    expect(html).toContain('pnpm build');
  });

  it('仓库内开发态（产物在 `../dist`）也认——⛔ 逼人先打包', async () => {
    await boot({ folders: ['D:/p'], seed: { [`${EXT_DIR}/../dist/index.html`]: RAW } });   // 代码里就是 joinPath(ext,'..','dist')
    expect(vscode.state.panels[0].html).toMatch(/Content-Security-Policy/);
  });
});

describe('面板释放与命令：两条装载路共用同一个主人', () => {
  it('恢复出来的面板关掉后登记会清掉 ⇒ 再触发装载是**新开**而不是 reveal 一颗死面板', async () => {
    await boot();
    const first = vscode.state.panels[0];
    first.dispose();
    expect(first.disposed).toBe(true);
    await boot2Compile();                               // compileAndShow 走 ensurePanel：死面板⛔ 被复用
    expect(vscode.state.panels.length).toBe(2);
    expect(vscode.state.panels[1].revealCount).toBe(0);
  });

  /** 在非内置 appRoot 下（开局⛔ 自动弹）用 compileAndShow 触发一颗新面板 */
  async function boot2Compile() {
    const ext = await import('../../extension/src/extension');
    const topUri = vscode.Uri.file('D:/p/top.v');
    await vscode.commands.executeCommand('verilogViz.compileAndShow', topUri);
    await new Promise((r) => setTimeout(r, 0));
    return ext;
  }

  it('没面板时 compileAndShow ⇒ 开一颗（⛔ "点了没反应"）', async () => {
    await boot({
      appRoot: 'C:/elsewhere', folders: ['D:/p'],
      seed: { [`${EXT_DIR}/../dist/index.html`]: RAW_DOC, 'D:/p/top.v': 'module top; endmodule' },
    });
    expect(vscode.state.panels.length).toBe(0);
    await boot2Compile();
    expect(vscode.state.panels.length).toBe(1);
  });

  it('revealProjectDir 把当前项目根抄进剪贴板并说出来（真机点验第 4 格靠它）', async () => {
    await boot({ folders: ['D:/projects/计数器'] });
    await vscode.commands.executeCommand('verilogVisualizer.revealProjectDir');
    expect(vscode.state.clipboard).toBe('D:\\projects\\计数器');
    expect(vscode.state.infoMessages.join('|')).toContain('项目根目录');
    // ⚠ "在资源管理器里真看得见这个目录"那一格⛔ 能在桩里判，归真机点验
  });
});

const RAW_DOC = '<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>';

describe('侧边栏双容器六视图（片 5-B 编译/沙盒分家；R152 起「文件」×2 回归原生树＝真资源管理器形态）', () => {
  it('六棵原生树在 activate 期注册，id 与 manifest 对上（R152：webview 文件视图退役——展开/图标/右键全走 workbench 原生）', async () => {
    await boot();
    expect(Object.keys(vscode.state.treeProviders).sort()).toEqual([
      'verilogViz.codeFiles', 'verilogViz.hierarchy', 'verilogViz.modules',
      'verilogViz.sandboxFiles', 'verilogViz.sandboxHierarchy', 'verilogViz.sandboxParts',
    ]);
    expect(Object.keys(vscode.state.webviewViews)).toEqual([]);   // R152：两颗 webview「文件」⛔ 再冒头
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    expect(manifest.contributes.viewsContainers?.activitybar?.map((c: any) => c.id).sort())
      .toEqual(['verilogVizCode', 'verilogVizSandbox']);
    expect(manifest.contributes.views?.verilogVizCode?.map((v: any) => v.id)).toEqual([
      'verilogViz.codeFiles', 'verilogViz.modules', 'verilogViz.hierarchy',
    ]);
    expect(manifest.contributes.views?.verilogVizSandbox?.map((v: any) => v.id)).toEqual([
      'verilogViz.sandboxFiles', 'verilogViz.sandboxParts', 'verilogViz.sandboxHierarchy',
    ]);
    // 「文件」两颗在 manifest 里以 type tree 声明（⛔ 再走 webview 自绘回潮——「与 Explorer 不符」原罪）
    expect(manifest.contributes.views?.verilogVizCode?.find((v: any) => v.id === 'verilogViz.codeFiles')?.type).toBe('tree');
    expect(manifest.contributes.views?.verilogVizSandbox?.find((v: any) => v.id === 'verilogViz.sandboxFiles')?.type).toBe('tree');
  });

  it('模块树：文件→模块两级，空文件⛔ 上榜，点击滚到 `module <名>` 行', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.v': 'module top;\n  sub s1();\nendmodule',
        'D:/p/lib/alu.v': 'module alu;\nendmodule',
        'D:/p/empty.v': '// 没有模块定义',
      },
    });
    const mods = vscode.state.treeProviders['verilogViz.modules'];
    const files = await mods.getChildren();
    expect(files.map((n: any) => n.label).sort()).toEqual(['alu.v', 'top.v']);
    expect(files.find((n: any) => n.label === 'alu.v').desc).toBe('lib');

    const topMods = await mods.getChildren(files.find((n: any) => n.label === 'top.v'));
    expect(topMods.map((n: any) => n.label)).toEqual(['top']);
    expect(topMods[0].kind).toBe('module');

    await vscode.commands.executeCommand('verilogViz.openModuleAt', topMods[0].uri, topMods[0].label);
    const editor = vscode.state.editors[vscode.state.editors.length - 1];
    expect(editor.document.getText()).toContain('module top;');
    expect((editor as any).revealed).toHaveLength(1);
    expect((editor as any).revealed[0].startLine).toBe(0);
  });

  it('片 C2（X8 同根）：`.sv`/`.vh` 里定义的模块在『模块』『层次结构』两块板上都亮（修前只认 .v）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.sv': 'module topsv;\n  invh i();\nendmodule',
        'D:/p/defs.vh': 'module invh;\nendmodule',
        'D:/p/plain.v': 'module plain;\nendmodule',
      },
    });
    // ① 模块树三颗域文件全上榜（修前＝top.sv/defs.vh 整颗隐身，用户看到的是"文件在树里、模块不在"）
    const mods = vscode.state.treeProviders['verilogViz.modules'];
    const files = await mods.getChildren();
    expect(files.map((n: any) => n.label).sort()).toEqual(['defs.vh', 'plain.v', 'top.sv']);

    // ② 层次树的根接受 `.sv`（修前＝门槛写死 extname==='.v'，打开 .sv 只给提示节点）
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file('D:/p/top.sv'));
    vscode.state.activeEditor = { document: doc, viewColumn: 1, revealRange: () => { } };
    const root = await vscode.state.treeProviders['verilogViz.hierarchy'].getChildren();
    expect(root.map((n: any) => n.label)).toEqual(['invh']);
    // ③ 定义在 `.vh` 里也找得到（修前＝定义索引只扫 *.v ⇒ 这一格报「未找到定义」）
    expect(root[0].desc).toBe('defs.vh');
    expect(root[0].uri).toBeTruthy();
  });

  it('层次树：活动 .v 的实例 → 定义文件（真扫描，⛔ 只会猜 `模块名.v`）→ 递归展开；互相例化⛔ 死循环', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.v': 'module top;\n  a a1();\n  b b1();\nendmodule',
        'D:/p/a.v': 'module a;\n  b b2();\nendmodule',
        'D:/p/b.v': 'module b;\n  a a2();\nendmodule',
      },
    });
    const hierarchy = vscode.state.treeProviders['verilogViz.hierarchy'];

    // 没开源码文件 ⇒ 提示节点，⛔ 报错（片 C2：那颗门槛由域界主人给答案，提示语把三域都念出来）
    const hint = (await hierarchy.getChildren())[0].label as string;
    expect(hint).toContain('Verilog 源码文件');
    for (const ext of ['.v', '.sv', '.vh']) expect(hint).toContain(ext);

    // 假装用户打开了 top.v（活动编辑器是层次树的根）
    const topUri = vscode.Uri.file('D:/p/top.v');
    const topDoc = await vscode.workspace.openTextDocument(topUri);
    vscode.state.activeEditor = { document: topDoc, viewColumn: 1, revealRange: () => { } };
    const root = await hierarchy.getChildren();
    expect(root.map((n: any) => n.label).sort()).toEqual(['a', 'b']);
    // 定义文件是**扫**出来的，⛔ 靠文件名约定
    expect(root.find((n: any) => n.label === 'a').desc).toBe('a.v');

    // 展开 a → b（定义在 b.v）；再展开 b → a 已在链上，环守卫拦下
    const aNode = root.find((n: any) => n.label === 'a');
    const level2 = await hierarchy.getChildren(aNode);
    expect(level2.map((n: any) => n.label)).toEqual(['b']);
    const level3 = await hierarchy.getChildren(level2[0]);
    expect(level3).toEqual([]);

    // 点击实例 = openModuleAt：打开定义文件并滚到那一行
    await vscode.commands.executeCommand('verilogViz.openModuleAt', level2[0].uri, 'b');
    const editor = vscode.state.editors[vscode.state.editors.length - 1];
    expect(editor.document.getText()).toContain('module b;');
    expect((editor as any).revealed).toHaveLength(1);
  });

  it('刷新时机：.v/.djs/.verilogviz.json 三颗 watcher 在册，fire 增删改不炸（树刷新+绑定回灌接线）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top.v': 'module top; endmodule' } });
    const globs = ['**/*.djs', '**/*.sv', '**/*.v', '**/*.vh', '**/.verilogviz.json'];   // X2：五域 watcher 在册（ASCII 排序位）
    expect(vscode.state.watchers.map((w) => w.glob).sort()).toEqual(globs);
    const watcherOf = (glob: string) => vscode.state.watchers.find((w) => w.glob === glob)!;
    const uri = vscode.Uri.file('D:/p/新模块.v');
    for (const w of vscode.state.watchers) {
      expect(() => w.fireCreate(uri)).not.toThrow();          // 五颗 watcher 对 .v 增删改都不炸
      expect(() => w.fireChange(uri)).not.toThrow();
      expect(() => w.fireDelete(uri)).not.toThrow();
    }
    // R137：手改 `.verilogviz.json` 存盘 ⇒ 活画布收到 bindingsChanged 推送（改完即生效的回灌链）
    const { registerWebviewSink, unregisterWebviewSink } = await import('../../extension/src/dispatch');
    const got: any[] = [];
    const sink: any = { postMessage: (m: any) => { got.push(m); return Promise.resolve(true); } };
    registerWebviewSink(sink);
    try {
      watcherOf('**/.verilogviz.json').fireChange(vscode.Uri.file('D:/p/.verilogviz.json'));
      expect(got.some((m) => m.vvh === 'push' && m.op === 'bindingsChanged')).toBe(true);
      got.length = 0;
      // ⛔ 混线：.v 那颗 watcher 的改动不广播绑定（只刷树）
      watcherOf('**/*.v').fireChange(uri);
      expect(got.filter((m) => m.op === 'bindingsChanged')).toHaveLength(0);
    } finally { unregisterWebviewSink(sink); }
    // 工作区切换与活动编辑器变化两条监听也接线了
    expect(vscode.state.workspaceFolderListeners).toHaveLength(1);
    expect(vscode.state.activeEditorListeners).toHaveLength(1);
  });

  it('publishProblems 落 DiagnosticCollection（error/warning 各归各位，line=null 落第 1 行）', async () => {
    await boot({ folders: ['D:/p'] });
    const panel = vscode.state.panels[0];
    const res = await rpc(panel, 'publishProblems', {
      items: [
        { fileName: 'top.v', line: 3, message: '重复定义', severity: 'error' },
        { fileName: 'top.v', line: null, message: '文件级问题', severity: 'warning' },
      ],
    });
    expect(res.ok).toBe(true);
    // ⚠ 内存盘的键走过 `key()` 的小写化（`/d:/...`），查的时候也要走同一遍（`has()` 助手同款教训）
    const diags = vscode.state.diagnostics.get(vscode.Uri.file('D:/p/top.v').path.toLowerCase())!;
    expect(diags).toHaveLength(2);
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Error);
    expect(diags[0].range.startLine).toBe(2);              // 1 起行号 → 0 起行号
    expect(diags[1].severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(diags[1].range.startLine).toBe(0);              // line=null ⇒ 第 1 行，⛔ 冒充别的行
  });

  it('appendOutput 落 OutputChannel 的累计文本', async () => {
    await boot({ folders: ['D:/p'] });
    await rpc(vscode.state.panels[0], 'appendOutput', { text: 'yosys: done.\n' });
    expect(vscode.state.outputText).toBe('yosys: done.\n');
  });
});

describe('RPC 九颗（片 5 收面后 Panel 侧的真通道形状；颗数由下面「两张表逐字相同」那格钉死，⛔ 靠标题数）', () => {
  it('getConfig：compile/sandbox 全量 + editorFontSize 跟随原生设置', async () => {
    await boot({ folders: ['D:/p'] });
    vscode.state.configValues['editor.fontSize'] = 15;
    const res = await rpc(vscode.state.panels[0], 'getConfig');
    expect(res.ok).toBe(true);
    expect(res.data.compile.autoRecompile).toBe(true);     // 默认开
    expect(res.data.sandbox.wireStyle).toBe('metro');
    expect(res.data.editorFontSize).toBe(15);
  });

  it('copyToSandbox：主电路+子部件一批落成 folder/*.djs，重名自动 (n)（B2，沙盒树靠 watcher 自刷）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: { 'D:/p/top/alu_top_sandbox.djs': '{"cells":[]}' },
    });
    const panel = vscode.state.panels[0];
    const res = await rpc(panel, 'copyToSandbox', {
      files: [
        { name: 'top/alu_top_sandbox', content: '{"cells":[1]}' },      // 与盘上现有重名 → 让位
        { name: 'top/alu_core', content: '{"cells":[2]}' },
        { name: 'top/../../../逃逸', content: '{}' },                    // ⛔ 目录逃逸必须被消毒
        { name: 'a/b:c', content: '{}' },                                // Windows 非法字符消毒
      ],
    });
    expect(res.ok).toBe(true);
    const [main, part, esc, bad] = res.data;
    expect(main).toBe('top/alu_top_sandbox (2).djs');
    expect(part).toBe('top/alu_core.djs');
    expect(has('D:/p/top/alu_core.djs')).toBe(true);
    // `..` 段被滤掉，合法段保留 ⇒ 落回 `top/` 下，⛔ 越出工作区根
    expect(esc).toBe('top/逃逸.djs');
    expect(bad).toBe('a/b_c.djs');
    expect(has('D:/p/a/b_c.djs')).toBe(true);
  });

  it('importLegacyData：requiresApproval 审批桥（拒＝NOT_APPROVED 不落盘；允许才执行）+ 旧档按名落工作区（无扩展名补 .v，重名 (n)，⛔ 逃逸）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top.v': 'module top; endmodule' } });
    const legacy = {
      items: [
        { name: 'top.v', content: 'module top_v2; endmodule' },   // 重名 → (2)
        { name: 'counter', content: 'module counter; endmodule' }, // 无扩展名 → 补 .v
        { name: '沙盒/计数器.djs', content: '{"cells":[]}' },        // 带目录
        { name: '../逃逸.v', content: 'x' },                       // ⛔ 逃逸消毒
      ],
    };
    // 负臂（协议④审批桥）：用户没点「允许」（桩默认 modalChoice=undefined＝关闭弹窗）⇒ 拒，⛔ 一颗不落
    const denied = await rpc(vscode.state.panels[0], 'importLegacyData', legacy);
    expect(denied.ok).toBe(false);
    expect(String(denied.error)).toContain('API_NOT_APPROVED');
    expect(has('D:/p/counter.v')).toBe(false);
    // 正臂：允许后照常搬运
    vscode.state.modalChoice = '允许';
    const res = await rpc(vscode.state.panels[0], 'importLegacyData', legacy);
    expect(res.ok).toBe(true);
    const [top2, counter, sb, esc] = res.data;
    expect(top2).toBe('top (2).v');
    expect(counter).toBe('counter.v');
    expect(sb).toBe('沙盒/计数器.djs');
    expect(has('D:/p/沙盒/计数器.djs')).toBe(true);
    expect(esc).not.toMatch(/\.\./);
  });

  it('X18：旧档迁移把部件身份一起带走——role:part 落本层目录表、partBindings 按批内 key 连到落盘名（解不到＝只记 Output，⛔ 落一条悬空绑定）', async () => {
    // 修前的形状：`collectLegacyItems` 只交 {name, content}，旧沙盒档里的 `role:'part'` 与
    // `partBindings`（文件级绑定，值＝批内文件 id）整批丢掉 ⇒ 迁完那些部件退化成普通画布档，
    // 曾经显式录入的实现关系也无声变成"看同名兜底"。这一族正是 R152「配置里录了才算」的反面。
    await boot({ folders: ['D:/p'] });
    vscode.state.modalChoice = '允许';
    const res = await rpc(vscode.state.panels[0], 'importLegacyData', {
      // 名字逐字照前端真交的形状：`collectLegacyItems` 给沙盒那半颗统一补过 `.djs`
      //（宿主对**无扩展名**的条目补的是 `.v`——那是源码那半颗的路径，⛔ 拿它当部件档的写法）
      items: [
        { name: 'parts/adder.djs', content: '{"cells":[1]}', key: 'sb_a', role: 'part' },
        { name: 'parts/full_adder.djs', content: '{"cells":[2]}', key: 'sb_f', role: 'part' },
        { name: 'top.djs', content: '{"cells":[3]}', key: 'sb_t', bindings: { adder: 'sb_a' } },
        { name: 'orphan.djs', content: '{"cells":[4]}', key: 'sb_o', bindings: { ghost: 'sb_missing' } },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(['parts/adder.djs', 'parts/full_adder.djs', 'top.djs', 'orphan.djs']);
    const readText = (abs: string) => new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file(abs).path.toLowerCase())!);
    const partsTable = JSON.parse(readText('D:/p/parts/.verilogviz.json'));
    // 两颗部件各自把"我就是 adder 这个实现"录进**所在目录**的表（值按层目录相对化，与 copyToSandbox 同源）
    expect(partsTable.bindings).toEqual({ adder: 'adder.djs', full_adder: 'full_adder.djs' });
    const rootTable = JSON.parse(readText('D:/p/.verilogviz.json'));
    // 顶层档那条显式绑定跟着搬：值＝批内那颗的**落盘名**（重名被改过也连得上，⛔ 认旧 id）
    expect(rootTable.bindings.adder).toBe('parts/adder.djs');
    // 负件：解不到的绑定 id⛔ 进表（进了就是永远解不开的悬空项），但必须在 Output 里说一句话
    expect(rootTable.bindings.ghost).toBeUndefined();
    expect(partsTable.bindings.ghost).toBeUndefined();
    const log = String(vscode.state.outputText || '');
    expect(log).toContain('ghost');
  });

  it('协议④端点闸：幽灵 method=NOT_REGISTERED；apiSurface 反查与 surfaces 判定与账一致', async () => {
    await boot();
    const ghost = await rpc(vscode.state.panels[0], 'notOnAnyLedger', {});
    expect(ghost.ok).toBe(false);
    expect(String(ghost.error)).toContain('API_NOT_REGISTERED');           // 未上账的方法连 switch 都进不去
    const { canSurface, toolIdForRpc } = await import('../../extension/src/apiSurface');
    expect(toolIdForRpc('getConfig')).toBe('host.getConfig');
    expect(toolIdForRpc('compileAndShow')).toBeUndefined();                 // ui-only 工具不吃 rpc 反查
    expect(canSurface('host.getConfig', 'rpc')).toBe(true);
    expect(canSurface('host.getConfig', 'mcp')).toBe(false);                // 账上未开 mcp（阶段二接线前）＝硬拒
    expect(canSurface('compile.compileAndShow', 'ui')).toBe(true);
    expect(canSurface('ghost.tool', 'ui')).toBe(false);
  });



  const needPanel = async () => { for (let i = 0; i < 24 && !vscode.state.panels.length; i++) await new Promise((r) => setTimeout(r, 0)); expect(vscode.state.panels.length > 0).toBe(true); };
  it('协议⑤工程覆盖臂①：.vv/api.json 端点裁光＝API_SURFACE_DENIED；未知工具忽略；未动工具照常', async () => {
    const projApi = JSON.stringify({
      surfacesGlobal: { rpc: true },
      tools: {
        'host.copyToSandbox': { surfaces: ['ui'] },
        'host.nope': { surfaces: [], perm: 'read' },               // 未知工具：忽略该条不采纳
      },
    });
    await boot({ folders: ['D:/p'], seed: { 'D:/p/.vv/api.json': projApi } });
    await needPanel();
    const cut = await rpc(vscode.state.panels[0], 'copyToSandbox', { files: [{ name: 'a', content: '{}' }] });
    expect(cut.ok).toBe(false);
    expect(String(cut.error)).toContain('API_SURFACE_DENIED');     // 报"端点关了"而非"查无此人"（文案各归各位）
    const okCfg = await rpc(vscode.state.panels[0], 'getConfig', {});
    expect(okCfg.ok).toBe(true);                                    // 没被动过的工具照常用
  });

  it('协议⑤工程覆盖臂②：固有属性（perm/ref/sideEffects）越权＝整份拒并 warn，默认账一颗不动', async () => {
    await boot({ folders: ['D:/w'], seed: {
      'D:/w/.vv/api.json': JSON.stringify({ tools: { 'host.getConfig': { perm: 'file-write' } } }),
    } });
    await needPanel();
    expect(vscode.state.warnMessages.some((m: string) => m.includes('固有属性'))).toBe(true);
    const okCfg2 = await rpc(vscode.state.panels[0], 'getConfig', {});
    expect(okCfg2.ok).toBe(true);
    // 越权文件里的其他合法条目也随整份拒绝作废（不做半采纳——两张皮比全拒更难查）
    const other = await rpc(vscode.state.panels[0], 'copyToSandbox', { files: [{ name: 'a', content: '{}' }] });
    expect(other.ok).toBe(true);                                    // copyToSandbox 未被越权文件合法裁剪 ⇒ 默认面保留
  });

  it('协议⑤工程覆盖臂③：合法关门 surfacesGlobal.rpc=false＝整条 RPC 面 DENIED；且只能关不能开', async () => {
    await boot({ folders: ['D:/m'], seed: {
      'D:/m/.vv/api.json': JSON.stringify({ surfacesGlobal: { rpc: false, mcp: true } }),
    } });
    await needPanel();
    const closed = await rpc(vscode.state.panels[0], 'getConfig', {});
    expect(closed.ok).toBe(false);
    expect(String(closed.error)).toContain('API_SURFACE_DENIED');
    const { canSurface } = await import('../../extension/src/apiSurface');
    expect(canSurface('host.getConfig', 'mcp')).toBe(false);        // 文件里想开 mcp＝无效（只关不开）
  });

  it('协议⑥initProject：首跑建 .vv/project.json + .gitignore 规则表；maxDepth=8 与实现对齐；二跑零新建', async () => {
    await boot({ folders: ['D:/p'], seed: {} });
    await vscode.commands.executeCommand('verilogViz.initProject');
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.vv/project.json').path.toLowerCase())!);
    const pj = JSON.parse(raw);
    expect(pj.kind).toBe('project');
    expect(pj.schemaVersion).toBe('0.3.1');
    expect(pj.bindings.defaults.resolution.maxDepth).toBe(8);           // 唯一默认值出处 ↔ collectInstanceHits 常量
    expect(pj.paths.cacheDir).toBe('.vv/cache');
    expect(raw.indexOf('"schemaVersion"')).toBeLessThan(raw.indexOf('"paths"'));   // 头在前（写序契约）
    const gi = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.vv/.gitignore').path.toLowerCase())!);
    for (const line of ['env.json', 'runtime.json', 'cache/', 'agent/', 'audit/']) expect(gi).toContain(line);
    const msgs1 = vscode.state.infoMessages.length;
    await vscode.commands.executeCommand('verilogViz.initProject');    // 二跑：一颗不覆零新建
    expect(vscode.state.infoMessages.length).toBe(msgs1 + 1);
    expect(vscode.state.infoMessages[vscode.state.infoMessages.length - 1]).toContain('无需初始化');
    expect(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.vv/project.json').path.toLowerCase())!)).toBe(raw);
  });

  it('协议⑥幂等护手编：已有自定义 project.json 时 initProject ⛔ 一字不碰', async () => {
    const mine = JSON.stringify({ schemaVersion: '0.3.1', kind: 'project', meta: { name: 'my-board' }, paths: { outDir: 'out', cacheDir: 'tmp' }, bindings: { defaults: { resolution: { searchOrder: ['sameFolder', 'root', 'global'], maxDepth: 6, allowSelfReference: false } } } }, null, 2) + '\n';
    await boot({ folders: ['D:/p'], seed: { 'D:/p/.vv/project.json': mine } });
    await vscode.commands.executeCommand('verilogViz.initProject');
    expect(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.vv/project.json').path.toLowerCase())!)).toBe(mine);
  });

  it('协议⑨闸③臂①：api.grants.json 白名单语义——只在册的工具放行，档案外＝API_NOT_GRANTED 且审计记 not-granted', async () => {
    const grants = JSON.stringify({
      schemaVersion: '0.3.1',
      subjects: { ui: 'builder' },
      profiles: { builder: ['host.getConfig', 'host.getAllBindings'] },
    });
    await boot({ folders: ['D:/g1'], seed: {
      'D:/g1/.vv/project.json': '{"kind":"project"}',
      'D:/g1/.vv/api.grants.json': grants,
    } });
    await needPanel();
    expect((await rpc(vscode.state.panels[0], 'getConfig', {})).ok).toBe(true);
    expect((await rpc(vscode.state.panels[0], 'getAllBindings', { doc: 'x.v' })).ok).toBe(true);
    const cut = await rpc(vscode.state.panels[0], 'copyToSandbox', { files: [{ name: 'a', content: '{}' }] });
    expect(cut.ok).toBe(false);
    expect(String(cut.error)).toContain('API_NOT_GRANTED');       // 档案没给＝拒（与 SURFACE_DENIED 各归各位）
    await new Promise((r) => setTimeout(r, 5));                   // 审计 fire-and-forget：等它入缓冲再催收
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const day = new Date().toISOString().slice(0, 10);
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/g1/.vv/audit/trace-' + day + '.jsonl').path.toLowerCase())!);
    const deny = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((v: any) => v.ref === 'copyToSandbox').pop();
    expect(deny?.verdict).toBe('not-granted');                    // 账本也记被拒（§9.5 不变量）
    expect(String(deny?.note)).toContain('API_NOT_GRANTED');
  });

  it('协议⑨闸③臂②：档案拒绝走得比审批弹窗早——requiresApproval 工具未获授权⛔ 默不进弹窗', async () => {
    const grants = JSON.stringify({ subjects: { ui: 'reviewer' }, profiles: { reviewer: ['host.getConfig'] } });
    await boot({ folders: ['D:/g2'], seed: { 'D:/g2/.vv/api.grants.json': grants } });
    await needPanel();
    vscode.state.modalChoice = '允许';                            // 逆预设：若闸序错了，这一拍就把工具放行了
    const cut = await rpc(vscode.state.panels[0], 'importLegacyData', { items: [] });
    expect(cut.ok).toBe(false);
    expect(String(cut.error)).toContain('API_NOT_GRANTED');
    expect(String(cut.error)).not.toContain('API_NOT_APPROVED');  // 拒在闸③＝审批从未发生
  });

  it('协议⑨闸③臂③：绑了个查无档案的 profile＝fail-closed（白名单清空），⛔ 当成"忘绑"放行', async () => {
    const grants = JSON.stringify({ subjects: { ui: 'ghost' }, profiles: { reviewer: ['host.getConfig'] } });
    await boot({ folders: ['D:/g3'], seed: { 'D:/g3/.vv/api.grants.json': grants } });
    await needPanel();
    const cut = await rpc(vscode.state.panels[0], 'getConfig', {});
    expect(cut.ok).toBe(false);
    expect(String(cut.error)).toContain('API_NOT_GRANTED');
  });

  it('协议⑨闸③臂④：档案只收窄它绑定过的调用方——ui 未绑＝不受闸；mcp:身份绑了＝同文件同闸拦住', async () => {
    const { checkGrant, loadProjectGrants } = await import('../../extension/src/apiGrants');
    const grants = JSON.stringify({ subjects: { 'mcp:probe-server': 'reviewer' }, profiles: { reviewer: ['host.getAllBindings'] } });
    await boot({ folders: ['D:/g4'], seed: { 'D:/g4/.vv/api.grants.json': grants } });
    await needPanel();
    await loadProjectGrants({ extensionUri: vscode.Uri.file(EXT_DIR) } as any);   // 重读档案（activate 那拍异步的确定化）
    expect((await rpc(vscode.state.panels[0], 'getConfig', {})).ok).toBe(true);   // ui 没绑＝闸对它没话
    expect(checkGrant('mcp:probe-server', 'host.getConfig')).toBe(false);          // mcp 身份绑了：不在册＝拒
    expect(checkGrant('mcp:probe-server', 'host.getAllBindings')).toBe(true);      // 在册＝放
    expect(checkGrant('cli:unknown-proc', 'host.getConfig')).toBe(true);           // cli 没绑＝同 ui 没话
  });

  it('协议⑨闸③臂⑤：档案解析失败＝紧告警宽运行（收窄器坏了⛔ 砖死全 UI）', async () => {
    await boot({ folders: ['D:/g5'], seed: { 'D:/g5/.vv/api.grants.json': '{ not-json' } });
    await needPanel();
    await new Promise((r) => setTimeout(r, 5));
    expect(vscode.state.warnMessages.some((m: string) => m.includes('解析失败'))).toBe(true);
    expect((await rpc(vscode.state.panels[0], 'getConfig', {})).ok).toBe(true);    // 闸不生效，闸 1/2 照办
  });

  it('协议⑨闸③臂⑥：vv-grants schema 挂进 jsonValidation + 词表要用对（⛔ 说书两张皮）', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    const hit = (manifest.contributes.jsonValidation || []).find((x: any) => x.fileMatch === '**/.vv/api.grants.json');
    expect(hit?.url).toBe('./schemas/vv-grants.schema.json');
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/schemas/vv-grants.schema.json'), 'utf8'));
    const subjRe = new RegExp(schema.properties.subjects.propertyNames.pattern);
    expect(subjRe.test('ui')).toBe(true);
    expect(subjRe.test('mcp:probe-server')).toBe(true);
    expect(subjRe.test('mcp:')).toBe(false);
    const profRe = new RegExp(schema.properties.profiles.propertyNames.pattern);
    expect(profRe.test('builder')).toBe(true);
    expect(profRe.test('config.write') || profRe.test('9bad')).toBe(false);         // 域词表封闭 ⛔ config.*（§9.6）
    const idRe = new RegExp(schema.properties.profiles.additionalProperties.items.pattern);
    expect(idRe.test('host.getConfig')).toBe(true);
    expect(idRe.test('config.writeAll') || idRe.test('unknown.tool')).toBe(false);  // ⛔ 起野域 / 查账外工具
  });

  it('jumpToSource：打开文件并滚到那一行（画布双击器件 → 源码）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top.v': 'line0\nline1\nmodule top; endmodule' } });
    const res = await rpc(vscode.state.panels[0], 'jumpToSource', { file: 'top.v', line: 2 });
    expect(res.ok).toBe(true);
    const editor = vscode.state.editors[vscode.state.editors.length - 1];
    expect(editor.document.getText()).toContain('module top;');
    expect((editor as any).revealed[0].startLine).toBe(2);
  });

  it('⛔ 没人应答的方法名：dispatch 落到 default 必须回错误（⛔ 挂着等超时）', async () => {
    await boot({ folders: ['D:/p'] });
    const res = await rpc(vscode.state.panels[0], 'saveProjectFile', { name: 'x.v', content: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/API_NOT_REGISTERED|不认识的调用/);   // 协议④后由契约闸先拦（更前更早拒），语义不变：⛔ 挂着等超时
  });

  it('另存为：取消＝false（⛔ 报错），确认＝按 base64 解出的字节写到用户选的那个位置', async () => {
    await boot({ folders: ['D:/p'] });
    const panel = vscode.state.panels[0];
    const b64 = Buffer.from(new TextEncoder().encode('<svg/>')).toString('base64');
    const cancel = await rpc(panel, 'saveExportFile', { base64: b64, defaultName: 'a.svg' });
    expect(cancel.ok).toBe(true);
    expect(cancel.data).toBe(false);                   // 用户按取消 ⇒ false ⇒ 前端显示"导出已取消"

    // 对话框结果宿主每次现读 ⇒ ⛔ 重新 activate，也 ⛔ 整台机器重设（那会连内存盘一起清）
    vscode.state.saveDialogResult = vscode.Uri.file('D:/out/a.svg');
    const ok = await rpc(panel, 'saveExportFile', { base64: b64, defaultName: 'a.svg' });
    expect(ok.data).toBe(true);
    expect(new TextDecoder().decode(vscode.state.files.get('/d:/out/a.svg')!)).toBe('<svg/>');
  });
});

describe('`.djs` custom editor（片 5-A2：沙盒真源从 localStorage 迁到工作区文件）', () => {
  /** 起一台带 doc.html 产物的机器并拿 provider */
  async function bootDoc(seedExtra: Record<string, string> = {}) {
    await boot({
      folders: ['D:/p'],
      seed: {
        [`${EXT_DIR}/webview/doc.html`]: RAW_DOC,
        'D:/p/画布甲.djs': '{"cells":[0]}',
        'D:/p/画布乙.djs': '{"cells":[1]}',
        ...seedExtra,
      },
    });
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    expect(reg).toBeTruthy();
    return reg!;
  }

  /** 双击 `.djs` 的宿主半段：openCustomDocument → resolveCustomEditor（自带起机）。
   *  ⚠ init 是 **ready 握手**后才发的（webview 没装载完时 postMessage 会被丢，真机实测）——
   *  所以这里要替 webview 补发那颗 ready。 */
  async function openDoc(absPath: string) {
    await bootDoc();
    const uri = vscode.Uri.file(absPath);
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    const doc = await reg.provider.openCustomDocument(uri);
    const panel = vscode.window.createWebviewPanel('docTest', uri.fsPath, 1, {});
    await reg.provider.resolveCustomEditor(doc, panel);
    await new Promise((r) => setTimeout(r, 0));        // resolve 里那颗 async 装载
    panel.fired[0]({ vvh: 'doc', op: 'ready' });
    await new Promise((r) => setTimeout(r, 0));
    return { doc, panel };
  }

  it('activate 期注册，且 webviewOptions 带 retainContextWhenHidden（切走⛔ 停表）', async () => {
    await bootDoc();
    expect(vscode.state.customEditorProviders['verilogViz.doc'].options?.webviewOptions?.retainContextWhenHidden).toBe(true);
  });

  it('就绪握手：ready 之前 init ⛔ 抢跑（webview 没装载完时 postMessage 会丢＝真机黑屏那一族）', async () => {
    await bootDoc();
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    const doc = await reg.provider.openCustomDocument(vscode.Uri.file('D:/p/画布甲.djs'));
    const panel = vscode.window.createWebviewPanel('docTest', '画布甲.djs', 1, {});
    await reg.provider.resolveCustomEditor(doc, panel);
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.messageLog.filter((m: any) => m.vvh === 'doc')).toEqual([]);   // ⛔ 抢跑
    panel.fired[0]({ vvh: 'doc', op: 'ready' });
    await new Promise((r) => setTimeout(r, 0));
    expect(panel.messageLog.some((m: any) => m.vvh === 'doc' && m.op === 'init')).toBe(true);
  });

  it('init 推送：content + 同文件夹兄弟文档（部件源，顶替 localStorage）；html 装载带 CSP', async () => {
    const { doc, panel } = await openDoc('D:/p/画布甲.djs');
    expect(panel.html).toMatch(/Content-Security-Policy/);
    const init = panel.messageLog.find((m: any) => m.vvh === 'doc' && m.op === 'init');
    expect(init).toBeTruthy();
    expect(init.content).toBe('{"cells":[0]}');
    expect(init.docName).toBe('画布甲.djs');
    expect(init.siblings.map((s: any) => s.name).sort()).toEqual(['画布乙.djs']);   // 自己⛔ 在 siblings 里
    expect(doc.content).toBe('{"cells":[0]}');
  });

  it('edit → 脏标（onDidChangeCustomDocument）→ save 落工作区真文件；undo 把 webview 拉回去', async () => {
    const { doc, panel } = await openDoc('D:/p/画布甲.djs');
    const edits: any[] = [];
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    reg.provider.onDidChangeCustomDocument!((e: any) => edits.push(e));

    panel.fired[0]({ vvh: 'doc', op: 'edit', content: '{"cells":[9]}' });
    expect(doc.content).toBe('{"cells":[9]}');
    expect(edits.length).toBe(1);                      // 脏标来自 edit 事件（⛔ 靠 backup 差异猜）

    await reg.provider.saveCustomDocument(doc, vscode.CancellationToken.None);
    expect(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/画布甲.djs').path.toLowerCase())!)).toBe('{"cells":[9]}');

    // undo：快照栈退回上一版，并通知 webview（画布要跟着变）
    await edits[0].undo();
    expect(doc.content).toBe('{"cells":[0]}');
    const revert = panel.messageLog.filter((m: any) => m.vvh === 'doc' && m.op === 'revert');
    expect(revert.length).toBeGreaterThanOrEqual(1);
    expect(revert[revert.length - 1].content).toBe('{"cells":[0]}');
    await edits[0].redo();
    expect(doc.content).toBe('{"cells":[9]}');
  });

  it('backup 写宿主指的destination；revert 重读盘并重推 init 内容（外部改盘的那条路）', async () => {
    const uri = vscode.Uri.file('D:/p/画布甲.djs');
    const { doc, panel } = await openDoc('D:/p/画布甲.djs');
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];

    panel.fired[0]({ vvh: 'doc', op: 'edit', content: '{"cells":[7]}' });
    const dest = vscode.Uri.file('D:/backup/画布甲.djs');
    const backup = await reg.provider.backupCustomDocument(doc, { destination: dest }, vscode.CancellationToken.None);
    expect(backup.id).toBe(dest.toString());
    expect(new TextDecoder().decode(vscode.state.files.get(dest.path.toLowerCase())!)).toBe('{"cells":[7]}');
    await backup.delete();
    expect(has('D:/backup/画布甲.djs')).toBe(false);

    // 外部把盘改了 → revert 必须以**盘上**为准（webview 手里的那版作废）
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{"cells":[99]}'));
    await reg.provider.revertCustomDocument(doc, vscode.CancellationToken.None);
    expect(doc.content).toBe('{"cells":[99]}');
    const revert = panel.messageLog.filter((m: any) => m.vvh === 'doc' && m.op === 'revert');
    expect(revert[revert.length - 1].content).toBe('{"cells":[99]}');
  });

  it('doc webview 也能走 RPC：同一份 dispatch（6 颗）在两条装载线上共用', async () => {
    const { panel } = await openDoc('D:/p/画布甲.djs');
    const res = await rpc(panel, 'getConfig');
    expect(res.ok).toBe(true);
    expect(res.data.sandbox.gridSize).toBe(16);
  });
});

describe('verilogViz.compileAndShow（片 5-A3：.v 归原生编辑器，画布收推单）', () => {
  // ⚠ 夹具模块名⛔ 用 `sub`/`and` 这类**原语门名**——parseVerilogInstances 会把它们当原语过滤掉
  const SEED = {
    [`${EXT_DIR}/../dist/index.html`]: RAW_DOC,
    'D:/p/top.v': 'module top;\n  adder a1();\nendmodule',
    'D:/p/lib/adder.v': 'module adder;\n  and g1();\nendmodule',
    'D:/p/orphan.v': 'module orphan; endmodule',
    // R152：所有被例化模块须显式绑定（⛔ 同名兜底）——adder 录到 lib/adder.v
    'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'lib/adder.v' } }),
  };

  it('依赖闭包：从入口出发拉到 adder 为止，⛔ 把全工作区文件都塞进编译单', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    await new Promise((r) => setTimeout(r, 0));
    const push = vscode.state.panels[0].messageLog.find((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect(push).toBeTruthy();
    expect(push.files.map((f: any) => f.name).sort()).toEqual(['lib/adder.v', 'top.v']);
    expect(push.topModule).toBe('top');                // 设置没配 ⇒ 入口文件的第一个模块
    expect(push.entryName).toBe('top.v');
  });

  it('没开 .v 也不给参数 ⇒ 说一句人话，⛔ 报错栈', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.compileAndShow');
    expect(vscode.state.infoMessages.join('|')).toContain('先打开一个');
  });

  it('X8 结案（片 C2）：`.vh` 能当编译入口，且绑定表指到 `.vh` 的定义被采纳（修前两道门各写死 v|sv）', async () => {
    await boot({
      appRoot: 'C:/elsewhere', folders: ['D:/p'],
      seed: {
        [`${EXT_DIR}/../dist/index.html`]: RAW_DOC,
        'D:/p/top.vh': 'module toph;\n  hdr h1();\nendmodule',
        'D:/p/defs.vh': 'module hdr;\nendmodule',
        'D:/p/.verilogviz.json': JSON.stringify({ bindings: { hdr: 'defs.vh' } }),
      },
    });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.vh'));
    await new Promise((r) => setTimeout(r, 0));
    const push = vscode.state.panels[0].messageLog.find((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect(push).toBeTruthy();                                  // 修前：门槛把 .vh 挡回，这里根本没有推单
    expect(push.files.map((f: any) => f.name).sort()).toEqual(['defs.vh', 'top.vh']);
    expect(push.topModule).toBe('toph');
    expect(push.bindingErrors).toBeUndefined();                 // 修前：.vh 目标落进"不支持的绑定目标"
  });

  it('入口文件里⛔ 有模块定义时，兜底 topModule 是**去扩展名**的名字（那颗读反的 .sv? 曾交回 `x.vh`）', async () => {
    await boot({
      appRoot: 'C:/elsewhere', folders: ['D:/p'],
      seed: {
        [`${EXT_DIR}/../dist/index.html`]: RAW_DOC,
        'D:/p/hdr_only.vh': '`define W 8',                     // 纯头文件：没有 module
      },
    });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/hdr_only.vh'));
    await new Promise((r) => setTimeout(r, 0));
    const push = vscode.state.panels[0].messageLog.find((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect(push.topModule).toBe('hdr_only');                    // ⛔ 'hdr_only.vh'（yosys 会报找不到顶层）
  });

  it('保存闭包内的文件 ⇒ 自动重编译（autoRecompile 默认开）；闭包外⛔ 扰民', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    await new Promise((r) => setTimeout(r, 0));
    const pushes = () => vscode.state.panels[0].messageLog.filter((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect(pushes().length).toBe(1);

    // 闭包内（lib/adder.v 是 top 的依赖）⇒ 重推
    const adderDoc = await vscode.workspace.openTextDocument(vscode.Uri.file('D:/p/lib/adder.v'));
    for (const fn of [...vscode.state.saveListeners]) fn(adderDoc);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushes().length).toBe(2);

    // 闭包外（orphan.v 谁也没例化它）⇒ ⛔ 重推
    const orphanDoc = await vscode.workspace.openTextDocument(vscode.Uri.file('D:/p/orphan.v'));
    for (const fn of [...vscode.state.saveListeners]) fn(orphanDoc);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushes().length).toBe(2);

    // 设置关掉 ⇒ 同样⛔ 重推
    await vscode.workspace.getConfiguration('verilogViz').update('compile.autoRecompile', false);
    for (const fn of [...vscode.state.saveListeners]) fn(adderDoc);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushes().length).toBe(2);
  });

  it('sim/export 三颗命令打进活画布（没人听就静默落空，⛔ 报错）', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    // 没画布：三颗都不炸
    await vscode.commands.executeCommand('verilogViz.sim.togglePause');
    await vscode.commands.executeCommand('verilogViz.sim.stepOnce');
    await vscode.commands.executeCommand('verilogViz.exportSvg');
    // 开了画布：进它的消息流水账
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    await new Promise((r) => setTimeout(r, 0));
    await vscode.commands.executeCommand('verilogViz.sim.togglePause');
    await vscode.commands.executeCommand('verilogViz.exportSvg');
    const ops = vscode.state.panels[0].messageLog.filter((m: any) => m.vvh === 'push').map((m: any) => m.op);
    expect(ops).toContain('sim');
    expect(ops).toContain('export');
  });

  it('openExamples：QuickPick 选中 → examples/ 落盘 → 开编辑器 → 自动编译；取消⛔ 落盘', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    vscode.state.quickPickResult = undefined;          // 用户取消
    await vscode.commands.executeCommand('verilogViz.openExamples');
    expect([...vscode.state.files.keys()].some((k) => k.includes('/examples/'))).toBe(false);

    const examples = await import('../../shared/examples');
    // 带真 label＝items 里的同一颗对象（桩收紧后：无 label＝列表外＝选中不了）
    vscode.state.quickPickResult = { label: examples.VERILOG_EXAMPLES[0].title, example: examples.VERILOG_EXAMPLES[0] };
    await vscode.commands.executeCommand('verilogViz.openExamples');
    await new Promise((r) => setTimeout(r, 0));
    const exampleFile = [...vscode.state.files.keys()].find((k) => k.includes('/examples/'));
    expect(exampleFile).toBeTruthy();
    // 示例落盘后自动编译：面板收到 compile 推单
    const push = vscode.state.panels[0]?.messageLog?.find((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect(push).toBeTruthy();
  });

  it('newVerilogFile：输入框拿名字（自动补 .v）→ 萈最小模板并打开', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'], seed: SEED });
    vscode.state.inputBoxResult = 'counter';
    await vscode.commands.executeCommand('verilogViz.newVerilogFile');
    expect(has('D:/p/counter.v')).toBe(true);
    const content = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/counter.v').path.toLowerCase())!);
    expect(content).toContain('module counter');
    expect(vscode.state.editors.at(-1)!.document.fileName).toContain('counter.v');
    vscode.state.inputBoxResult = undefined;           // 取消 ⇒ ⛔ 落盘
    await vscode.commands.executeCommand('verilogViz.newVerilogFile');
    expect([...vscode.state.files.keys()].filter((k) => k.endsWith('.v')).length).toBe(4); // seed 三颗 + counter.v
  });
});

describe('双容器六树的台架驱动（片 5-B）', () => {
  const SEED = {
    'D:/p/top.v': 'module top;\n  adder a1();\nendmodule',
    'D:/p/lib/adder.v': 'module adder; endmodule',
    'D:/p/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"adder"},{"type":"Subcircuit","celltype":"counter"}]}',
    'D:/p/parts/adder.djs': '{"cells":[]}',
  };

  it('codeFiles（原生树）：目录层级报告 + 分域（⛔ 收 .djs）；右键菜单全部住在 view/item/context', async () => {
    await boot({ folders: ['D:/p'], seed: { ...SEED, 'D:/p/x.djs': '{}' } });
    const tree = vscode.state.treeProviders['verilogViz.codeFiles'];
    const root = (await tree.getChildren()) as any[];
    // 顶层 = lib/top.v 必在；目录**全量上报**（真资源管理器形态：空目录/只有 .djs 的目录也亮——
    // 这是用户裁决的「完整文件系统」，分域只管文件）；⛔ .djs 文件本身上榜
    const rootLabels = root.map((n) => n.label);
    expect(['lib', 'parts', 'top.v'].every((k) => rootLabels.includes(k))).toBe(true);
    expect(rootLabels.filter((k) => k === 'main.djs' || k === 'x.djs')).toEqual([]);
    const lib = root[0];
    const kids = (await tree.getChildren(lib)) as any[];
    expect(kids.map((n) => n.label)).toEqual(['adder.v']);
    const item = await tree.getTreeItem(kids[0]);
    expect(item.contextValue).toBe('codeFile');
    expect(String(item.resourceUri!.fsPath).toLowerCase()).toContain('lib\\adder.v');
    const libItem = await tree.getTreeItem(lib);
    expect(libItem.contextValue).toBe('codeDir');
    expect(String(libItem.resourceUri!.fsPath).toLowerCase()).toContain('\\lib');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    const vic = manifest.contributes.menus['view/item/context'];
    // 文件行：编译/重命名/副本/删除/绑定全家
    for (const cmd of ['verilogViz.compileAndShow', 'verilogViz.renameFile', 'verilogViz.duplicateFile', 'verilogViz.deleteFile', 'verilogViz.bindParts', 'verilogViz.openBindingConfig'])
      expect(vic.some((m: any) => m.when === 'view == verilogViz.codeFiles && viewItem == codeFile' && m.command === cmd)).toBe(true);
    // 目录行：在此新建两族 + 导入（X6 域设防：codeFiles 只吃编译域命令）+ 复制/删除
    for (const cmd of ['verilogViz.newVerilogFile', 'verilogViz.newSandboxFolder', 'verilogViz.importVerilogFiles', 'verilogViz.duplicateFolder', 'verilogViz.deleteFile'])
      expect(vic.some((m: any) => m.when === 'view == verilogViz.codeFiles && viewItem == codeDir' && m.command === cmd)).toBe(true);
    expect(manifest.contributes.menus['webview/context']).toBeUndefined();     // R152：webview 通道整档退场
    expect(manifest.contributes.menus['explorer/context'].some((m: any) => String(m.when).includes('!resourceScheme'))).toBe(true); // 空白族在
  });

  it('sandboxFiles（原生树）：层级 + 点击进画布编辑器（openWith）；目录项挂 resourceUri 供「在此新建」', async () => {
    await boot({ folders: ['D:/p'], seed: { ...SEED, 'D:/p/gates/and.djs': '{"cells":[]}' } });
    const tree = vscode.state.treeProviders['verilogViz.sandboxFiles'];
    const root = (await tree.getChildren()) as any[];
    expect(root.map((n) => [n.label, n.dir !== undefined ? 'dir' : 'file']).filter((x) => x[0] === 'gates' || x[0] === 'main.djs' || x[0] === 'parts'))
      .toEqual([['gates', 'dir'], ['parts', 'dir'], ['main.djs', 'file']]);
    const f = (await tree.getChildren(root.find((n: any) => n.label === 'gates'))) as any[];
    expect(f.map((n) => n.label)).toEqual(['and.djs']);
    const item = await tree.getTreeItem(f[0]);
    expect(item.contextValue).toBe('sandboxFile');
    expect(item.command?.command).toBe('vscode.openWith');                    // 点树项 = 进画布，⛔ openFile 文本
    const dirItem = await tree.getTreeItem(root.find((n: any) => n.label === 'gates'));
    expect(dirItem.contextValue).toBe('sandboxDir');
    expect(dirItem.resourceUri).toBeTruthy();                                 // 「在此新建」的命脉（menuUri 取它）
  });

  it('sandboxParts：circuits 名单外的全部 .djs（缺省部件，与画布 refreshGates 同口径）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: { ...SEED, [`${EXT_DIR}/webview/doc.html`]: RAW_DOC, 'D:/p/parts/counter.djs': '{"cells":[]}' },
    });
    // 把 adder.djs 显式取消部件（circuits 名单）
    await vscode.commands.executeCommand('verilogViz.togglePartRole', vscode.Uri.file('D:/p/parts/adder.djs'));
    const nodes = await vscode.state.treeProviders['verilogViz.sandboxParts'].getChildren();
    expect(nodes.map((n: any) => n.label).sort()).toEqual(['counter.djs', 'main.djs']);  // adder 已被取消
  });

  it('sandboxHierarchy：数据源＝活动 .djs 文档的子电路实例（打开/编辑上报，无文档给引导）', async () => {
    await boot({ folders: ['D:/p'], seed: SEED });
    const trees = await import('../../extension/src/trees');
    const hierarchy = vscode.state.treeProviders['verilogViz.sandboxHierarchy'];
    expect((await hierarchy.getChildren())[0].label).toContain('打开一个 .djs');
    trees.setActiveSandboxDoc('main.djs', ['adder', 'counter']);   // customEditors init/edit 时就是这么上报的
    expect((await hierarchy.getChildren()).map((n: any) => n.label).sort()).toEqual(['adder', 'counter']);
    // 点击树项 = 直奔该子电路的部件绑定（带活动文档 uri）
    const item = await hierarchy.getTreeItem((await hierarchy.getChildren())[0]);
    expect(item.command?.command).toBe('verilogViz.bindParts');
    expect(String(item.command?.arguments?.[0])).toContain('main.djs');
  });

  it('bindParts（.djs 形状）：解析子电路实例 → 打开独立 webview 绑定面板 → 保存写文档所在目录表（⛔ 旧 QuickPick）', async () => {
    await boot({ folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/main.djs'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding');
    expect(panel).toBeTruthy();
    expect(panel!.title).toContain('main.djs');
    // 开局即推 data（instances+parts），⛔ 等 webview ready 才喂数据（真机黑屏那档）
    const data = panel!.messageLog.find((m: any) => m.vvh === 'binding' && m.op === 'data')?.data;
    expect(data.instances.map((i: any) => i.name).sort()).toEqual(['adder', 'counter']);
    // webview 保存：写文档所在目录表（值＝根相对）
    await panel!.fired[0]({ vvh: 'binding', op: 'save', changes: { counter: 'parts/adder.djs' } });
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings).toEqual({ counter: 'parts/adder.djs' });
    // 再次打开＝reveal 同一颗（singleton，⛔ 堆叠）
    const before = vscode.state.panels.length;
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/main.djs'));
    expect(vscode.state.panels.length).toBe(before);
  });

  it('bindParts（.v 形状）：候选清单＝工作区 Verilog 文件（⛔ .djs 清单——录进去就是编译侧不认的死值）', async () => {
    await boot({ folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/top.v'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    const data = panel.messageLog.find((m: any) => m.vvh === 'binding' && m.op === 'data')?.data;
    expect(data.mode).toBe('verilog');
    expect(data.parts).toContain('lib/adder.v');     // Verilog 文件在候选里
    expect(data.parts).not.toContain('top.v');       // ⛔ 把自己列成部件
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { adder: 'lib/adder.v' } });
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings.adder).toBe('lib/adder.v');  // ⛔ 强加 .djs 尾，也⛔ 只有 .djs 可挑
    expect(meta.bindings.top).toBeUndefined();        // 顶层模块⛔ 进绑定表
  });

  it('深度自检新增（R153）：未录入实例那一行亮得出「自动同名 → lib/adder.v」（修前恒 null）', async () => {
    // 这颗臂测的是**那一半**：修前的索引建在闭包 job.files 上，而闭包只含"已录入绑定"的文件
    // ⇒ 未录入实例按构造永远命不中，面板对每个这样的实例一直报"未绑定"（盘上有实现看不见）。
    await boot({ folders: ['D:/p'], seed: SEED });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/top.v'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    const data = panel.messageLog.find((m: any) => m.vvh === 'binding' && m.op === 'data')?.data;
    const adder = data.instances.find((i: any) => i.name === 'adder');
    expect(adder.recorded).toBe(null);                 // ⛔ 靠"已经录了"才算命中（那颗死查表的成因）
    expect(adder.auto).toBe('lib/adder.v');            // 定义文件在**子目录**里也要看得见
  });

  it('sibling role：circuits 名单里→circuit，其余→part（⛔ 再回到"全 circuit"把部件清空）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: { [`${EXT_DIR}/webview/doc.html`]: RAW_DOC, 'D:/p/画布甲.djs': '{"cells":[0]}', 'D:/p/画布乙.djs': '{"cells":[1]}' },
    });
    await vscode.commands.executeCommand('verilogViz.togglePartRole', vscode.Uri.file('D:/p/画布乙.djs'));
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    const doc = await reg.provider.openCustomDocument(vscode.Uri.file('D:/p/画布甲.djs'));
    const panel = vscode.window.createWebviewPanel('docTest', 'x', 1, {});
    await reg.provider.resolveCustomEditor(doc, panel);
    panel.fired[0]({ vvh: 'doc', op: 'ready' });
    await new Promise((r) => setTimeout(r, 0));
    const init = panel.messageLog.find((m: any) => m.vvh === 'doc' && m.op === 'init');
    const roles = Object.fromEntries(init.siblings.map((s: any) => [s.name, s.role]));
    expect(roles).toEqual({ '画布乙.djs': 'circuit' });  // 画布甲是打开中的文档⛔ 在 siblings
  });
});

describe('树右键菜单与视图标题按钮、Verilog 高亮（真机"全无"那一族的回归）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));

  it('view/item/context 的 when 全是单条件且键名是 viewItem（基座 treeView.ts:1806 的真键名；写成 contextValue＝真机右键全无）', () => {
    const entries = manifest.contributes.menus?.['view/item/context'] ?? [];
    // R152 口径：webview/context 整档退役，view/item/context 全量收回（菜单搬家不是裁剪）
    // ——HEAD 原生 17 + 文件树文件/目录两态新菜单 27 ＝ 44；再砍任何一条都算倒退
    expect(entries.length).toBeGreaterThanOrEqual(44);
    expect(manifest.contributes.menus?.['webview/context']).toBeUndefined();
    for (const m of entries) expect(String(m.when)).toMatch(/^view == [\w.]+ && viewItem == \w+$/);
    // 回归钉子：⛔ 再让 contextValue 这个想当然的键名回来（它永假＝菜单永远不亮）
    expect(entries.some((m: any) => String(m.when).includes('contextValue'))).toBe(false);
    // 原生侧七种树项都有菜单：模块文件/模块/层次实例/部件文件/沙盒层次实例/文件树文件/文件树目录
    const kinds = new Set(entries.map((m: any) => String(m.when).split('viewItem == ')[1]));
    for (const k of ['sandboxFile', 'sandboxDir', 'codeFile', 'codeDir', 'module', 'moduleFile', 'hierarchyItem', 'sandboxHierarchyItem'])
      expect(kinds.has(k)).toBe(true);
    // 两颗文件树按视图分家（同名暗号交叉时靠 view == 圈死管辖；⛔ 无 view 限定的裸 viewItem）
    expect(entries.some((m: any) => String(m.when).includes('viewItem == codeFile') && !String(m.when).includes('verilogViz.codeFiles'))).toBe(false);
    expect(entries.some((m: any) => String(m.when).includes('viewItem == sandboxDir') && !String(m.when).includes('verilogViz.sandboxFiles'))).toBe(false);
  });

  it('视图标题按钮组：新建/刷新六视图全配，命令带 codicon 图标（⛔ 无图标＝埋进 … 溢出菜单看不见）', () => {
    const title = manifest.contributes.menus?.['view/title'] ?? [];
    const views = ['verilogViz.codeFiles', 'verilogViz.modules', 'verilogViz.hierarchy',
      'verilogViz.sandboxFiles', 'verilogViz.sandboxParts', 'verilogViz.sandboxHierarchy'];
    for (const v of views) {
      expect(title.some((m: any) => m.when === `view == ${v}` && m.command === 'verilogVisualizer.refreshTrees')).toBe(true);
    }
    expect(title.some((m: any) => m.when === 'view == verilogViz.codeFiles' && m.command === 'verilogViz.newVerilogFile')).toBe(true);
    expect(title.some((m: any) => m.when === 'view == verilogViz.sandboxFiles' && m.command === 'verilogViz.newSandboxFile')).toBe(true);
    expect(title.some((m: any) => m.when === 'view == verilogViz.sandboxFiles' && m.command === 'verilogViz.newSandboxFolder')).toBe(true);
    // 折叠按钮归基座自带（createTreeView 的 showCollapseAll 点亮）；⛔ 再引用本基座不存在的死命令 id
    expect(title.some((m: any) => String(m.command).includes('collapseAll'))).toBe(false);
    const iconOf = (cmd: string) => manifest.contributes.commands?.find((c: any) => c.command === cmd)?.icon;
    expect(iconOf('verilogVisualizer.refreshTrees')).toBe('$(refresh)');
    expect(iconOf('verilogViz.newVerilogFile')).toBe('$(new-file)');
    expect(iconOf('verilogViz.newSandboxFile')).toBe('$(new-file)');
    expect(iconOf('verilogViz.newSandboxFolder')).toBe('$(new-folder)');
  });

  it('Verilog 高亮：languages(.v/.sv) + grammars 声明齐全，grammar 文件真实存在且分色层够厚', () => {
    const langs = manifest.contributes.languages ?? [];
    expect(langs.find((l: any) => l.id === 'verilog')?.extensions).toContain('.v');
    expect(langs.find((l: any) => l.id === 'systemverilog')?.extensions).toContain('.sv');
    const grammars = manifest.contributes.grammars ?? [];
    expect(grammars.find((g: any) => g.language === 'verilog')?.scopeName).toBe('source.verilog');
    expect(grammars).toHaveLength(2);
    for (const g of grammars) expect(fs.existsSync(path.join(ROOT, 'extension', String(g.path).replace(/^\.\//, '')))).toBe(true);
    // 分色层厚度：类型/端口方向/例化名/位宽字面量各有自己的 scope（"只亮一小部分关键字"那一族）
    const grammar = fs.readFileSync(path.join(ROOT, 'extension/grammars/verilog.tmLanguage.json'), 'utf8');
    for (const scope of ['storage.type.verilog', 'storage.modifier.verilog', 'entity.name.function.verilog',
      'entity.name.type.verilog', 'constant.numeric.sized.verilog', 'support.function.system.verilog'])
      expect(grammar).toContain(scope);
  });

  it('六棵树全走 createTreeView 且 showCollapseAll: true（基座折叠钮开关）；R152：禁止任何 webview 型视图回潮', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top.v': 'module top; endmodule' } });
    expect([...vscode.state.treeViews].map((t) => ({ id: t.id, showCollapseAll: t.showCollapseAll })).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'verilogViz.codeFiles', showCollapseAll: true },
      { id: 'verilogViz.hierarchy', showCollapseAll: true },
      { id: 'verilogViz.modules', showCollapseAll: true },
      { id: 'verilogViz.sandboxFiles', showCollapseAll: true },
      { id: 'verilogViz.sandboxHierarchy', showCollapseAll: true },
      { id: 'verilogViz.sandboxParts', showCollapseAll: true },
    ]);
    expect(vscode.state.webviewViews['verilogViz.codeFiles']).toBeUndefined();    // R148 webview 形态退役（用户裁决 2026-10-17）
    expect(vscode.state.webviewViews['verilogViz.sandboxFiles']).toBeUndefined();
  });

  it('六树的 contextValue 与 when 的暗号对上；提示节点⛔ 冒充可右键项（菜单会把 TreeItem 当 Uri 传进命令）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.v': 'module top;\n  adder a1();\nendmodule',
        'D:/p/lib/adder.v': 'module adder; endmodule',
        'D:/p/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"adder"}]}',
      },
    });
    const mods = vscode.state.treeProviders['verilogViz.modules'];
    const mFiles = await mods.getChildren();
    expect((await mods.getTreeItem(mFiles[0])).contextValue).toBe('moduleFile');
    const mMods = await mods.getChildren(mFiles[0]);
    expect((await mods.getTreeItem(mMods[0])).contextValue).toBe('module');

    const hierarchy = vscode.state.treeProviders['verilogViz.hierarchy'];
    expect((await hierarchy.getTreeItem((await hierarchy.getChildren())[0])).contextValue).toBeUndefined();   // 提示节点
    vscode.state.activeEditor = { document: await vscode.workspace.openTextDocument(vscode.Uri.file('D:/p/top.v')), viewColumn: 1, revealRange: () => { } };
    const inst = (await hierarchy.getChildren())[0];
    expect((await hierarchy.getTreeItem(inst)).contextValue).toBe('hierarchyItem');

    const parts = vscode.state.treeProviders['verilogViz.sandboxParts'];
    const pNodes = await parts.getChildren();
    expect(pNodes.map((n: any) => n.label)).toEqual(['main.djs']);   // 无 circuits 名单 ⇒ 缺省全是部件
    expect((await parts.getTreeItem(pNodes[0])).contextValue).toBe('sandboxFile');

    const trees = await import('../../extension/src/trees');
    trees.setActiveSandboxDoc('main.djs', ['adder']);
    const sbH = vscode.state.treeProviders['verilogViz.sandboxHierarchy'];
    const sbNodes = await sbH.getChildren();
    expect((await sbH.getTreeItem(sbNodes[0])).contextValue).toBe('sandboxHierarchyItem');
  });

  it('newSandboxFile/newSandboxFolder：输入框拿名字 → 空画布/目录落盘；取消⛔ 动作、`..` 段⛔ 逃逸', async () => {
    await boot({ appRoot: 'C:/elsewhere', folders: ['D:/p'] });
    vscode.state.inputBoxResult = 'adder';
    await vscode.commands.executeCommand('verilogViz.newSandboxFile');
    expect(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/adder.djs').path.toLowerCase())!)).toBe('{"cells":[]}');
    vscode.state.inputBoxResult = undefined;           // 取消 ⇒ ⛔ 落盘
    await vscode.commands.executeCommand('verilogViz.newSandboxFile');
    expect([...vscode.state.files.keys()].filter((k) => k.endsWith('.djs'))).toHaveLength(1);

    vscode.state.inputBoxResult = 'parts/gates';
    await vscode.commands.executeCommand('verilogViz.newSandboxFolder');
    expect(vscode.state.dirs.has(vscode.Uri.file('D:/p/parts/gates').path.toLowerCase())).toBe(true);
    vscode.state.inputBoxResult = '../逃逸';           // `..` 段被滤掉 ⇒ 落回项目根，⛔ 越出工作区
    await vscode.commands.executeCommand('verilogViz.newSandboxFolder');
    expect(vscode.state.dirs.has(vscode.Uri.file('D:/p/逃逸').path.toLowerCase())).toBe(true);
  });
});

describe('R137 目录级显式绑定（`.verilogviz.json` 在盘可见、仿 settings.json 分层合并、可手改即生效）', () => {
  const readMetaFile = (p: string) => {
    const b = vscode.state.files.get(vscode.Uri.file(p).path.toLowerCase());
    return b ? JSON.parse(new TextDecoder().decode(b)) : undefined;
  };

  it('bindParts 写「文档所在目录」的表（缺表即建；⛔ 污染根表）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/lib/top.djs': '{"cells":[{"type":"Subcircuit","celltype":"half"}]}',
      'D:/p/lib/full.djs': '{"cells":[]}',
    } });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/lib/top.djs'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { half: 'lib/full.djs' } });   // 根相对写入，表逻辑折成同目录裸名
    expect(readMetaFile('D:/p/lib/.verilogviz.json').bindings).toEqual({ half: 'full.djs' });  // 同目录部件存裸名（相对本层）
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())).toBe(false);
  });

  it('getAllBindings(doc) 链合并：近层覆盖远层、各层值按本层目录解析；不带 doc＝根表（兼容）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { counter: 'shared/counter.djs', adder: 'shared/adder.djs' } }),
      'D:/p/sub/.verilogviz.json': JSON.stringify({ bindings: { counter: 'local_counter.djs' } }),
      'D:/p/sub/top.djs': '{"cells":[]}',
    } });
    const panel = vscode.state.panels[0];
    expect((await rpc(panel, 'getAllBindings', { doc: 'sub/top.djs' })).data)
      .toEqual({ counter: 'sub/local_counter.djs', adder: 'shared/adder.djs' });   // sub 层盖根层
    expect((await rpc(panel, 'getAllBindings', {})).data)
      .toEqual({ counter: 'shared/counter.djs', adder: 'shared/adder.djs' });      // 旧调用＝根表语义
  });

  it('setDocBindings 落文档目录层：整表替换、值相对化，读回 round-trip 一致', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/sub/top.djs': '{"cells":[]}' } });
    const panel = vscode.state.panels[0];
    await rpc(panel, 'setDocBindings', { docName: 'sub/top.djs', bindings: { a: 'shared/x.djs', b: 'sub/y.djs' } });
    expect(readMetaFile('D:/p/sub/.verilogviz.json').bindings).toEqual({ a: '../shared/x.djs', b: 'y.djs' });
    const back = await rpc(panel, 'getAllBindings', { doc: 'sub/top.djs' });
    expect(back.data).toEqual({ a: 'shared/x.djs', b: 'sub/y.djs' });               // `../` 折回根相对
  });

  it('normalizePartName：剥双 `.djs` 扩展 ⇒ 单尾；⛔ 给 .v/.gate 部件强加 `.djs` 尾（"绑了没反应"真根源）', async () => {
    const { normalizePartName } = await import('../../extension/src/sandboxFiles');
    expect(normalizePartName('fsm_controller.djs.djs')).toBe('fsm_controller.djs');  // test_files 实证脏形
    expect(normalizePartName('counter')).toBe('counter.djs');                        // 无扩展补沙盒主形
    expect(normalizePartName('parts/adder.v')).toBe('parts/adder.v');                // .v 原样（⛔ v.djs）
    expect(normalizePartName('gates/nand.gate')).toBe('gates/nand.gate');            // .gate 原样
  });

  it('openBindingConfig：有表直开⛔ 覆盖（用户手编内容珍贵）、无表先建再开', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/lib/.verilogviz.json': '{"circuits":[],"bindings":{"half":"full.djs"}}',
      'D:/p/lib/top.djs': '{"cells":[]}', 'D:/p/fresh/new.djs': '{"cells":[]}',
    } });
    await vscode.commands.executeCommand('verilogViz.openBindingConfig', vscode.Uri.file('D:/p/lib/top.djs'));
    expect(readMetaFile('D:/p/lib/.verilogviz.json').bindings).toEqual({ half: 'full.djs' });
    expect(vscode.state.editors.some((e: any) => String(e?.document?.uri?.path || '').includes('lib/.verilogviz.json'))).toBe(true);
    await vscode.commands.executeCommand('verilogViz.openBindingConfig', vscode.Uri.file('D:/p/fresh/new.djs'));
    expect(readMetaFile('D:/p/fresh/.verilogviz.json')).toMatchObject({ bindings: {} });   // 目录有部件缺表⇒建
  });

  it('重命名迁移：部件改名各层绑定与 circuits 同步改指（⛔ 悬空旧路径）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: ['parts/counter.djs'], bindings: { counter: 'parts/counter.djs' } }),
      'D:/p/parts/counter.djs': '{"cells":[]}', 'D:/p/main.djs': '{"cells":[]}',
    } });
    vscode.state.inputBoxResult = 'count2.djs';
    await vscode.commands.executeCommand('verilogViz.renameFile', vscode.Uri.file('D:/p/parts/counter.djs'));
    const meta = readMetaFile('D:/p/.verilogviz.json');
    expect(meta.bindings.counter).toBe('parts/count2.djs');
    expect(meta.circuits).toEqual(['parts/count2.djs']);
  });

  it('删除清绑：删掉被绑定的部件文件 ⇒ 各层指向它的绑定同删（⛔ 留下解不开的悬空项）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { counter: 'parts/counter.djs', other: 'parts/other.djs' } }),
      'D:/p/parts/counter.djs': '{"cells":[]}',
    } });
    vscode.state.modalChoice = '删除';
    await vscode.commands.executeCommand('verilogViz.deleteFile', vscode.Uri.file('D:/p/parts/counter.djs'));
    expect(readMetaFile('D:/p/.verilogviz.json').bindings).toEqual({ other: 'parts/other.djs' });
  });

  it('X1/G6：删目录＝recursive+useTrash 双真（真机"非空目录删不掉"的根因）＋确认弹窗报子件数', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/lib/a.v': 'module a; endmodule',
      'D:/p/lib/sub/b.djs': '{"cells":[]}',
    } });
    vscode.state.modalChoice = '删除';
    await vscode.commands.executeCommand('verilogViz.deleteFile', vscode.Uri.file('D:/p/lib'));
    const call = vscode.state.deleteCalls.find((c) => c.path.toLowerCase().endsWith('lib'));
    expect(call?.recursive).toBe(true);                 // ⛔ 不带 recursive＝真宿主抛"目录非空"
    expect(call?.useTrash).toBe(true);                  // G5：永远回收站
    expect(vscode.state.warnMessages.join()).toContain('2 个文件');   // X7：确认里亮出规模（a.v + sub/b.djs）
    expect(vscode.state.files.has('d:/p/lib/a.v')).toBe(false);       // 孩子真没了
    expect(vscode.state.files.has('d:/p/lib/sub/b.djs')).toBe(false);
  });

  it('X6：importFromUris 域设防——跨界文件不落盘、skipped 计数（fs.import 工具机械体）', async () => {
    await boot({ folders: ['D:/p'] });
    const { importFromUris } = await import('../../extension/src/sandboxFiles');
    const out = await importFromUris(
      { } as never,
      vscode.Uri.file('D:/p/lib'),
      [vscode.Uri.file('C:/tmp/want.v'), vscode.Uri.file('C:/tmp/board.json')],   // board.json ⛔ 域外
      ['v', 'sv', 'vh'],
    );
    expect(out.written).toEqual(['lib/want.v']);
    expect(out.skipped).toBe(1);
    expect(vscode.state.files.has('d:/p/lib/board.json')).toBe(false);
  });

  it('审计臂①-a 未开户（无 .vv/）＝通道静默：rpc 照常走，audit/ 目录一颗不落地', async () => {
    await boot({ folders: ['D:/a'], seed: { 'D:/a/top.v': 'module top; endmodule' } });
    await new Promise((r) => setTimeout(r, 5));                                           // 面板异步创建（activate 内多拍 await）
    expect((await rpc(vscode.state.panels[0], 'getConfig', {})).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));                                           // fire-and-forget 记账先入缓冲再催收
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    expect([...vscode.state.files.keys()].some((k) => k.includes('/.vv/'))).toBe(false);
  });

  it('审计臂①-b 开户即记账：rpc 各调一行 JSONL（verdict auto/六域字段全）', async () => {
    await boot({ folders: ['D:/b'], seed: { 'D:/b/.vv/project.json': '{"kind":"project"}', 'D:/b/top.v': 'module top; endmodule' } });
    await new Promise((r) => setTimeout(r, 5));
    const okRes = await rpc(vscode.state.panels[0], 'getAllBindings', { doc: 'top.v' });
    expect(okRes.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));                                           // 审计是 fire-and-forget：等它入缓冲
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const day = new Date().toISOString().slice(0, 10);
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/b/.vv/audit/trace-' + day + '.jsonl').path.toLowerCase())!);
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.verdict).toBe('auto');
    expect(last.ref).toBe('getAllBindings');
    expect(last.tool).toBe('host.getAllBindings');
    // R154 起两颗槽分开：`subject`＝**身份**（闸 3 grants 按它放行）、`channel`＝**端点**（闸 2 按它放行）。
    // 修前这条 RPC 账把通道名 "rpc" 塞进了 subject，而授权检查实际按 'ui' 算（dispatch 自己那句头注写着）
    // ⇒ 拿这份账反推"谁能调用"必然推出错的结论。
    expect(last.subject).toBe('ui');
    expect(last.channel).toBe('rpc');
    expect(String(last.configHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(last.traceId && last.ts && typeof last.ms === 'number').toBeTruthy();
  });

  it('审计臂②拒绝也进账：未登记（not-registered）与审批拒（denied）两格 verdict+note 齐，批准那格记 approved（⛔ auto）', async () => {
    await boot({ folders: ['D:/c'], seed: { 'D:/c/.vv/project.json': '{"kind":"project"}' } });
    await new Promise((r) => setTimeout(r, 5));
    const ghost = await rpc(vscode.state.panels[0], 'noSuchTool', {});
    expect(ghost.ok).toBe(false);
    const denied = await rpc(vscode.state.panels[0], 'importLegacyData', { items: [] });   // 没预批＝拒
    expect(denied.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    vscode.state.modalChoice = '允许';
    const passed = await rpc(vscode.state.panels[0], 'importLegacyData', { items: [] });
    expect(passed.ok).toBe(true);
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const day = new Date().toISOString().slice(0, 10);
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/c/.vv/audit/trace-' + day + '.jsonl').path.toLowerCase())!);
    const vs = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // 阶段三后 RPC 与树命令走**同一执行器** ⇒ 幽灵行记的是完整 id（`host.noSuchTool`），
    // ⛔ 旧的裸 method 名（那是 dispatch 自己那层壳的产物：它把 `host.` 前缀在门外抹掉，
    // 于是同一颗工具在账上有两种拼法，按 ref 聚合必然漏）。
    const g = vs.find((v: any) => v.ref === 'host.noSuchTool');
    expect(g?.verdict).toBe('not-registered');
    expect(g?.tool).toBeNull();                                  // ⛔ 存在的工具⛔ 进 `tool` 槽（账本形状定死 null，否则"没登记"被读成"调用过"）
    expect(String(g?.note)).toContain('API_NOT_REGISTERED');      // verdict 与 code 不是一一对应，note 必须自带机读码
    expect(vs.find((v: any) => v.ref === 'importLegacyData' && v.verdict === 'denied')).toBeTruthy();
    const ap = vs.find((v: any) => v.verdict === 'approved');                                 // 批准正臂＝approved（审批过≠auto）
    expect(ap).toBeTruthy();
    const dLine = vs.find((v: any) => v.verdict === 'denied');
    expect(dLine.note).toContain('API_NOT_APPROVED');
  });

  it('审计臂③隐私边界：argsDigest 只记形状（键名+类型+字节数，…NB 收尾）⛔ 整段电路一字不进账本', async () => {
    const big = 'x'.repeat(4000);
    await boot({ folders: ['D:/d'], seed: { 'D:/d/.vv/project.json': '{"kind":"project"}' } });
    await new Promise((r) => setTimeout(r, 5));
    const res = await rpc(vscode.state.panels[0], 'copyToSandbox', { files: [{ name: 'huge', content: big }] });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const day = new Date().toISOString().slice(0, 10);
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/d/.vv/audit/trace-' + day + '.jsonl').path.toLowerCase())!);
    const line = JSON.parse(raw.split('\n').filter(Boolean).pop()!);
    expect(line.tool).toBe('host.copyToSandbox');
    expect(line.argsDigest.length).toBeLessThanOrEqual(260);
    expect(/[0-9]+B$/.test(line.argsDigest)).toBe(true);                                  // 总字节标注（…NB）收尾在位
    expect(line.argsDigest).toContain('files:array');                                     // 键名+形状在账（排障价值）
    expect(raw).not.toContain('xxxxxx');                                                  // 电路内容零字符落地（脱敏红线）
  });

  it('审计臂④configHash 随契约热更新走：合同重合流后同方法记账的 hash 必换（⛔ 冻结旧 hash 骗账本）', async () => {
    const { loadProjectApiOverride } = await import('../../extension/src/apiSurface');
    await boot({ folders: ['D:/e'], seed: { 'D:/e/.vv/project.json': '{"kind":"project"}' } });
    await new Promise((r) => setTimeout(r, 5));                                            // activate 里那份 async 默认合并先用掉
    const ok1 = await rpc(vscode.state.panels[0], 'getAllBindings', { doc: 'x' });
    expect(ok1.ok).toBe(true);                                                             // 默认账：getAllBindings 放行
    vscode.seedText('D:/e/.vv/api.json', JSON.stringify({ tools: { 'host.getAllBindings': { surfaces: [] } } }));
    const rejects = await loadProjectApiOverride({ extensionUri: vscode.Uri.file(EXT_DIR) } as any);
    expect(rejects).toEqual([]);                                                           // 工程层合法收窄（端点裁光）
    const ok2 = await rpc(vscode.state.panels[0], 'getAllBindings', { doc: 'x' });
    expect(ok2.ok).toBe(false);                                                            // 收窄后同一方法＝拒
    await new Promise((r) => setTimeout(r, 5));
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const day = new Date().toISOString().slice(0, 10);
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/e/.vv/audit/trace-' + day + '.jsonl').path.toLowerCase())!);
    const vs = raw.split('\n').filter(Boolean).filter((l) => l.includes('"ref":"getAllBindings"')).map((l) => JSON.parse(l));
    expect(vs.length).toBe(2);
    expect(vs[1].verdict).toBe('surface-denied');
    expect(vs[1].note).toContain('API_SURFACE_DENIED');
    expect(vs[1].configHash).not.toBe(vs[0].configHash);                                   // 同账本行 hash 随生效契约变
  });

  it('协议落地①vv-bind schema：jsonValidation 挂载 + schema 与实现形状互相印证（⛔ 说书两张皮）', () => {    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    const jv = manifest.contributes.jsonValidation || [];
    const hit = jv.find((x: any) => x.fileMatch === '**/.verilogviz.json');
    expect(hit?.url).toBe('./schemas/vv-bind.schema.json');
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/schemas/vv-bind.schema.json'), 'utf8'));
    expect(String(schema.$schema)).toContain('2020-12');
    const keyRe = new RegExp(schema.properties.bindings.propertyNames.pattern);
    const valRe = new RegExp(schema.properties.bindings.additionalProperties.pattern);
    // 键两形态（实现同款）：裸键、宿主::实例 前缀键；非法拒
    expect(keyRe.test('counter')).toBe(true);
    expect(keyRe.test('sub/ctrl.djs::adder')).toBe(true);
    expect(keyRe.test('a:b::c::d')).toBe(false);
    // 值：带真扩展名的相对路径（../ 越层可、无扩展/错扩展拒——normalizePartName 的读侧镜像）
    expect(valRe.test('../shared/x.djs')).toBe(true);
    expect(valRe.test('impl/alu.v')).toBe(true);
    expect(valRe.test('noext')).toBe(false);
    // 顶层白名单 = writeMeta 现形 ({circuits,bindings}) + 协议可选头 的并集；野字段拒
    const topRe = new RegExp(schema.propertyNames.pattern);
    for (const k of ['circuits', 'bindings', 'schemaVersion', 'kind', '$schema', 'meta']) expect(topRe.test(k)).toBe(true);
    expect(topRe.test('migrations') || topRe.test('defaults')).toBe(false);
  });

  it('协议落地②字段回环保留：手编 $schema/meta/私货在固化·改名·M7 任一写回后⛔ 被吞', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({
        $schema: './schemas/vv-bind.schema.json', schemaVersion: '0.3.1', meta: { owner: 'lin' },
        circuits: [], bindings: { counter: 'lib/counter.djs' },
      }),
      'D:/p/lib/top.djs': '{"cells":[{"type":"Subcircuit","celltype":"mux"}]}',
      'D:/p/lib/counter.djs': '{"cells":[]}', 'D:/p/lib/mux.djs': '{"cells":[]}',
    } });
    // 通道一：写全/固化（bindParts/completeBindings 落**文档所在目录层**表——R137 定案）
    await vscode.commands.executeCommand('verilogViz.completeBindings', vscode.Uri.file('D:/p/lib/top.djs'));
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(meta.$schema).toBe('./schemas/vv-bind.schema.json');      // 根表头⛔ 被动过＝完好
    expect(meta.schemaVersion).toBe('0.3.1');
    expect(meta.meta).toEqual({ owner: 'lin' });
    const libMeta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/lib/.verilogviz.json').path.toLowerCase())!));
    expect(libMeta.bindings.mux).toBe('mux.djs');                    // 写全成行，落 lib 层表（值相对本层）
    expect(libMeta.circuits).toEqual([]);                            // ensure 新表带缺省，正事之外⛔ 臆造
    // 通道二：M7 清扫（表含脏值 ⇒ 写回，头部仍在且键序 $schema 在前）
    fs_noop();
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ $schema: 'x', meta: { keep: 1 }, circuits: [], bindings: { counter: 'parts/counter.djs.djs' } }),
      'D:/p/parts/counter.djs': '{"cells":[]}',
    } });
    await new Promise((r) => setTimeout(r, 20));
    const raw = new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!);
    const m2 = JSON.parse(raw);
    expect(m2).toEqual({ $schema: 'x', meta: { keep: 1 }, circuits: [], bindings: { counter: 'parts/counter.djs' } });
    expect(raw.indexOf('$schema')).toBeLessThan(raw.indexOf('circuits'));   // 序列化惯例：头在前
  });

  function fs_noop() { /* 前通道与后通道共用桩内存盘，无需额外准备 */ }
});

describe('R144 质检轮：记录即权威 + 自动兜底显形 + 右键/新建补缺', () => {
  const compilePush = (): any => {
    const p = vscode.state.panels[0];
    return [...(p.messageLog || [])].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
  };

  it('编译侧录入即权威：绑定把 adder 指向 custom 文件 ⇒ 闭包用之，⛔ 另一颗同名旧文件', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/legacy/adder.v': 'module adder; endmodule // 旧同名',
      'D:/p/custom/adder_impl.v': 'module adder; endmodule // 录入的',
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'custom/adder_impl.v' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const names = (compilePush()?.files || []).map((f: any) => f.name);
    expect(names).toContain('custom/adder_impl.v');
    expect(names).not.toContain('legacy/adder.v');   // 录了就是要用它——⛔ 悄悄回落同名扫描
  });

  it('录入解不到＝红字报错且⛔ 回落兜底（"绑了没反应"终结）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/legacy/adder.v': 'module adder; endmodule',
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'custom/missing.v' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job = compilePush();
    expect((job?.files || []).map((f: any) => f.name)).not.toContain('legacy/adder.v');   // ⛔ 拿同名旧档顶包
    expect(vscode.state.errorMessages.some((m: string) => m.includes('按记录取'))).toBe(true);
  });

  it('固化自动绑定：自动命中的未录入实例写进目录表；已录入⛔ 覆写', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/lib/top.djs': '{"cells":[{"type":"Subcircuit","celltype":"counter"},{"type":"Subcircuit","celltype":"adder"}]}',
      'D:/p/lib/counter.djs': '{"cells":[]}',
      'D:/p/lib/adder.djs': '{"cells":[]}',
      'D:/p/lib/.verilogviz.json': JSON.stringify({ circuits: [], bindings: { adder: 'add.djs' } }),   // adder 已录入
    } });
    await vscode.commands.executeCommand('verilogViz.materializeBindings', vscode.Uri.file('D:/p/lib/top.djs'));
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/lib/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings).toEqual({ adder: 'add.djs', counter: 'counter.djs' });   // 只固化未录入的
    expect(vscode.state.infoMessages.some((m: string) => m.includes('已固化 1 条'))).toBe(true);
  });

  it('目录右键「在此新建」：文件落进 right-click 目录，并保证该层有表', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/sub/keep.v': 'module keep; endmodule' } });
    vscode.state.inputBoxResult = '新电路.djs';
    await vscode.commands.executeCommand('verilogViz.newSandboxFile', { resourceUri: vscode.Uri.file('D:/p/sub') });
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/sub/新电路.djs').path.toLowerCase())).toBe(true);
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/sub/.verilogviz.json').path.toLowerCase())).toBe(true);
  });

  it('复制文件夹：fs.copy ⛔ 删源（旧桩的假语义回归钉）+ 副本含 .djs 才建表', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/parts/a.djs': '{"cells":[]}' } });
    await vscode.commands.executeCommand('verilogViz.duplicateFolder', vscode.Uri.file('D:/p/parts'));
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/parts/a.djs').path.toLowerCase())).toBe(true);            // 源还在
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/parts 副本/a.djs').path.toLowerCase())).toBe(true);        // 副本也在了
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/parts 副本/.verilogviz.json').path.toLowerCase())).toBe(true);
  });

  it('X19（R153 裁决）：复制只有 Verilog 源码的目录 ⇒ 副本里⛔ 凭空多出配置表（含子层）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/rtl/dec.v': 'module dec; endmodule',
      'D:/p/rtl/sub/mux.v': 'module mux; endmodule',
    } });
    await vscode.commands.executeCommand('verilogViz.duplicateFolder', vscode.Uri.file('D:/p/rtl'));
    // 正件先落：递归副本真把子层文件带过去（⛔ 否则"没建表"只是因为整颗副本是空的）
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/rtl 副本/dec.v').path.toLowerCase())).toBe(true);
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/rtl 副本/sub/mux.v').path.toLowerCase())).toBe(true);
    // 禁项：整棵树里一颗 .djs 都没有 ⇒ 根层与子层都⛔ 预铺空表（用户的仓库⛔ 被我们塞配置文件）
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/rtl 副本/.verilogviz.json').path.toLowerCase())).toBe(false);
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/rtl 副本/sub/.verilogviz.json').path.toLowerCase())).toBe(false);
  });

  it('导入文件：多选拷进目录、同名 (n) 让位、.djs 触发建表', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/lib/top.djs': '{"cells":[]}',
      'C:/elsewhere/imp.djs': '{"cells":[]}',                       // 真源存在（fs.copy 不凭空造）
    } });
    (vscode.state as any).openDialogResult = [vscode.Uri.file('C:/elsewhere/imp.djs'), vscode.Uri.file('C:/elsewhere/imp.djs')];
    await vscode.commands.executeCommand('verilogViz.importFiles', { resourceUri: vscode.Uri.file('D:/p/lib') });
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/lib/imp.djs').path.toLowerCase())).toBe(true);
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/lib/imp (2).djs').path.toLowerCase())).toBe(true);
    expect(vscode.state.infoMessages.some((m: string) => m.includes('已导入 2'))).toBe(true);
  });

  it('copyToSandbox 撞名即固化：**子部件**改名当场写进目标目录表（⛔ 实例继续暗指旧定义）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top/alu_core.djs': '{"cells":[]}' } });
    const res = await rpc(vscode.state.panels[0], 'copyToSandbox', {
      files: [
        { name: 'top/my_main', content: '{"cells":[1]}' },      // 本批第一颗＝主电路（不撞名）
        { name: 'top/alu_core', content: '{"cells":[9]}' },     // 子部件撞名 ⇒ 固化
      ],
    });
    expect(res.data).toEqual(['top/my_main.djs', 'top/alu_core (2).djs']);
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/top/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings.alu_core).toBe('alu_core (2).djs');
    expect(meta.bindings.my_main).toBeUndefined();
  });

  it('主电路（本批第一颗）改名⛔ 进绑定表（实例不引用顶层名，录了＝死条目）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const res = await rpc(vscode.state.panels[0], 'copyToSandbox', {
      files: [{ name: 'main', content: '{"cells":[1]}' }, { name: 'sub/part_a', content: '{"cells":[]}' }],
    });
    expect(res.data[0]).toBe('main (2).djs');
    const tables = [...vscode.state.files.keys()].filter((k) => k.endsWith('.verilogviz.json'));
    for (const k of tables) {
      const parsed = JSON.parse(new TextDecoder().decode(vscode.state.files.get(k)!));
      expect(parsed.bindings.main).toBeUndefined();     // ⛔ 顶层撞名不进表
    }
    // M5 反转 R144：复制到沙盒＝显式绑定（未撞名的子部件也逐条录，⛔ 再依赖同名兜底）
    expect(JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/sub/.verilogviz.json').path.toLowerCase())!)).bindings).toEqual({ part_a: 'part_a.djs' });
  });

  it('M5 复制到沙盒即显式绑定：每个子部件（含未撞名）逐条写目录表，主电路⛔ 进表', async () => {
    await boot({ folders: ['D:/p'], seed: {} });
    const res = await rpc(vscode.state.panels[0], 'copyToSandbox', {
      files: [
        { name: 'blk/blk_sandbox', content: '{"cells":[]}' },   // 本批第一颗＝主电路
        { name: 'blk/adder', content: '{"cells":[]}' },
        { name: 'blk/mux', content: '{"cells":[]}' },
      ],
    });
    expect(res.ok).toBe(true);
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/blk/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings).toEqual({ adder: 'adder.djs', mux: 'mux.djs' });
    expect(meta.bindings.blk_sandbox).toBeUndefined();
  });

  it('M7 归一清扫：activate 后台裁双后缀盘名 + 表值/前缀键归一写回；干净盘再启静默（幂等）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/parts/fsm.djs.djs': '{"cells":[]}',
      'D:/p/main.djs': '{"cells":[]}',
      'D:/p/parts/.verilogviz.json': JSON.stringify({ circuits: [], bindings: { counter: 'fsm.djs.djs', 'fsm.djs.djs::adder': 'alt_v2.djs.djs' } }),
    } });
    await new Promise((r) => setTimeout(r, 20));                      // fire-and-forget 清扫落账
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/parts/fsm.djs.djs').path.toLowerCase())).toBe(false);
    expect(vscode.state.files.has(vscode.Uri.file('D:/p/parts/fsm.djs').path.toLowerCase())).toBe(true);
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/parts/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings).toEqual({ counter: 'fsm.djs', 'fsm.djs::adder': 'alt_v2.djs' });   // 值裁尾＋前缀键宿主随迁
    expect(vscode.state.infoMessages.some((m: string) => m.includes('绑定盘归一'))).toBe(true);
    // 幂等：干净世界再 activate（boot 会重置流水账）⇒ ⛔ 出现任何清扫记录
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/parts/fsm.djs': '{"cells":[]}',
      'D:/p/main.djs': '{"cells":[]}',
      'D:/p/parts/.verilogviz.json': JSON.stringify({ circuits: [], bindings: { counter: 'fsm.djs', 'fsm.djs::adder': 'alt_v2.djs' } }),
    } });
    await new Promise((r) => setTimeout(r, 20));
    expect(vscode.state.infoMessages.filter((m: string) => m.includes('绑定盘归一'))).toHaveLength(0);
  });

  it('手编 `.verilogviz.json` 保存 ⇒ 编译面板即重算（⛔ 画布即时生效、编译要重按 F5 的两面）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder a1(); endmodule',
      'D:/p/lib/adder.v': 'module adder; endmodule',
      'D:/p/.verilogviz.json': '{"circuits":[],"bindings":{}}',
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const before = (vscode.state.panels[0].messageLog || []).filter((m: any) => m.op === 'compile').length;
    // 用户手编表：把 adder 改绑 custom 实现
    vscode.seedText('D:/p/.verilogviz.json', JSON.stringify({ bindings: { adder: 'custom/alu.v' } }));
    vscode.seedText('D:/p/custom/alu.v', 'module adder; endmodule  // 手编指向');
    const metaDoc = await vscode.workspace.openTextDocument(vscode.Uri.file('D:/p/.verilogviz.json'));
    for (const l of [...vscode.state.saveListeners]) l(metaDoc);
    await new Promise((r) => setTimeout(r, 0));
    const pushes = (vscode.state.panels[0].messageLog || []).filter((m: any) => m.op === 'compile');
    expect(pushes.length).toBeGreaterThan(before);
    const names = (pushes[pushes.length - 1]?.files || []).map((f: any) => f.name);
    expect(names).toContain('custom/alu.v');
    expect(names).not.toContain('lib/adder.v');          // 手编权威当场赢过同名旧扫描
  });
});

describe('R145 多层电路绑定表达（`宿主文档::实例名` 前缀键——手编专属精控）', () => {
  const compilePush = (): any => {
    const p = vscode.state.panels[0];
    return [...(p.messageLog || [])].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
  };

  it('编译：前缀键只管那一层的例化（ctrl.v 层的 adder 换实现，顶层同名链路不动）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; ctrl u1(); endmodule',
      'D:/p/ctrl.v': 'module ctrl; adder u2(); endmodule',
      'D:/p/adder.v': 'module adder; endmodule',                 // 裸兜底同名（本例⛔ 被用到）
      'D:/p/impl/adder_v2.v': 'module adder; endmodule',         // 前缀记录的定向实现
      // R152：ctrl 亦须显式绑定（⛔ 同名兜底）；ctrl 层的 adder 用前缀键定向。
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { ctrl: 'ctrl.v', 'ctrl.v::adder': 'impl/adder_v2.v' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const p = [...vscode.state.panels[0].messageLog].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
    const names = (p?.files || []).map((f: any) => f.name);
    expect(names).toContain('ctrl.v');
    expect(names).toContain('impl/adder_v2.v');                 // ctrl.v 层的 adder 照前缀记录取
    expect(names).not.toContain('adder.v');                     // ⛔ 被顶层裸扫描顶包
  });

  it('链合并输出：层表里前缀按本层目录折回根相对（`ctrl.v::adder`@sub ⇒ `sub/ctrl.v::adder`）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/sub/top.v': 'module top; endmodule',
      'D:/p/sub/.verilogviz.json': JSON.stringify({ bindings: { 'ctrl.v::adder': '../impl/adder_v2.v' } }),
    } });
    const res = await rpc(vscode.state.panels[0], 'getAllBindings', { doc: 'sub/top.v' });
    expect(res.data).toEqual({ 'sub/ctrl.v::adder': 'impl/adder_v2.v' });
  });

  it('宿主文档改名 ⇒ 前缀键同步迁移（⛔ 精控悬空在旧名上）；删除宿主 ⇒ 其前缀键同删', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { 'parts/ctrl.djs::adder': 'alt/adder_impl.djs' } }),
      'D:/p/parts/ctrl.djs': '{"cells":[]}', 'D:/p/alt/adder_impl.djs': '{"cells":[]}',
    } });
    vscode.state.inputBoxResult = 'ctrl_v2.djs';
    await vscode.commands.executeCommand('verilogViz.renameFile', vscode.Uri.file('D:/p/parts/ctrl.djs'));
    const root = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(root.bindings['parts/ctrl_v2.djs::adder']).toBe('alt/adder_impl.djs');   // 键迁移，值不动
    expect(root.bindings['parts/ctrl.djs::adder']).toBeUndefined();
    vscode.state.modalChoice = '删除';
    await vscode.commands.executeCommand('verilogViz.deleteFile', vscode.Uri.file('D:/p/parts/ctrl_v2.djs'));
    const after = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(after.bindings).toEqual({});                                             // 宿主删除 ⇒ 精控同清
  });

  it('.v 绑定全链（桩收紧成员的证物）：面板里选到＝录上 ⇒ 编译闭包照记录走', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder a1(); endmodule',
      'D:/p/alt/alt_impl.v': 'module adder; endmodule',    // 要绑的真实现
      'D:/p/adder.v': 'module adder; endmodule',           // 自动扫描的旧同名（让位给记录）
    } });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/top.v'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { adder: 'alt/alt_impl.v' } });
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings.adder).toBe('alt/alt_impl.v');    // 串过桩的成员校验＝二级清单确是 Verilog 那颗（⛔ .djs 清单）
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const names = (compilePush()?.files || []).map((f: any) => f.name);
    expect(names).toContain('alt/alt_impl.v');
    expect(names).not.toContain('adder.v');                // 记录赢了同名扫描
  });
});

describe('R146/R147 绑定完整性（配置不齐＝可见、可一键写全、可严格拦截）', () => {
  const metaOf = (p: string) => {
    const b = vscode.state.files.get(vscode.Uri.file(p).path.toLowerCase());
    return b ? JSON.parse(new TextDecoder().decode(b)) : undefined;
  };

  it('audit 命令：未录入的同名兜底当场点名，「写全配置」动作直接落表', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.djs': '{"cells":[{"type":"Subcircuit","celltype":"counter"},{"type":"Subcircuit","celltype":"adder"}]}',
      'D:/p/parts/counter.djs': '{"cells":[]}',
      'D:/p/adder.djs': '{"cells":[]}',
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: [], bindings: { adder: 'adder.djs' } }),   // adder 已录
    } });
    vscode.state.modalChoice = '写全配置';
    await vscode.commands.executeCommand('verilogViz.auditBindings', vscode.Uri.file('D:/p/top.djs'));
    expect(vscode.state.warnMessages.filter((m: string) => m.includes('1 个子部件实例')).length).toBe(1);   // 只剩 counter 未录
    const meta = metaOf('D:/p/.verilogviz.json');
    expect(meta.bindings).toEqual({ adder: 'adder.djs', counter: 'parts/counter.djs' });                   // 写全（值根相对→按层相对由表逻辑处理）
    expect(metaOf('D:/p/parts/.verilogviz.json')).toBeUndefined();                                          // ⛔ 往部件所在目录乱建
  });

  it('全层 BFS：孙层实例也进账（main→ctrl→adder 两层都点名）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/sub/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"ctrl"}]}',
      'D:/p/sub/ctrl.djs': '{"cells":[{"type":"Subcircuit","celltype":"adder"}]}',
      'D:/p/sub/adder.djs': '{"cells":[]}',
    } });
    const { collectInstanceHits } = await import('../../extension/src/sandboxFiles');
    const hits = await collectInstanceHits({ extensions: {} } as any, 'sub/main.djs');
    expect(hits.map((h: any) => `${h.ctx}::${h.name}`).sort()).toEqual(['sub/ctrl.djs::adder', 'sub/main.djs::ctrl']);
    expect(hits.find((h: any) => h.name === 'adder')!.file).toBe('sub/adder.djs');
  });

  it('写全规则：同实例名跨层命中不同文件 ⇒ 全部前缀键（裸键会越权顶别层）；单一命中才裸', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const { completeFromHits } = await import('../../extension/src/sandboxFiles');
    const written = await completeFromHits({ extensions: {} } as any, 'main.djs', [
      { ctx: 'main.djs', name: 'adder', file: 'root_adder.djs' },
      { ctx: 'sub/ctrl.djs', name: 'adder', file: 'sub/adder.djs' },
      { ctx: 'main.djs', name: 'mux', file: 'lib/mux.djs' },
    ]);
    expect(written.length).toBe(3);
    const meta = metaOf('D:/p/.verilogviz.json');
    expect(meta.bindings['main.djs::adder']).toBe('root_adder.djs');
    expect(meta.bindings['sub/ctrl.djs::adder']).toBe('sub/adder.djs');
    expect(meta.bindings.mux).toBe('lib/mux.djs');          // 唯一宿主+唯一文件 ⇒ 裸键够用
    expect(meta.bindings.adder).toBeUndefined();            // ⛔ 冲突项留裸键＝越权
  });

  it('R152 默认绑定权威：未录入实例 ⇒ 红字 + 同名兜底断供（无须 policy）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder a1(); endmodule',
      'D:/p/adder.v': 'module adder; endmodule',                 // 同名旧档：⛔ 再自动兜底
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: [], bindings: {} }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job2 = [...vscode.state.panels[0].messageLog].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
    expect((job2?.files || []).map((f: any) => f.name)).not.toContain('adder.v');     // 未录＝断供
    expect(vscode.state.errorMessages.some((m: string) => m.includes('未录入绑定配置'))).toBe(true);
  });

  it('R152 默认绑定权威：录入后同名旧档让位、绑定文件入闭包（⛔ 红字）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder a1(); endmodule',
      'D:/p/adder.v': 'module adder; endmodule',                 // 同名旧档
      'D:/p/alt/adder_impl.v': 'module adder; endmodule',        // 录的正主
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'alt/adder_impl.v' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job3 = [...vscode.state.panels[0].messageLog].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
    const names = (job3?.files || []).map((f: any) => f.name);
    expect(names).toContain('alt/adder_impl.v');
    expect(names).not.toContain('adder.v');
    expect(vscode.state.errorMessages.some((m: string) => m.includes('未录入绑定配置'))).toBe(false);
  });

  it('R152 退役底账：filesWebview 模块⛔ 再有实体；watcher 增删 ⇒ 六树刷新总闸汇报无死链', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/top.v': 'module top; endmodule', 'D:/p/a.djs': '{"cells":[]}' } });
    let threw = false;
    const ghost = ['../../extension/src/', 'filesWebview'].join('');
    try { await import(/* webpackIgnore: true */ ghost); } catch { threw = true; }
    expect(threw).toBe(true);                                                     // 模块已删（meeting 即回归钉）
    // watcher：新建 .v ⇒ codeFiles 树立刻张榜
    const code = vscode.state.treeProviders['verilogViz.codeFiles'];
    expect((await code.getChildren()).length).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    await vscode.workspace.fs.writeFile(vscode.Uri.file('D:/p/lib/newblk.v'), new TextEncoder().encode('module newblk; endmodule'));
    await new Promise((r) => setTimeout(r, 0));
    const root2 = (await code.getChildren()) as any[];
    expect(root2.map((n: any) => n.label)).toEqual(['lib', 'top.v']);
    const kids = (await code.getChildren(root2[0])) as any[];
    expect(kids.map((n: any) => n.label)).toEqual(['newblk.v']);
  });

  it('画布「写全配置」按钮：宿主落表＋回执 bindingsWritten，webview 端 ⛔ remount 也⛔ 吞在编辑', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.djs': '{"cells":[{"type":"Subcircuit","celltype":"counter"}]}',
      'D:/p/parts/counter.djs': '{"cells":[]}',
    } });
    const reg = vscode.state.customEditorProviders['verilogViz.doc'];
    const doc = await reg.provider.openCustomDocument(vscode.Uri.file('D:/p/top.djs'));
    const panel = vscode.window.createWebviewPanel('docT', 'x', 1, {});
    await reg.provider.resolveCustomEditor(doc, panel);
    panel.fired[0]({ vvh: 'doc', op: 'ready' });
    await new Promise((r) => setTimeout(r, 0));
    panel.fired[0]({ vvh: 'doc', op: 'completeBindings', docName: 'top.djs', hits: [{ ctx: 'top.djs', name: 'counter', file: 'parts/counter.djs' }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(metaOf('D:/p/.verilogviz.json').bindings).toEqual({ counter: 'parts/counter.djs' });
    expect(panel.messageLog.some((m: any) => m.vvh === 'doc' && m.op === 'bindingsWritten')).toBe(true);
    // 回执＝"写完"通知；⛔ 伴随 revert/init 重推（remount 吞编辑那一族被这条路堵死后门）
    expect(panel.messageLog.filter((m: any) => m.op === 'revert' && m.vvh === 'doc')).toHaveLength(0);
  });
});

describe('R152 / M2：`.djs` 部件绑定 ⇒ 转 Verilog 入编译闭包', () => {
  const compilePush = (): any => {
    const p = vscode.state.panels[0];
    return [...(p.messageLog || [])].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
  };
  const wire = (id: string, sId: string, sPort: string, tId: string, tPort: string) =>
    ({ id, isLink: true, bits: 1, source: { id: sId, port: sPort }, target: { id: tId, port: tPort } });
  const AND_PART = JSON.stringify({ cells: [
    { id: 'i1', type: 'Input', net: 'a' }, { id: 'i2', type: 'Input', net: 'b' }, { id: 'o1', type: 'Output', net: 's' },
    { id: 'g', type: 'And' },
    wire('w1', 'i1', 'out', 'g', 'in1'), wire('w2', 'i2', 'out', 'g', 'in2'), wire('w3', 'g', 'out', 'o1', 'in'),
  ] });

  it('.djs 绑定 ⇒ 闭包含合成 module（module/端口齐）+ ⛔ 红字', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(.a(p), .b(q), .s(r)); endmodule',
      'D:/p/parts/adder.djs': AND_PART,
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'parts/adder.djs' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job = compilePush();
    const synth = (job?.files || []).find((f: any) => f.name === 'parts/adder.adder.v');
    expect(synth).toBeTruthy();
    expect(synth.content).toContain('module adder');
    expect(synth.content).toContain('input  a');
    expect(synth.content).toContain('output s');
    expect(job.bindingErrors).toBeUndefined();
    expect(vscode.state.errorMessages.some((m: string) => m.includes('未录入绑定配置'))).toBe(false);
  });

  it('.djs 部件含不支持器件 ⇒ 硬报错且⛔ 入闭包（不静默出错误电路）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/parts/adder.djs': JSON.stringify({ cells: [
        { id: 'i1', type: 'Input', net: 'a' }, { id: 'o1', type: 'Output', net: 's' }, { id: 'mem', type: 'Memory' },
      ] }),
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'parts/adder.djs' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job = compilePush();
    expect((job?.files || []).map((f: any) => f.name)).not.toContain('parts/adder.adder.v');
    expect(vscode.state.errorMessages.some((m: string) => m.includes('Memory'))).toBe(true);
  });

  it('递归：`.djs` 部件的子 Subcircuit 按**部件所在目录**的绑定表再展开', async () => {
    const muxGraph = { cells: [
      { type: 'Input', net: 'sel' }, { type: 'Input', net: 'd' }, { type: 'Output', net: 'o' },
    ] };
    const adderTop = JSON.stringify({ cells: [
      { id: 'i1', type: 'Input', net: 'a' }, { id: 'i2', type: 'Input', net: 'b' }, { id: 'o1', type: 'Output', net: 'y' },
      { id: 'sc', type: 'Subcircuit', celltype: 'mux', subcircuitGraph: muxGraph },
      wire('w1', 'i1', 'out', 'sc', 'sel'), wire('w2', 'i2', 'out', 'sc', 'd'), wire('w3', 'sc', 'o', 'o1', 'in'),
    ] });
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/parts/adder.djs': adderTop,
      'D:/p/parts/mux.djs': AND_PART,
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'parts/adder.djs' } }),
      'D:/p/parts/.verilogviz.json': JSON.stringify({ bindings: { mux: 'mux.djs' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    const job = compilePush();
    const names = (job?.files || []).map((f: any) => f.name);
    expect(names).toContain('parts/adder.adder.v');
    expect(names).toContain('parts/mux.mux.v');
    const mux = (job?.files || []).find((f: any) => f.name === 'parts/mux.mux.v');
    expect(mux.content).toContain('module mux');
  });
});

describe('诊断锚点 + 写前校验（2026-10-17 用户五连投诉：报错落部件行；假成功绑定拦下）', () => {
  const compilePush = (): any => {
    const p = vscode.state.panels[0];
    return [...(p.messageLog || [])].reverse().find((m: any) => m.vvh === 'push' && m.op === 'compile');
  };

  it('parseVerilogInstancesWithLines：注释等长掩码 ⛔ 漂移行号；实例名与行号同账', async () => {
    const { parseVerilogInstancesWithLines } = await import('../../extension/src/verilogParseLite');
    const src = [
      '// adder fake();            ← 行注释横跨第 1 行',
      '/* wire not_real(1); */     ← 块注释（换行必须保留）',
      'module top;',
      '  adder a1();',
      'endmodule',
    ].join('\n');
    const hits = parseVerilogInstancesWithLines(src);
    expect(hits.map((h) => h.name)).toEqual(['adder']);
    expect(hits[0].line).toBe(4);   // 实例在源文件第 4 行（前两行被注释占掉但行数原样保留）
  });

  it('closureOf 坏记录 ⇒ bindingAnchors 与 bindingErrors 逐条平行，锚在例化行（⛔ 全糊文件首行）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': [
        'module top;',
        '',
        '  // 注释也来一行，行号必须如实',
        '  counter u1();',
        '  adder  a2();',
        'endmodule',
      ].join('\n'),
      'D:/p/r50_counter.v': 'module r50_counter; endmodule',   // 真机惨案：记录的文件里没有 counter
      'D:/p/lib/adder.v': 'module adder; endmodule',
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { counter: 'r50_counter.v', adder: 'lib/adder.v' } }),
    } });
    await vscode.commands.executeCommand('verilogViz.compileAndShow', vscode.Uri.file('D:/p/top.v'));
    await new Promise((r) => setTimeout(r, 0));
    const job = compilePush();
    expect((job.bindingErrors || []).some((s: string) => s.includes('BINDING_UNRESOLVED_RECORD') && s.includes('r50_counter'))).toBe(true);
    expect((job.bindingErrors || []).some((s: string) => s.includes('定义的是'))).toBe(true);   // 文案补"该文件内定义的是：r50_counter"
    const anchors = job.bindingAnchors;
    expect(Array.isArray(anchors) && anchors.length === job.bindingErrors.length).toBe(true);   // 平行数组硬不变量
    const bad = anchors.find((a: any) => (job.bindingErrors[anchors.indexOf(a)] || '').includes('BINDING_UNRESOLVED_RECORD'));
    expect(bad.file).toBe('top.v');
    expect(bad.line).toBe(4);       // counter 例化行（不是入口文件首行）
  });

  it('绑定面板写前校验：记录里的 .v 没这个模块 ⇒ saveError 拒落表 + 面板拿到错误清单', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/r50_counter.v': 'module r50_counter; endmodule',   // ⛔ 不含 adder——真机惨案形状
      'D:/p/lib/adder.v': 'module adder; endmodule',
      'D:/p/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"counter"}]}',
      'D:/p/parts/adder.djs': '{"cells":[]}',
    } });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/main.djs'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { counter: 'r50_counter.v' } });
    const err = panel.messageLog.find((m: any) => m.vvh === 'binding' && m.op === 'saveError');
    expect(err).toBeTruthy();
    expect(err.errors.join('')).toContain('r50_counter');
    const meta = vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase());
    expect(meta).toBeUndefined();                            // ⛔ 半吊子记录进表
  });

  it('绑定面板写前校验：.djs 目标文件缺失同样拒落；产物齐的正常保存照写', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder u1(); endmodule',
      'D:/p/lib/adder.v': 'module adder; endmodule',
      'D:/p/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"counter"}]}',
      'D:/p/parts/adder.djs': '{"cells":[]}',
    } });
    await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.file('D:/p/main.djs'));
    const panel = vscode.state.panels.find((p: any) => p.viewType === 'verilogViz.binding')!;
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { counter: 'ghost/missing.djs' } });
    expect(panel.messageLog.find((m: any) => m.vvh === 'binding' && m.op === 'saveError')).toBeTruthy();
    expect(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())).toBeUndefined();
    // 正常路径回归：目标存在 ⇒ 照写（校验不该拦合格记录）
    await panel.fired[0]({ vvh: 'binding', op: 'save', changes: { counter: 'parts/adder.djs' } });
    const meta = JSON.parse(new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file('D:/p/.verilogviz.json').path.toLowerCase())!));
    expect(meta.bindings.counter).toBe('parts/adder.djs');
  });
});

describe('文件系统批次B（2026-10-17 审查后落）：G1 三路共源 + C9/C10/C11/D7 + F 族拖拽 + H1 角标', () => {
  const readMetaFile = (p: string) => {
    const b = vscode.state.files.get(vscode.Uri.file(p).path.toLowerCase());
    return b ? JSON.parse(new TextDecoder().decode(b)) : undefined;
  };
  const treeViewRec = (id: string): any => vscode.state.treeViews.find((t: any) => t.id === id);
  const SANDBOX_MIME = 'application/vnd.code.tree.verilogviz.sandboxfiles';

  it('G1 文件路（审查缺陷 #4）：跨目录表层的 `../` 引用随「移动到」随迁（旧实现只扫祖先链必漏）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: ['fsm.djs'], bindings: { fsm: 'fsm.djs' } }),
      'D:/p/lib/.verilogviz.json': JSON.stringify({ bindings: { fsm: '../fsm.djs' } }),   // lib 表不在 fsm 的祖先链上
      'D:/p/fsm.djs': '{"cells":[]}',
      'D:/p/gates/.keep': '',
    } });
    vscode.state.quickPickResult = { label: 'gates', dir: { rel: 'gates', uri: vscode.Uri.file('D:/p/gates') } };
    await vscode.commands.executeCommand('verilogViz.moveTo', vscode.Uri.file('D:/p/fsm.djs'));
    expect(has('D:/p/gates/fsm.djs')).toBe(true);
    const root = readMetaFile('D:/p/.verilogviz.json');
    expect(root.circuits).toEqual(['gates/fsm.djs']);
    expect(root.bindings).toEqual({ fsm: 'gates/fsm.djs' });
    // 旧实现漏的正是这条：lib 表的 `../fsm.djs` 随迁成 `../gates/fsm.djs`
    expect(readMetaFile('D:/p/lib/.verilogviz.json').bindings).toEqual({ fsm: '../gates/fsm.djs' });
  });

  it('G1 目录路（D5/X3）：目录改名 ⇒ 全表层前缀族群随迁；随盘搬走的表⛔ 二次改写', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: ['parts/counter.djs'], bindings: { counter: 'parts/counter.djs', outside: 'other.djs' } }),
      'D:/p/parts/.verilogviz.json': JSON.stringify({ bindings: { a: 'counter.djs', up: '../main.djs' } }),
      'D:/p/parts/counter.djs': '{"cells":[]}',
      'D:/p/main.djs': '{"cells":[]}',
      'D:/p/other.djs': '{"cells":[]}',
    } });
    vscode.state.inputBoxResult = 'gates';
    await vscode.commands.executeCommand('verilogViz.renameFile', vscode.Uri.file('D:/p/parts'));
    expect(has('D:/p/gates/counter.djs')).toBe(true);
    const root = readMetaFile('D:/p/.verilogviz.json');
    expect(root.circuits).toEqual(['gates/counter.djs']);
    expect(root.bindings).toEqual({ counter: 'gates/counter.djs', outside: 'other.djs' });
    // 随盘搬走的表内容原样（相对书写天然仍正确；⛔ 被 G1 二次改写丢协议头/私货）
    expect(readMetaFile('D:/p/gates/.verilogviz.json').bindings).toEqual({ a: 'counter.djs', up: '../main.djs' });
  });

  it('G1 目录路（D4）：删目录 ⇒ 前缀族群的值/根表 circuits 全清（⛔ 悬空引用）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: ['parts/counter.djs'], bindings: { counter: 'parts/counter.djs', other: 'main.djs' } }),
      'D:/p/parts/counter.djs': '{"cells":[]}',
      'D:/p/main.djs': '{"cells":[]}',
    } });
    vscode.state.modalChoice = '删除';
    await vscode.commands.executeCommand('verilogViz.deleteFile', vscode.Uri.file('D:/p/parts'));
    const root = readMetaFile('D:/p/.verilogviz.json');
    expect(root.circuits).toEqual([]);
    expect(root.bindings).toEqual({ other: 'main.djs' });
  });

  it('moveToFile 防自环与原地 no-op：目录⛔ 进自己子树；同目录"移动"⛔ 白跑 (n) 顺延', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/parts/counter.djs': '{"cells":[]}',
      'D:/p/parts/sub/inner.djs': '{"cells":[]}',
    } });
    // 自环：parts → parts/sub
    vscode.state.quickPickResult = { label: 'parts/sub', dir: { rel: 'parts/sub', uri: vscode.Uri.file('D:/p/parts/sub') } };
    await vscode.commands.executeCommand('verilogViz.moveTo', vscode.Uri.file('D:/p/parts'));
    expect(vscode.state.errorMessages.some((m: string) => m.includes('子目录'))).toBe(true);
    expect(has('D:/p/parts/counter.djs')).toBe(true);
    // 原地：counter.djs → parts（它已在的目录）
    vscode.state.quickPickResult = { label: 'parts', dir: { rel: 'parts', uri: vscode.Uri.file('D:/p/parts') } };
    await vscode.commands.executeCommand('verilogViz.moveTo', vscode.Uri.file('D:/p/parts/counter.djs'));
    expect(has('D:/p/parts/counter.djs')).toBe(true);
    expect(has('D:/p/parts/counter (2).djs')).toBe(false);
  });

  it('G7（审查缺陷 #2）：重命名输入 `../../evil.djs` 消毒成工程内名字，⛔ 改名出根', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/fsm.djs': '{"cells":[]}' } });
    vscode.state.inputBoxResult = '../../evil.djs';
    await vscode.commands.executeCommand('verilogViz.renameFile', vscode.Uri.file('D:/p/fsm.djs'));
    expect(has('D:/p/evil.djs')).toBe(true);
    expect(has('D:/p/fsm.djs')).toBe(false);
    expect(has('D:/evil.djs')).toBe(false);
  });

  it('G7（审查缺陷 #3）：新建 Verilog 输入 `../../evil/top` 段消毒后落工程内，⛔ 逃出根', async () => {
    await boot({ folders: ['D:/p'] });
    vscode.state.inputBoxResult = '../../evil/top';
    await vscode.commands.executeCommand('verilogViz.newVerilogFile');
    expect(has('D:/p/evil/top.v')).toBe(true);
    expect(has('D:/evil/top.v')).toBe(false);
  });

  it('C9/C10/C11/D7：三颗新命令 × 两树 × 文件/目录 = 12 条菜单在册；两树的拖拽控制器挂上（域 MIME 圈死）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    const menus = manifest.contributes.menus['view/item/context'];
    const want = (cmd: string, view: string, item: string) =>
      menus.some((m: any) => m.command === cmd && m.when === `view == verilogViz.${view} && viewItem == ${item}`);
    for (const cmd of ['verilogViz.moveTo', 'verilogViz.copyPath', 'verilogViz.revealInOS']) {
      expect(want(cmd, 'codeFiles', 'codeFile')).toBe(true);
      expect(want(cmd, 'codeFiles', 'codeDir')).toBe(true);
      expect(want(cmd, 'sandboxFiles', 'sandboxFile')).toBe(true);
      expect(want(cmd, 'sandboxFiles', 'sandboxDir')).toBe(true);
    }
    expect((treeViewRec('verilogViz.codeFiles').dragAndDrop as any).dropMimeTypes)
      .toEqual(['application/vnd.code.tree.verilogviz.codefiles']);
    expect((treeViewRec('verilogViz.sandboxFiles').dragAndDrop as any).dropMimeTypes).toEqual([SANDBOX_MIME]);
  });

  it('C10/C11：复制路径＝绝对路径进剪贴板（告示带根相对）；在磁盘显示照递 uri 不炸', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    await vscode.commands.executeCommand('verilogViz.copyPath', vscode.Uri.file('D:/p/main.djs'));
    expect(vscode.state.clipboard.replace(/\\/g, '/').toLowerCase()).toBe('d:/p/main.djs');
    expect(vscode.state.infoMessages.some((m: string) => m.includes('main.djs'))).toBe(true);
    await vscode.commands.executeCommand('verilogViz.revealInOS', vscode.Uri.file('D:/p/main.djs'));   // ⛔ 炸＝断言败
  });

  it('F1/F3/G3：树内拖入目录——多选移动、域外拦下、绑定随迁、bindingsChanged 广播', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { main: 'main.djs' } }),
      'D:/p/main.djs': '{"cells":[]}',
      'D:/p/lib/top.v': 'module top; endmodule',
      'D:/p/parts/.keep': '',
    } });
    const { registerWebviewSink } = await import('../../extension/src/dispatch');
    const pushes: any[] = [];
    registerWebviewSink({ postMessage: (m: any) => { pushes.push(m); return Promise.resolve(true); } } as any);
    const drop: any = treeViewRec('verilogViz.sandboxFiles').dragAndDrop;
    const dt: any = { get: (m: string) => (m === SANDBOX_MIME ? { value: [vscode.Uri.file('D:/p/main.djs'), vscode.Uri.file('D:/p/lib/top.v')] } : undefined) };
    await drop.handleDrop({ resourceUri: vscode.Uri.file('D:/p/parts') } as any, dt);
    expect(has('D:/p/parts/main.djs')).toBe(true);
    expect(has('D:/p/main.djs')).toBe(false);
    expect(readMetaFile('D:/p/.verilogviz.json').bindings).toEqual({ main: 'parts/main.djs' });   // G1 随迁
    expect(pushes.some((m) => m.op === 'bindingsChanged')).toBe(true);                            // G3 广播
    expect(vscode.state.infoMessages.some((m: string) => m.includes('已移动 1 项') && m.includes('1 个非本域'))).toBe(true);
  });

  it('F4：OS 拖入——DataTransferFile 读字节落盘、(n) 去重；域外文件当面跳过', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/parts/x.djs': '{"cells":[]}',
      'D:/p/parts/new.djs': '{"cells":[]}',   // 占位 ⇒ 拖入的 new.djs 顺延 (2)
    } });
    const drop: any = treeViewRec('verilogViz.sandboxFiles').dragAndDrop;
    const bytes = new TextEncoder().encode('{"cells":[]}');
    const item = (name: string) => ({ file: { name, data: async () => bytes.buffer } });
    const dt: any = {
      get: (_m: string) => undefined,            // 树内 MIME 不在 ⇒ 走 OS 文件路（真 DataTransfer 两路都有）
      [Symbol.iterator]: function* () {
        yield ['application/octet-stream', item('new.djs')];
        yield ['application/octet-stream', item('readme.txt')];   // 域外 ⇒ skipped
      },
    };
    await drop.handleDrop({ resourceUri: vscode.Uri.file('D:/p/parts') } as any, dt);
    expect(has('D:/p/parts/new (2).djs')).toBe(true);
    expect(vscode.state.infoMessages.some((m: string) => m.includes('已拖入 1 个文件') && m.includes('1 个非本域文件已跳过'))).toBe(true);
  });

  it('H1（Q4）：circuits 名单里的 .djs 在沙盒树标 circuit=true 并挂 circuit-board 图标；名单外不挂', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ circuits: ['main.djs'], bindings: {} }),
      'D:/p/main.djs': '{"cells":[]}',
      'D:/p/part.djs': '{"cells":[]}',
    } });
    const sandbox = vscode.state.treeProviders['verilogViz.sandboxFiles'];
    const nodes = await sandbox.getChildren();
    const main = nodes.find((n: any) => n.label === 'main.djs');
    const part = nodes.find((n: any) => n.label === 'part.djs');
    expect(main.circuit).toBe(true);
    expect(part.circuit).toBeUndefined();
    const item = sandbox.getTreeItem(main);
    expect((item as any).iconPath?.id).toBe('circuit-board');
  });
});

describe('统一调用层（toolRegistry 批次一）：单执行器 + 闸序 + API 文档生成', () => {
  const readMetaFile = (p: string) => {
    const b = vscode.state.files.get(vscode.Uri.file(p).path.toLowerCase());
    return b ? JSON.parse(new TextDecoder().decode(b)) : undefined;
  };

  it('registry∧契约 一一对齐（孤儿双查，按族）：fs/bindings/circuits/res/compile/sys 六族双侧全在账', async () => {
    await boot({ folders: ['D:/p'] });
    const { listTools } = await import('../../extension/src/toolRegistry');
    const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/api/vv-api.defaults.json'), 'utf8'));
    const regIds = listTools().map((t: any) => t.id);
    for (const id of regIds) expect(contract.tools[id], `registry 独苗（契约缺账）: ${id}`).toBeTruthy();
    for (const fam of ['fs.', 'bindings.', 'circuits.', 'res.', 'sys.']) {
      const ct = Object.keys(contract.tools).filter((k) => k.startsWith(fam)).sort();
      const rg = regIds.filter((k: string) => k.startsWith(fam)).sort();
      expect(rg, `契约族 ${fam} 有未注册孤儿`).toEqual(ct);
    }
    expect(regIds.filter((k: string) => k.startsWith('compile.'))).toEqual(['compile.closure']);   // compile 族只上只读分析
  });

  it('闸① not-registered：未登记 id 拒（[API_NOT_REGISTERED] 机读码）', async () => {
    await boot({ folders: ['D:/p'] });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, CALLER_UI, 'fs.nope', {})).rejects.toThrow(/\[API_NOT_REGISTERED\]/);
  });

  it('sys.readAudit 的 date 实参归一：交 20261017（上一版 schema 就教这么写）也读到当天那颗连字符档——⛔ 把调用方的笔误伪装成"今天没人调用过"', async () => {
    const day = new Date().toISOString().slice(0, 10);            // apiAudit.flushAudit 落盘用的就是这颗串
    await boot({ folders: ['D:/a17'], seed: {
      [`D:/a17/.vv/audit/trace-${day}.jsonl`]: '{"verdict":"auto","tool":"fs.copyPath"}\n{"verdict":"error","tool":"fs.delete"}\n',
    } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const hyphen = await executeTool(ctx(PROD) as never, CALLER_UI, 'sys.readAudit', { date: day }) as any;
    expect(hyphen.exists).toBe(true);
    expect(hyphen.lines.length).toBe(2);
    // 成对判据（⛔ 只判"归一后读得到"）：两种写法必须交回**同一份**读数
    const bare = await executeTool(ctx(PROD) as never, CALLER_UI, 'sys.readAudit', { date: day.replace(/-/g, '') }) as any;
    expect(bare).toEqual(hyphen);
  });

  it('X18 两半接得上：collectLegacyItems 交出去的身份，宿主按**同一颗 key** 连到落盘名（⛔ 只判两半各自绿）', async () => {
    // 上面两颗臂各测一半：U 层测"收得出身份"，X 层测"宿主会落表"——那颗手搓的 items 从没经过
    // 前端，所以两半的**接缝**（key 的拼法、role 的字面值、bindings 的值到底是 id 还是名字）
    // ⓐ 没人测。这一颗把前端真收出来的那批直接喂宿主：接缝漂了必须在这里红。
    // （发现方式＝台架 M4：把前端退回只交 {name,content}，只有 U 臂红、X 臂照旧绿。）
    const m = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => m.set(k, v),
      removeItem: (k: string) => m.delete(k),
    };
    try {
      m.set('verilog-viz-sandbox-files', JSON.stringify({
        pa: { id: 'pa', name: 'parts/adder', graphJson: '{"cells":[1]}', role: 'part', updatedAt: 1 },
        pf: { id: 'pf', name: 'parts/full_adder', graphJson: '{"cells":[2]}', role: 'part', updatedAt: 2 },
        top: { id: 'top', name: 'ctrl', graphJson: '{"cells":[3]}', updatedAt: 3, partBindings: { adder: 'pa' } },
      }));
      const { collectLegacyItems } = await import('../../src/canvas/legacyMigration');
      const items = collectLegacyItems();
      expect(items.map((i) => i.name)).toEqual(['parts/adder.djs', 'parts/full_adder.djs', 'ctrl.djs']);

      await boot({ folders: ['D:/p2'] });
      vscode.state.modalChoice = '允许';
      const res = await rpc(vscode.state.panels[0], 'importLegacyData', { items });
      expect(res.ok).toBe(true);
      const readText = (abs: string) => new TextDecoder().decode(vscode.state.files.get(vscode.Uri.file(abs).path.toLowerCase())!);
      const partsTable = JSON.parse(readText('D:/p2/parts/.verilogviz.json'));
      expect(partsTable.bindings).toEqual({ adder: 'adder.djs', full_adder: 'full_adder.djs' });
      const rootTable = JSON.parse(readText('D:/p2/.verilogviz.json'));
      // ctrl.djs 那条"我要用 parts/adder"跨档连到了那颗部件的**落盘名**——接缝的两端都是真的
      expect(rootTable.bindings.adder).toBe('parts/adder.djs');
    } finally {
      delete (globalThis as any).localStorage;
    }
  });

  it('闸② surface-denied：mcp 面全局关（surfacesGlobal.mcp=false）→ agent 现阶段进不来', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const { executeTool } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, { surface: 'mcp', subject: 'mcp:agent', interactive: false }, 'fs.copyPath', { uri: 'D:/p/main.djs' }))
      .rejects.toThrow(/\[API_SURFACE_DENIED\]/);
  });

  it('闸③ not-granted：.vv/api.grants.json 绑空白名单 subject → 拒（fail-closed）；ui 未绑不受闸', async () => {
    await boot({ folders: ['D:/g'], seed: {
      'D:/g/.vv/api.grants.json': JSON.stringify({ subjects: { agent: 'empty' }, profiles: { empty: [] } }),
      'D:/g/main.djs': '{"cells":[]}',
    } });
    await new Promise((r) => setTimeout(r, 5));          // grants 是 activate 异步一次性载入
    const { executeTool } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, { surface: 'ui', subject: 'agent', interactive: false }, 'fs.copyPath', { uri: 'D:/g/main.djs' }))
      .rejects.toThrow(/\[API_NOT_GRANTED\]/);
    await expect(executeTool(ctx(PROD) as never, { surface: 'ui', subject: 'ui', interactive: true }, 'fs.copyPath', { uri: 'D:/g/main.djs' })).resolves.toBeTruthy();
  });

  it('闸④ HITL：requiresApproval(fs.delete) 非交互 → 弹审批；拒绝=[API_NOT_APPROVED] ⛔ 动盘，批准=真删+绑定随清', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { main: 'main.djs' } }),
      'D:/p/main.djs': '{"cells":[]}',
    } });
    const { executeTool } = await import('../../extension/src/toolRegistry');
    const agent = { surface: 'ui' as const, subject: 'agent', interactive: false };
    vscode.state.modalChoice = undefined;
    await expect(executeTool(ctx(PROD) as never, agent, 'fs.delete', { uri: 'D:/p/main.djs' })).rejects.toThrow(/\[API_NOT_APPROVED\]/);
    expect(has('D:/p/main.djs')).toBe(true);             // ⛔ 未批准不得动盘
    vscode.state.modalChoice = '允许';
    await executeTool(ctx(PROD) as never, agent, 'fs.delete', { uri: 'D:/p/main.djs' });
    expect(has('D:/p/main.djs')).toBe(false);
    expect(readMetaFile('D:/p/.verilogviz.json').bindings).toEqual({});
  });

  it('自检·HITL 防伪造：自报 interactive:true 的非 ui 身份⛔ 绕过审批（豁免=三条件齐验）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const { executeTool } = await import('../../extension/src/toolRegistry');
    const forger = { surface: 'ui' as const, subject: 'agent', interactive: true };   // 伪造交互
    vscode.state.modalChoice = undefined;
    await expect(executeTool(ctx(PROD) as never, forger, 'fs.delete', { uri: 'D:/p/main.djs' })).rejects.toThrow(/\[API_NOT_APPROVED\]/);
    expect(has('D:/p/main.djs')).toBe(true);             // ⛔ 伪造身份不得动盘
  });

  it('自检·空 uri 实参当场拒（argUri 守卫；⛔ Uri.file(\'\') 双界形状不可靠）', async () => {
    await boot({ folders: ['D:/p'] });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, CALLER_UI, 'fs.copyPath', { uri: '' })).rejects.toThrow(/uri 实参为空/);
  });

  it('闸①-b BAD_ARGS：缺必填实参（§15「schema+校验」最小实现，error verdict）', async () => {
    await boot({ folders: ['D:/p'] });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, CALLER_UI, 'fs.copyPath', {})).rejects.toThrow(/\[API_BAD_ARGS\]/);
  });

  it('自检·import 命令级链路回归：对话框 → fs.import 工具 → 落盘+告示（薄壳化后覆盖补回）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'C:/tmp/want.v': 'module want; endmodule',       // 源必须在桩的内存盘真存在（copy 非它 ⛔ 静默 no-op）
      'C:/tmp/board.json': '{}',
    } });
    vscode.state.openDialogResult = [vscode.Uri.file('C:/tmp/want.v'), vscode.Uri.file('C:/tmp/board.json')];
    await vscode.commands.executeCommand('verilogViz.importFiles');
    expect(has('D:/p/want.v')).toBe(true);
    expect(has('D:/p/board.json')).toBe(false);
    expect(vscode.state.infoMessages.some((m: string) => m.includes('已导入 1 个文件') && m.includes('1 个非本域文件已跳过'))).toBe(true);
  });

  it('自检·fs.rename 失败语义：同名/无效名=显式报错（verdict=error），⛔ 静默 ok:false 骗 agent', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/fsm.djs': '{"cells":[]}' } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    await expect(executeTool(ctx(PROD) as never, CALLER_UI, 'fs.rename', { uri: 'D:/p/fsm.djs', newName: 'fsm.djs' })).rejects.toThrow(/重命名未执行/);
  });

  it('headless 全链：agent 形状的字符串实参走 fs.move——绑定随迁 + bindingsChanged 广播', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { fsm: 'fsm.djs' } }),
      'D:/p/fsm.djs': '{"cells":[]}',
      'D:/p/gates/.keep': '',
    } });
    const { registerWebviewSink } = await import('../../extension/src/dispatch');
    const pushes: any[] = [];
    registerWebviewSink({ postMessage: (m: any) => { pushes.push(m); return Promise.resolve(true); } } as never);
    const { executeTool } = await import('../../extension/src/toolRegistry');
    const out = await executeTool(ctx(PROD) as never, { surface: 'ui', subject: 'agent', interactive: false }, 'fs.move', { src: 'D:/p/fsm.djs', destDir: 'D:/p/gates' }) as any;
    expect(out.uri).toBe('D:/p/gates/fsm.djs');
    expect(readMetaFile('D:/p/.verilogviz.json').bindings).toEqual({ fsm: 'gates/fsm.djs' });
    expect(pushes.some((m) => m.op === 'bindingsChanged')).toBe(true);
  });

  it('审计落账：fs.* 过闸一行 JSONL（verdict=auto、tool/ref/subject 全域）', async () => {
    await boot({ folders: ['D:/a'], seed: { 'D:/a/.vv/project.json': '{}', 'D:/a/main.djs': '{"cells":[]}' } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    await executeTool(ctx(PROD) as never, CALLER_UI, 'fs.copyPath', { uri: 'D:/a/main.djs' });
    await new Promise((r) => setTimeout(r, 5));          // fire-and-forget 入缓冲
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const key = [...vscode.state.files.keys()].find((k) => k.includes('/.vv/audit/'));
    expect(key).toBeTruthy();
    const lines = new TextDecoder().decode(vscode.state.files.get(key!)!).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l: any) => l.tool === 'fs.copyPath' && l.verdict === 'auto' && l.subject === 'ui')).toBe(true);
  });

  it('api:doc：docs/API_REFERENCE.md 与 registry+契约 零漂移（漂移=再生成落盘+当场红）', async () => {
    await boot({ folders: ['D:/p'] });
    const { renderApiReference } = await import('../../extension/src/apiDoc');
    const want = renderApiReference();
    const docPath = path.join(ROOT, 'docs', 'API_REFERENCE.md');
    const have = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : null;
    if (have !== want) {
      fs.writeFileSync(docPath, want);
      throw new Error('API 文档已漂移：已再生成 docs/API_REFERENCE.md——复查内容后随代码一并提交（pnpm api:doc 同效）。');
    }
    expect(have).toBe(want);
  });

  it('批次二·sys.listTools：discoverTools——fs.move 带权威 schema；契约属性齐', async () => {
    await boot({ folders: ['D:/p'] });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const out = await executeTool(ctx(PROD) as never, CALLER_UI, 'sys.listTools', {}) as any;
    expect(out.tools.length).toBeGreaterThanOrEqual(24);
    const mv = out.tools.find((t: any) => t.id === 'fs.move');
    expect(mv.schema.required).toEqual(['src', 'destDir']);
    expect(mv.perm).toBe('file-write');
    expect(mv.surfaces).toEqual(['ui']);
    expect(mv.requiresApproval).toBe(false);
  });

  it('批次二·sys.getStatus + sys.readAudit：状态账 + readLogs 读侧（含未开户形状）', async () => {
    await boot({ folders: ['D:/a'], seed: { 'D:/a/.vv/project.json': '{}', 'D:/a/main.djs': '{"cells":[]}' } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const st = await executeTool(ctx(PROD) as never, CALLER_UI, 'sys.getStatus', {}) as any;
    expect(st.registeredTools).toBeGreaterThanOrEqual(24);
    expect(st.projectRoot).toContain('D:/a');
    await executeTool(ctx(PROD) as never, CALLER_UI, 'fs.copyPath', { uri: 'D:/a/main.djs' });
    await new Promise((r) => setTimeout(r, 5));
    await vscode.commands.executeCommand('verilogViz.auditFlush');
    const log = await executeTool(ctx(PROD) as never, CALLER_UI, 'sys.readAudit', {}) as any;
    expect(log.exists).toBe(true);
    expect(log.lines.some((l: any) => l.tool === 'fs.copyPath' && l.verdict === 'auto')).toBe(true);
  });

  it('批次二·bindings 族：get 链合并 / set 目录层写 / materialize 同名固化（headless 全链）', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { counter: 'shared/counter.djs' } }),
      'D:/p/sub/.verilogviz.json': JSON.stringify({ bindings: { counter: 'local.djs' } }),
      'D:/p/sub/local.djs': '{"cells":[]}',
      'D:/p/shared/counter.djs': '{"cells":[]}',
    } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const g = await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.get', { doc: 'sub/top.djs' }) as any;
    expect(g.bindings.counter).toBe('sub/local.djs');            // 近层覆盖 + 值折回根相对
    await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.set', { dir: 'sub', celltype: 'half', part: 'sub/half.djs' });
    expect(readMetaFile('D:/p/sub/.verilogviz.json').bindings.half).toBe('half.djs');   // 同目录部件存裸名（相对化正确）
    const m = await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.materialize', { doc: 'sub/local.djs' }) as any;
    expect(Array.isArray(m.done)).toBe(true);
  });

  it('批次二·bindings.materialize：.djs 同目录同名自动命中 → 固化进目录表', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/main.djs': '{"cells":[{"type":"Subcircuit","celltype":"half"}]}',
      'D:/p/half.djs': '{"cells":[]}',
    } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const r = await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.materialize', { doc: 'main.djs' }) as any;
    expect(r.done.length).toBe(1);
    expect(readMetaFile('D:/p/.verilogviz.json').bindings.half).toBe('half.djs');
  });

  it('深度自检新增（R153）：bindings.materialize 的 **.v 侧**真落表（修前按构造恒 0 颗＝点了没反应）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.v': 'module top;\n  adder u1();\nendmodule',
        'D:/p/lib/adder.v': 'module adder;\nendmodule',      // ⛔ 任何表录它——本工具就是来录它的
      },
    });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const r = await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.materialize', { doc: 'top.v' }) as any;
    expect(r.done).toEqual(['adder → adder.v']);             // 形状＝`名 → 末段名`（面板直接念它）
    expect(readMetaFile('D:/p/.verilogviz.json').bindings).toEqual({ adder: 'lib/adder.v' });
  });

  it('批次二·circuits 族：list 空账 / toggle 翻转进名单 / 翻回', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/main.djs': '{"cells":[]}' } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    expect((await executeTool(ctx(PROD) as never, CALLER_UI, 'circuits.list', {}) as any).circuits).toEqual([]);
    const t1 = await executeTool(ctx(PROD) as never, CALLER_UI, 'circuits.toggle', { uri: 'D:/p/main.djs' }) as any;
    expect(t1.isCircuit).toBe(true);
    expect((await executeTool(ctx(PROD) as never, CALLER_UI, 'circuits.list', {}) as any).circuits).toEqual(['main.djs']);
    const t2 = await executeTool(ctx(PROD) as never, CALLER_UI, 'circuits.toggle', { uri: 'D:/p/main.djs' }) as any;
    expect(t2.isCircuit).toBe(false);
  });

  it('批次二·res 族：readProjectFile 穿越拒 + 读通；listProject/listSandbox 分域', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; endmodule',
      'D:/p/lib/adder.v': 'module adder; endmodule',
      'D:/p/main.djs': '{"cells":[]}',
    } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const r = await executeTool(ctx(PROD) as never, CALLER_UI, 'res.readProjectFile', { path: 'lib/adder.v' }) as any;
    expect(r.content).toContain('module adder');
    await expect(executeTool(ctx(PROD) as never, CALLER_UI, 'res.readProjectFile', { path: '../outside.v' })).rejects.toThrow();
    const l = await executeTool(ctx(PROD) as never, CALLER_UI, 'res.listProject', {}) as any;
    expect(l.files.map((f: any) => f.name).sort()).toEqual(['lib/adder.v', 'top.v']);   // 根相对（含目录段）
    const s = await executeTool(ctx(PROD) as never, CALLER_UI, 'res.listSandbox', {}) as any;
    expect(s.files.map((f: any) => f.name)).toEqual(['main.djs']);
  });

  it('批次二·compile.closure：R152 绑定权威——未绑定进 bindingErrors，补录后进闭包', async () => {
    await boot({ folders: ['D:/p'], seed: {
      'D:/p/top.v': 'module top; adder a1(); endmodule',
      'D:/p/adder.v': 'module adder; endmodule',
      'D:/p/.verilogviz.json': JSON.stringify({ bindings: { adder: 'adder.v' } }),
    } });
    const { executeTool, CALLER_UI } = await import('../../extension/src/toolRegistry');
    const c = await executeTool(ctx(PROD) as never, CALLER_UI, 'compile.closure', { uri: 'D:/p/top.v' }) as any;
    expect(c.topModule).toBe('top');
    expect(c.files).toContain('adder.v');                        // 已显式绑定 ⇒ 定义文件入闭包
    expect(c.bindingErrors ?? []).toEqual([]);
    // 未绑定的对照面：拆表 ⇒ 实例进 bindingErrors（R152：⛔ 同名自动兜底）
    await executeTool(ctx(PROD) as never, CALLER_UI, 'bindings.set', { celltype: 'adder', part: null });
    const c2 = await executeTool(ctx(PROD) as never, CALLER_UI, 'compile.closure', { uri: 'D:/p/top.v' }) as any;
    expect(c2.files).not.toContain('adder.v');
    expect((c2.bindingErrors ?? []).some((s: string) => s.includes('adder'))).toBe(true);
  });
});
