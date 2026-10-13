// Extension Host 的**整条链**在无头环境里跑一遍（`vscode` 走 vitest.config.ts 的 alias 指到那颗桩）。
// 为什么这一批值得建：片 3/4/5 每往 workbench 原生位置搬一层 UI，改的都是
// "前端 RPC → 宿主选根 → 落盘 → webview 装载 → 应答"这一串；以前这四件事全**⛔ 不开一颗真
// Extension Host 就看不见**，于是统统登记成"真机项"，用户的注意力成了台架。
// ⚠ 射程（与桩自己那份说明一致）：这里证的是"我们这边的接线对"，⛔ 证 VS Code 那边会这么干——
//   后者仍归 `tests/r137-webview-csp-gate.cjs`（真浏览器 + 真 CSP）与真机点验。
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

type Stub = typeof import('./vscodeApiStub');

const GLOBAL_HOME = 'C:/Users/x/AppData/Roaming/VV/User/globalStorage/local.verilog-visualizer-vscode';
const OLD_HOME = `${GLOBAL_HOME}/project_files`;        // 换轨前的那个家
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

const listed = (res: any) => res.data.files.map((f: any) => f.name);
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
    expect([...vscode.state.commands.keys()].sort()).toEqual(['verilogVisualizer.open', 'verilogVisualizer.revealProjectDir']);
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
      '/d:/vv-studio/vscode/extensions/verilog-visualizer/webview',
      '/d:/vv-studio/vscode/extensions/verilog-visualizer/../dist',
    ]);
    // `localResourceRoots` 是 webview 能读到的最大范围：给到仓根＝整仓上游源码（含 .git）对一个网页可读
    expect(roots).not.toContain('/d:/vv-studio/vscode');
  });
});

describe('项目根＝打开的那个文件夹（片 3 换轨）', () => {
  it('开了文件夹就从文件夹读，⛔ 再把旧家那份当"当前工程"列出来', async () => {
    await boot({
      folders: ['D:/projects/计数器'],
      seed: { [`${OLD_HOME}/老项目.v`]: 'module old; endmodule', 'D:/projects/计数器/top.v': 'module top; endmodule' },
    });
    const res = await rpc(vscode.state.panels[0], 'listProjectTree');
    expect(res.ok).toBe(true);
    expect(listed(res)).toEqual(['top.v']);
  });

  it('没开文件夹就退回旧家（⛔ 一升级就"我的文件全没了"）', async () => {
    await boot({ seed: { [`${OLD_HOME}/老项目.v`]: 'module old; endmodule' } });
    expect(listed(await rpc(vscode.state.panels[0], 'listProjectTree'))).toEqual(['老项目.v']);
  });

  it('多根工作区取第一颗（在册取舍，但行为必须固定，⛔ 随机）', async () => {
    await boot({ folders: ['D:/a', 'D:/b'], seed: { 'D:/a/x.v': 'module x; endmodule', 'D:/b/y.v': 'module y; endmodule' } });
    expect(listed(await rpc(vscode.state.panels[0], 'listProjectTree'))).toEqual(['x.v']);
  });

  it('写盘真的落在工作区里（这颗换轨的**后果**：Explorer 看得见＝文件真在仓库里）', async () => {
    await boot({ folders: ['D:/projects/计数器'] });
    const res = await rpc(vscode.state.panels[0], 'saveProjectFile', { name: '子模块/deep.v', content: 'module deep; endmodule' });
    expect(res.ok).toBe(true);
    expect(has('D:/projects/计数器/子模块/deep.v')).toBe(true);
    expect(has(`${OLD_HOME}/子模块/deep.v`)).toBe(false);
  });

  it('工程配置留在应用级：开了文件夹也⛔ 往用户仓库里扔配置文件', async () => {
    await boot({ folders: ['D:/projects/计数器'] });
    const res = await rpc(vscode.state.panels[0], 'saveProjectConfig', { content: '{"theme":"dark"}' });
    expect(res.ok).toBe(true);
    expect(has(`${OLD_HOME}/verilog-viz.config.json`)).toBe(true);
    expect(JSON.parse((await rpc(vscode.state.panels[0], 'readProjectConfig')).data).theme).toBe('dark');
    // 工作区那一侧一颗文件都不该多出来（否则用户的 `git status` 当场脏）
    expect([...vscode.state.files.keys()].some((k) => k.startsWith('/d:/projects'))).toBe(false);
  });

  it('node_modules 与点开头目录＝⛔ 上报也⛔ 走进去（换轨后根可能是整仓代码）', async () => {
    await boot({
      folders: ['D:/p'],
      seed: {
        'D:/p/top.v': 'module top; endmodule',
        'D:/p/node_modules/vend/x.v': 'module x; endmodule',
        'D:/p/.git/hooks/y.v': 'module y; endmodule',
        'D:/p/sub/z.sv': 'module z; endmodule',
      },
    });
    const res = await rpc(vscode.state.panels[0], 'listProjectTree');
    expect(listed(res).sort()).toEqual(['sub/z.sv', 'top.v']);
    expect(res.data.folders).toEqual(['sub']);         // 被跳过的目录连"空文件夹"都⛔ 算在册
  });

  it('同名的可见目录照旧上报（这条跳过规则⛔ 顺手把正常目录也吞了）', async () => {
    await boot({ folders: ['D:/p'], seed: { 'D:/p/modules/a.v': 'module a; endmodule', 'D:/p/gitlike/b.v': 'module b; endmodule' } });
    expect(listed(await rpc(vscode.state.panels[0], 'listProjectTree')).sort()).toEqual(['gitlike/b.v', 'modules/a.v']);
  });
});

describe('RPC 走真通道的形状', () => {
  it('ok:false 带宿主原话（⛔ 静默 resolve——前端靠这句显示错误）', async () => {
    await boot({ folders: ['D:/p'] });
    const panel = vscode.state.panels[0];
    const bad = await rpc(panel, 'deleteProjectFile', { name: '../逃逸.v' });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Parent directory/);
    expect(panel.messageLog.every((m: any) => m.vvh === 'res')).toBe(true);
  });

  it('存进去再读回来是同一串（含中文文件名与嵌套目录）', async () => {
    await boot({ folders: ['D:/p'] });
    const panel = vscode.state.panels[0];
    await rpc(panel, 'saveProjectFile', { name: '组/顶层.v', content: 'module 顶层; endmodule' });
    const res = await rpc(panel, 'readProjectFile', { name: '组/顶层.v' });
    expect(res.ok).toBe(true);
    expect(res.data).toBe('module 顶层; endmodule');
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

  it('⛔ 没人应答的方法名：dispatch 落到 default 必须回错误（⛔ 挂着等超时）', async () => {
    await boot({ folders: ['D:/p'] });
    const res = await rpc(vscode.state.panels[0], 'windowMinimize', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/不认识的调用/);
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

/**
 * 清单（manifest）里的两颗"装载前提"。为什么在无头判它：这两项缺任一颗，症状都**⛔ 报错、
 * 日志里也⛔ 一行**——2026-10-13 真机读到过一次：打开一个从没信任过的文件夹后，
 * exthost 里连 `_doActivateExtension local.verilog-visualizer-vscode` 都⛔ 出现，窗口只剩
 * Welcome（受限模式）页；同一份产物加 `--disable-workspace-trust` 再跑，激活行就回来了
 * ⇒ 归责钉在 `capabilities.untrustedWorkspaces`（宿主在未信任工作区⛔ 激活没声明支持的扩展）。
 */
describe('装载前提（manifest）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));

  it('在未信任的工作区里也要被激活（⛔ 让"打开文件夹就只看得到 Welcome"这一族回来）', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(true);
    // ⚠ 声明了 supported 就得给 description：VS Code 在受限模式里会把这句话显示给用户，
    //   没写等于让用户在⛔ 知道为什么放行的地方点了放行
    expect(String(manifest.capabilities.untrustedWorkspaces.description).length).toBeGreaterThan(40);
  });

  it('activationEvents 里有 onStartupFinished（⛔ 它，没人调命令时扩展根本⛔ 激活，面板也⛔ 自己弹）', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  it('main 指的是那份 esbuild 产物（改打包格式忘了同步这里＝宿主加载一颗⛔ 存在的文件）', () => {
    expect(manifest.main).toBe('./dist/extension.cjs');
    expect(fs.existsSync(path.join(ROOT, 'extension', manifest.main.replace(/^\.\//, '')))).toBe(true);
  });
});

describe('面板释放与命令：两条装载路共用同一个主人', () => {
  it('恢复出来的面板关掉后登记会清掉 ⇒ 再按命令是**新开**而不是 reveal 一颗死面板', async () => {
    await boot();
    const first = vscode.state.panels[0];
    first.dispose();
    expect(first.disposed).toBe(true);
    await vscode.commands.executeCommand('verilogVisualizer.open');
    expect(vscode.state.panels.length).toBe(2);
    expect(vscode.state.panels[1].revealCount).toBe(0);
  });

  it('没面板时按命令 ⇒ 开一颗（⛔ "点了没反应"）', async () => {
    await boot({ appRoot: 'C:/elsewhere' });           // 非内置 ⇒ 开局⛔ 自动弹
    expect(vscode.state.panels.length).toBe(0);
    await vscode.commands.executeCommand('verilogVisualizer.open');
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
