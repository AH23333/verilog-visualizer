// VS Code 壳的三颗"无头也能判"的证人（R136/R137）。
// 为什么必须有无头版：壳的真机验收只有开 Extension Development Host 才看得见，
// 而最容易错的恰好是**不需要 VS Code 也能算**的三件事——
//   ① 把 Vite 产物里的绝对路径改写成 webview 能读的 URI（改漏一处＝白屏且只在壳里复现）；
//   ② 项目目录的路径规则与目录树扫描（这一颗是**安全边界**：绝对路径/`..` 必须拒）；
//   ③ 前端与 Extension Host 那两张 RPC 方法名表是不是同一张（只改一边＝按了没反应）。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rewriteWebviewHtml, buildCsp } from '../../extension/src/html';
import { ProjectStore, sanitizeRel, VERILOG_EXT } from '../../extension/src/projectStore';
import {
  isVerilogPath, isSandboxPath, isBindablePath, isBindingTargetValue, stripVerilogExt, watcherGlobs, rootRel,
} from '../../extension/src/verilogDomain';
import * as vscode from 'vscode';

const ROOT = path.resolve(__dirname, '..', '..');
const DIST_HTML = path.join(ROOT, 'dist', 'index.html');

const asUri = (rel: string) => `vscode-webview://ext/dist/${rel}`;
const run = (raw: string) => rewriteWebviewHtml({
  rawHtml: raw, assetUri: asUri, cspSource: 'vscode-webview://ext', nonce: 'NONCE123',
});

describe('webview HTML 改写', () => {
  it('同源绝对路径全部换成 webview URI；CDN 与 data: 原样放过', () => {
    const out = run('<!doctype html><html><head><meta charset="UTF-8">'
      + '<link rel="icon" href="/vite.svg">'
      + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">'
      + '<script src="/digitaljs.js"></script>'
      + '<script src="/yosys/yosys.browser.js"></script>'
      + '</head><body><div id="root"></div>'
      + '<script type="module" crossorigin src="/assets/index-abc123.js"></script>'
      + '</body></html>');
    expect(out).not.toMatch(/src="\/assets\//);
    expect(out).not.toMatch(/href="\/vite\.svg"/);
    expect(out).toContain('src="vscode-webview://ext/dist/assets/index-abc123.js"');
    expect(out).toContain('src="vscode-webview://ext/dist/digitaljs.js"');
    expect(out).toContain('src="vscode-webview://ext/dist/yosys/yosys.browser.js"');
    // CDN 那颗不能被改成本地 URI（改了就是 404）
    expect(out).toContain('href="https://cdnjs.cloudflare.com/ajax/libs/prism');
  });

  it('注入 CSP 与 <base>：wasm 与按需 chunk 靠 base 解析；nonce 白名单而不是 unsafe-inline', () => {
    const out = run('<!doctype html><html><head><title>x</title></head><body></body></html>');
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(out).toContain("<base href=\"vscode-webview://ext/dist/\">");
    const csp = buildCsp('vscode-webview://ext', 'NONCE123');
    expect(csp).toContain("'wasm-unsafe-eval'");           // yosys-wasm 要实例化 .wasm
    expect(csp).toContain("style-src vscode-webview://ext 'unsafe-inline'"); // joint 运行时注 <style>
    expect(csp).toContain("worker-src vscode-webview://ext blob:");
    expect(csp).toContain("script-src 'nonce-NONCE123'");
    // 动态 import 挑宿主实现这一条路，⛔ 断言"nonce 传不传得过去"——本机 Chromium 实测**传得过去**，
    // 但那是运行时行为，⛔ 押它。所以 script-src 里带上 webview origin 是**不赌注**的决定，
    // 而⛔ 把它写成"已测缺陷"（上一批我这样写过，被自己的变异臂当场否掉，见 R137 那节）。
    expect(csp).toMatch(/script-src[^;]*vscode-webview:\/\/ext/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/); // ⛔ 用 unsafe-inline 等于把 CSP 关掉
  });

  it('已经带 nonce 的脚本不重复加（改写要幂等）', () => {
    const once = run('<!doctype html><html><head></head><body>'
      + '<script nonce="preset" src="/assets/a.js"></script></body></html>');
    expect(once.match(/nonce=/g)?.length).toBe(1);
    expect(once).toContain('nonce="preset"');
  });

  it('对**真实构建产物**也成立（跑过 pnpm build 时才有效，否则显式跳过）', () => {
    if (!fs.existsSync(DIST_HTML)) { console.warn('  [跳过] 没有 dist/index.html（先 pnpm build）'); return; }
    const raw = fs.readFileSync(DIST_HTML, 'utf8');
    const out = run(raw);
    expect(out).not.toMatch(/(src|href)="\/(assets|digitaljs\.js|yosys|vite\.svg)/);
    // 同一颗 <script> 开标签里 src 与 nonce 都要有（⛔ 断言二者的先后顺序——那不该是契约）
    const tag = (out.match(/<script[^>]*>/g) || []).find((t) => t.includes('/assets/'));
    expect(tag).toBeTruthy();
    expect(tag).toContain('nonce="NONCE123"');
    expect(tag).toContain('src="vscode-webview://ext/dist/assets/');
  });

  it('.djs 文档入口 doc.html 也是真实构建产物的一员（双入口缺一颗＝custom editor 白屏）', () => {
    const docPath = path.join(ROOT, 'dist', 'doc.html');
    if (!fs.existsSync(docPath)) { console.warn('  [跳过] 没有 dist/doc.html（先 pnpm build）'); return; }
    const raw = fs.readFileSync(docPath, 'utf8');
    const out = run(raw);
    expect(out).toContain('Content-Security-Policy');
    // doc 入口 ⛔ 引 yosys（6MB JS + 16MB wasm 只该在编译画布那条路）——引用了说明入口分岔失败
    expect(raw).not.toMatch(/yosys/);
  });
});

/** 内存假 fs：让路径规则与扫描顺序可判，⛔ 开 VS Code 才看得见 */
function memFs(seed: Record<string, string | null> = {}) {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const dirs = new Set<string>(['@root']);
  for (const [p, v] of Object.entries(seed)) if (v !== null) add(p, v);
  function add(p: string, text: string) {
    const parts = p.split('/').slice(0, -1);
    let acc = '';
    for (const s of parts) { acc = acc ? `${acc}/${s}` : s; dirs.add(`@root/${acc}`); }
    files.set(p, { data: new TextEncoder().encode(text), mtime: 1700000000000 + p.length });
  }
  const norm = (abs: string) => abs.replace(/^@root\/?/, '').replace(/^\/+/, '');
  const api = {
    files, dirs,
    async readFile(abs: string) {
      const k = norm(abs);
      if (!files.has(k)) throw new Error(`ENOENT ${k}`);
      return files.get(k)!.data;
    },
    async writeFile(abs: string, data: Uint8Array) { add(norm(abs), new TextDecoder().decode(data)); },
    async createDir(abs: string) { dirs.add(norm(abs) ? `@root/${norm(abs)}` : '@root'); },
    async remove(abs: string, recursive: boolean) {
      const k = norm(abs);
      if (!recursive && files.has(k)) files.delete(k);
      else {
        for (const f of [...files.keys()]) if (f === k || f.startsWith(`${k}/`)) files.delete(f);
        for (const d of [...dirs]) if (d === `@root/${k}` || d.startsWith(`@root/${k}/`)) dirs.delete(d);
      }
    },
    async rename(from: string, to: string) {
      const f = norm(from), t = norm(to);
      if (files.has(f)) { const v = files.get(f)!; files.delete(f); files.set(t, v); }
      else {
        for (const k of [...files.keys()]) if (k === f || k.startsWith(`${f}/`)) {
          files.set(t + k.slice(f.length), files.get(k)!); files.delete(k);
        }
      }
    },
    async copy(from: string, to: string) {
      const f = norm(from), t = norm(to);
      if (files.has(f)) files.set(t, files.get(f)!);
      else for (const k of [...files.keys()]) if (k === f || k.startsWith(`${f}/`)) files.set(t + k.slice(f.length), files.get(k)!);
    },
    async stat(abs: string) {
      const k = norm(abs);
      if (files.has(k)) return { type: 'file' as const, size: files.get(k)!.data.length, mtimeMs: files.get(k)!.mtime };
      if (dirs.has(k) || k === '') return { type: 'dir' as const, size: 0, mtimeMs: 0 };
      return null;
    },
    async readDir(abs: string) {
      const k = norm(abs);
      const prefix = k ? `${k}/` : '';
      const out: Array<{ name: string; type: 'file' | 'dir' }> = [];
      for (const f of files.keys()) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.push({ name: f.slice(prefix.length), type: 'file' });
      for (const d of dirs) {
        if (d === '@root') continue;                 // ⛔ 把根自己当一颗子目录上报（这颗漏是新的 `toEqual([])` 那格抓出来的）
        const ds = d.replace(/^@root\//, '');
        if (!ds.startsWith(prefix) || ds === k) continue;
        const rest = ds.slice(prefix.length);
        if (rest && !rest.includes('/')) out.push({ name: rest, type: 'dir' });
      }
      return out;
    },
  };
  return api;
}

describe('项目目录后端（与当年 Rust 后端那 14 颗命令逐条同语义）', () => {
  it('绝对路径与 .. 一律拒（Rust sanitize_path 的同一条规则）', () => {
    expect(() => sanitizeRel('/etc/passwd')).toThrow(/Absolute/);
    expect(() => sanitizeRel('C:\\Windows\\x.v')).toThrow(/Absolute/);
    expect(() => sanitizeRel('a/../../b.v')).toThrow(/Parent directory/);
    expect(() => sanitizeRel('')).toThrow();
    expect(sanitizeRel('sub/dir/x.v')).toBe('sub/dir/x.v');
    expect(sanitizeRel('sub\\dir\\x.v')).toBe('sub/dir/x.v');   // Windows 分隔符归一
  });

  it('存盘会补父目录、读回来内容一致；删除不存在的文件不是错误', async () => {
    const store = new ProjectStore(memFs() as never, '@root');
    await store.saveFile('组/子/a.v', 'module a; endmodule');
    expect(await store.readFile('组/子/a.v')).toBe('module a; endmodule');
    await expect(store.deleteFile('没这个.v')).resolves.toBeUndefined();
  });

  it('目录树：只上报 .v/.sv/.vh，名字是相对根且用 / 分隔；空文件夹也在册（前端靠它对账）', async () => {
    const fs2 = memFs({
      'top.v': 'module top; endmodule',
      'sub/deep.sv': 'module deep; endmodule',
      'notes.txt': 'ignore me',
      'old.vh': '`define X 1',
    });
    await fs2.createDir('@root/空文件夹');
    const tree = await new ProjectStore(fs2 as never, '@root').listTree();
    expect(tree.files.map((f) => f.name).sort()).toEqual(['old.vh', 'sub/deep.sv', 'top.v']);
    expect(tree.files.find((f) => f.name === 'top.v')?.size).toBe('module top; endmodule'.length);
    // ⛔ 用 toContain：`toEqual` 才会把假 fs 自己的毛病爆出来（上一格用 toContain 时，根目录被当成一颗子目录混在里面没人看见）
    expect(tree.folders.sort()).toEqual(['sub', '空文件夹']);
    expect(tree.files.some((f) => f.name === 'notes.txt')).toBe(false);
  });

  it('X4：目录软链（link 记号）不上报也不走进——循环 symlink 不再把 walk 打成死循环', async () => {
    const fs6 = memFs({ 'keep.v': 'module keep; endmodule' });
    const origReadDir = fs6.readDir.bind(fs6);
    (fs6 as any).readDir = async (p: string) =>
      (p === '@root/软' ? [{ name: '自指', type: 'link' }, { name: 'leak.v', type: 'file' }] : origReadDir(p));
    const tree = await new ProjectStore(fs6 as never, '@root').listTree();
    expect(tree.folders).toEqual([]);                          // 软链目录整支不上报
    expect(tree.files.map((f) => f.name)).toEqual(['keep.v']); // 软链下的 .v 也不收（不走进）
  });

  it('X4：深度 16 护栏——第 17 层的文件不再上报，目录壳仍可见（护栏只挡走进）', async () => {
    let seed: Record<string, string> = { 'top.v': 'module top; endmodule' };
    let relPath = '';
    for (let i = 0; i < 17; i++) relPath = `${relPath}层${i}/`;
    seed[`${relPath}deep.v`] = 'module deep; endmodule';
    const fs7 = memFs(seed);
    const tree = await new ProjectStore(fs7 as never, '@root').listTree();
    expect(tree.files.map((f) => f.name)).toEqual(['top.v']);  // 第 17 层的 deep.v 被护栏截住
    expect(tree.folders).toHaveLength(16);                     // 层0..层15 的目录壳在册（push 走回券序，别按位置断言）
    expect(tree.folders.some((f) => f.endsWith('层15'))).toBe(true);
    expect(tree.folders.some((f) => f.endsWith('层16'))).toBe(false);   // 层16 整支无踪（护栏在进入它的目录体前截断）
  });

  it('两颗表各收各的：`.djs` 只进 `listSandboxTree`，⛔ 混进 Verilog 那份（片 4-C1 的分界）', async () => {
    // 为什么这一格值得单独钉：`src/store/fileStore.ts` 的 refresh() 会把 listProjectTree 回的**每一颗**
    // 当 Verilog 源码读进来解析模块，还带一条"磁盘上没了就从状态删"的分支。
    // `.djs` 一旦混进那颗表＝电路 JSON 被当模块导入（模块名一片垃圾）＋沙盒那侧被牵动。
    const fs5 = memFs({
      'top.v': 'module top; endmodule',
      '画布甲.djs': '{"cells":[]}',
      '子目录/画布乙.djs': '{"cells":[]}',
      'notes.txt': 'ignore me',
    });
    const store = new ProjectStore(fs5 as never, '@root');
    expect((await store.listTree()).files.map((f) => f.name)).toEqual(['top.v']);
    expect((await store.listSandboxTree()).files.map((f) => f.name).sort()).toEqual(['子目录/画布乙.djs', '画布甲.djs']);
    // 跳过规则与路径形状由同一颗 walk 出来：两颗表都得⛔ 看见 node_modules / 点开头目录
    const fs6 = memFs({ 'a.v': 'A', 'node_modules/x.djs': '{}', '.git/hooks/y.djs': '{}' });
    const t2 = await new ProjectStore(fs6 as never, '@root').listSandboxTree();
    expect(t2.files).toEqual([]);
    expect(t2.folders).toEqual([]);
  });

  it('移动/复制文件夹带子树；配置缺失＝抛错（前端 projectConfigStore 靠这颗走默认值）', async () => {
    const fs3 = memFs({ 'g/a.v': 'A', 'g/h/b.v': 'B' });
    const store = new ProjectStore(fs3 as never, '@root');
    await expect(store.readConfig()).rejects.toThrow(/Config file not found/);
    await store.saveConfig('{"theme":"dark"}');
    expect(JSON.parse(await store.readConfig()).theme).toBe('dark');
    await store.copyFolder('g', 'g2');
    expect(await store.readFile('g2/h/b.v')).toBe('B');
    await store.moveFolder('g', 'g3');
    expect(await store.readFile('g3/a.v')).toBe('A');
    await expect(store.readFile('g/a.v')).rejects.toThrow(/Failed to read file/);
  });
});

describe('RPC 方法名表对账（前端 ↔ Extension Host）', () => {
  // 两边各写一张表，中间隔着一条 webview 消息边界 ⇒ 加一颗宿主能力时**只改一边**是静默失败：
  // 前端 `rpc('newMethod')` 发出去，宿主落进 `default:` 抛"不认识的调用"，症状是"这个功能按了没反应"。
  // 这颗闸门读的是两份**源码文本**（⛔ 运行时探测），因为它判的就是"两张表是否同一张"。
  // 片 5：宿主那张表搬家了——extension.ts 只留装载，case 表在 dispatch.ts（Panel 与 custom editor 共用）。
  const client = fs.readFileSync(path.join(ROOT, 'src/lib/host/vscodeHost.ts'), 'utf8');
  const host = fs.readFileSync(path.join(ROOT, 'extension/src/dispatch.ts'), 'utf8');
  // ⚠ 正则要吃下嵌套泛型（`rpc<Record<string, string>>('getDocBindings'…`）——`[^>]*` 在内层 `>` 处断掉；
  //   惰性取到第一颗 `('` 为止（⛔ 用 `.*?`：`import('./x')` 形状会误抽出 'x' 当方法名）。
  const sent = [...client.matchAll(/rpc\b[^;]*?\('([a-zA-Z]+)'/g)].map((m) => m[1]).sort();
  // 阶段三第一刀后，rpc 面的身份清单正本＝dispatch.ts 那颗 `RPC_METHODS`（switch 还在，但闸与账
  // 归 executeTool，"扫 case 标签"那把尺读的已是内部实现）。名册⛔ 只给锁用：它同时是
  // `registerRpcTools` 的登记清单（运行时活着的用途）；`dispatch()` 那颗前置挡册已摘——挡在门外
  // 就进不了账本（见 extensionHost 的「审计臂②」：幽灵调用必须留一行 not-registered）。
  const roster = /export const RPC_METHODS = \[([\s\S]*?)\] as const;/.exec(host)?.[1] ?? '';
  const handled = [...roster.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).sort();

  it('两边都真抽到了名字（⛔ 正则失配造成的"两边都空 ⇒ 相等 ⇒ 绿"）', () => {
    // 9＝片 5-B3 起（getConfig/saveExportFile/publishProblems/appendOutput/copyToSandbox/
    // importLegacyData/getDocBindings/setDocBindings/jumpToSource）。
    // 旧 18 颗里文件 CRUD/配置/剪贴板那 12 颗随旧 React UI 退役。⛔ 把这个数改小：改小＝允许某一边漏一颗。
    expect(sent.length).toBeGreaterThanOrEqual(9);
    expect(handled.length).toBeGreaterThanOrEqual(9);
  });

  it('两张表逐字相同：前端调的每一颗宿主都认得，宿主认得的每一颗前端都在调', () => {
    // ⛔ 只判单向（"dispatch 有的分支多一个也算绿"）⇒ 那张表会攒出没人调的死码，
    //    而死码正是"我以为这条通道通了"的来源。
    expect(sent.filter((m) => !handled.includes(m))).toEqual([]);
    expect(handled.filter((m) => !sent.includes(m))).toEqual([]);
    expect(handled).toEqual(sent);
  });

  it('名册 ↔ 实现体双向：RPC_METHODS 上有的 dispatchCore 必有一体，switch 里有的必在名册上', () => {
    // 收编后 `dispatch()` ⛔ 看名册（查册交 executeTool），名册与 switch 之间只剩"注册 handler"一根线：
    //  · 名册有、switch 漏 ⇒ 只有真调用时才炸（default 那句「名册与实现漂移」），闸门期毫无读数；
    //  · switch 有、名册漏 ⇒ 那颗 case ⛔ 注册成 handler＝死码，而契约 rpc 面照样放行。
    // 所以⛔ 等运行期，源码层双向比（红名直接报是哪一颗）。
    const cases = [...host.matchAll(/\bcase '([a-zA-Z]+)':/g)].map((m) => m[1]).sort();
    expect(cases.length).toBeGreaterThanOrEqual(9);          // ⛔ 正则失配造成的"两边都空 ⇒ 相等 ⇒ 绿"
    expect(cases.filter((c) => !handled.includes(c))).toEqual([]);
    expect(handled.filter((c) => !cases.includes(c))).toEqual([]);
  });

  it('API 契约对账锁（阶段二第一刀）：rpc 投影＝dispatch 表、ui 投影每颗指得着真身、id/词表双向自检', () => {
    // ⚠ 这一颗以前有**五处**写成 `expect('文案' + 布尔).toBeTruthy()`：字符串拼布尔恒为非空串，
    //   ⇒ ①id 词表、③ui 投影、④perm/sideEffects 词表、④surfaces 去重 从来没有判过任何东西，
    //   整段只剩 ② 在真跑。现读两条"如果它活着会说什么"：
    //    · ① 的命名空间表还停在 `circuit|project|bindings|compile|host`，而契约里 20 颗属于
    //      `fs.`/`res.`/`sys.`/`circuits.` ⇒ 恒红；
    //    · ③「ui 投影全在命令面板」不成立：27 颗里 13 颗的 ref 不是 contributed command
    //      （bindings.*/circuits.list/res.*/compile.closure/sys.* 是 registry 侧的 handler 名）。
    //   改法⛔ 把文案塞进 expect 的第二参当值测（那是 vitest 的 message 位），而是
    //   **把不合格的名字收进数组、判它等于空**——红名必须直接报出是哪几颗。
    const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/api/vv-api.defaults.json'), 'utf8'));
    const tools: Array<{ id: string; t: any }> = Object.entries(api.tools).map(([id, t]) => ({ id, t: t as any }));
    expect(tools.length).toBeGreaterThanOrEqual(10);
    // ① 工具 id 词表（域.动词 闭集形状）。命名空间本身也钉成等式：新增一域要同时改这里，
    //    ⛔ 让 ① 跟着放宽（词表由被检对象自己决定＝没检）。
    // R160 四-4：新域 project（工程体检聚合）在此登记开户——310 行等式照旧双向自查（每域必有实例、实例必归此表）。
    const NS = ['bindings', 'circuits', 'compile', 'fs', 'host', 'project', 'res', 'sys'];
    const idRe = new RegExp(`^(${NS.join('|')})\\.[a-z][A-Za-z]*$`);
    expect(tools.map(({ id }) => id).filter((id) => !idRe.test(id))).toEqual([]);
    expect([...new Set(tools.map(({ id }) => id.split('.')[0]))].sort()).toEqual(NS);
    // ② rpc surfaces 投影 == dispatch case 表（双向：漏登/幽灵都红）
    const rpcRefs = tools.filter(({ t }) => t.surfaces.includes('rpc')).map(({ t }) => t.ref).sort();
    expect(rpcRefs).toEqual(handled);
    // ③ ui 投影的 ref 必须指得着一颗真身：命令面板里的 command，或 registry 里真登记了的 handler。
    //    ⛔ 只判"在 commands 里"——那会把工具域（ref＝id）一起判死，历史上正是这条把它写虚的。
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8'));
    const cmdIds = new Set((manifest.contributes.commands || []).map((c: any) => c.command));
    const handlerSrc = fs.readFileSync(path.join(ROOT, 'extension/src/toolsDomain.ts'), 'utf8')
      + fs.readFileSync(path.join(ROOT, 'extension/src/toolsFs.ts'), 'utf8');
    const handlerIds = new Set([...handlerSrc.matchAll(/^\s*id: '([^']+)'/gm)].map((m) => m[1]));
    expect(tools.filter(({ t }) => t.surfaces.includes('ui'))
      .filter(({ t }) => !cmdIds.has(t.ref) && !handlerIds.has(t.ref))
      .map(({ id, t }) => `${id}→${t.ref}`)).toEqual([]);
    //    反方向同样钉住：registry 里有一颗 handler 而契约没登记＝契约在说谎（另一面）
    expect([...handlerIds].filter((h) => !tools.some(({ id }) => id === h)).sort()).toEqual([]);
    // ④ 字段词表与 schema 同源（改枚举必先改 schema——词表漂移＝契约说谎）
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/schemas/vv-api.schema.json'), 'utf8'));
    const permEnum: string[] = schema.properties.tools.additionalProperties.properties.perm.enum;
    const seEnum: string[] = schema.properties.tools.additionalProperties.properties.sideEffects.enum;
    expect({
      perm: tools.filter(({ t }) => !permEnum.includes(t.perm)).map(({ id, t }) => `${id}.perm=${t.perm}`),
      sideEffects: tools.filter(({ t }) => !seEnum.includes(t.sideEffects)).map(({ id, t }) => `${id}.sideEffects=${t.sideEffects}`),
      空surfaces: tools.filter(({ t }) => !t.surfaces.length).map(({ id }) => id),          // 全空＝没人可达的死登记
      重复surfaces: tools.filter(({ t }) => new Set(t.surfaces).size !== t.surfaces.length).map(({ id }) => id),
    }).toEqual({ perm: [], sideEffects: [], 空surfaces: [], 重复surfaces: [] });
    // ⑤ 批次三第一档纪律（agent 线＝只读）→ 2026-10-19 用户拍板「写面全部放开」改写：
    //    mcp 面的副作用工具必须**逐颗等于拍板名单**（14 颗——多一颗少一颗都是契约漂移，
    //    ⛔ 顺着 surfaces 数组悄悄多挂一颗）。surfacesGlobal.mcp 的开闸事实源同颗锁可见。
    expect(api.surfacesGlobal.mcp).toBe(true);
    const MCP_WRITE = ['bindings.complete', 'bindings.materialize', 'bindings.set', 'circuits.toggle',
      'compile.compileAndShow', 'compile.completeBindings',
      'fs.createFile', 'fs.createFolder',
      'fs.delete', 'fs.duplicateFile', 'fs.duplicateFolder', 'fs.import', 'fs.move', 'fs.rename',
      'host.copyToSandbox', 'host.importLegacyData', 'host.saveExportFile', 'host.setDocBindings'];   // 2026-10-19 批次六「写面全部放开」12→18（逐颗＝拍板册，多一颗少一颗都红）
    expect(tools.filter(({ t }) => t.surfaces.includes('mcp') && t.sideEffects !== 'none')
      .map(({ id }) => id).sort()).toEqual(MCP_WRITE);
  });

  it('R160 API 层收编锁：UI 层（extension/bindingPanel）⛔ 直插 bindings 数据函数——一道门纪律的回潮哨', () => {
    // 账本卷六十九「乱源=树命令直插 sandboxFiles 绕过边界」的收尾：audit/complete/bindParts 的
    // 数据动作已改走 executeTool（bindings.audit/complete/get/set 工具）。这颗锁钉死回潮路：
    // UI 层的 './sandboxFiles' import 名单里再出现这四颗＝红（工具层 toolsDomain/dispatch 内部照旧合法）。
    // ⚠ \bsetBinding\b ⛔ 误伤 setBindingInDir（g|I 之间无词界）；读 import 块而非全文（注释里提名字⛔ 红）。
    const banned = ['collectInstanceHits', 'completeFromHits', 'bindingsForFile', 'setBinding'];
    for (const f of ['extension.ts', 'bindingPanel.ts']) {
      const src = fs.readFileSync(path.join(ROOT, 'extension/src', f), 'utf8');
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/sandboxFiles'/g)].map((m) => m[1]).join(',');
      expect(imports.length, `${f} 应确有 sandboxFiles import（⛔ 正则失配造成的空名单恒绿）`).toBeGreaterThan(0);
      const hit = banned.filter((b) => new RegExp(`\\b${b}\\b`).test(imports));
      expect(hit, `${f} 直插了工具层数据函数`).toEqual([]);
    }
  });

  it('面板释放登记只有**一处**，且在两条装载路共用的 wirePanel 里', () => {
    // 面板有两个来路：`openPanel`（开局自动/compileAndShow 复用）与 serializer（窗口重启恢复）。
    // 只挂在 openPanel 上时：恢复出面板 → 关掉 → `currentPanel` 仍指着已释放的那颗
    // ⇒ 再按命令走 `reveal()`＝"点了没反应"。所以这一颗登记⛔ 有两个主人。
    // ⚠ 判 extension.ts（装载线）；dispatch.ts 是能力路由，没有面板生命周期。
    const extensionSrc = fs.readFileSync(path.join(ROOT, 'extension/src/extension.ts'), 'utf8');
    expect((extensionSrc.match(/onDidDispose/g) || []).length).toBe(1);
    const wireAt = extensionSrc.indexOf('function wirePanel');
    expect(wireAt).toBeGreaterThan(-1);
    expect(extensionSrc.indexOf('onDidDispose')).toBeGreaterThan(wireAt);
  });
});

describe('域界一颗主人（片 C2：哪些文件算 Verilog / 算沙盒）', () => {
  const MASTER = ['projectStore.ts', 'verilogDomain.ts'];
  // ⚠ 只 ban「调用形状」：旧正则作为**历史对照**写在注释里（compilePanel/verilogDomain 各一句），
  //   禁项串被证人自己抄一份＝把尺撞在自己的文档上（名册 308 同族）。调用点必带 `.test(`/`findFiles('`。
  const BANNED = [
    "findFiles('**/*.v'", "findFiles('**/*.djs'",
    '(v|sv)$/i.test(', '(v|sv|djs)$/i.test(', '(v|sv|djs|gate)$/i.test(',
    "!== '.v'", 'replace(/\\.sv?$',
    '.slice(rootFs.length',                     // 根相对名⛔ 再有人按根串长度切（R153：那三份都交过坏值）
    '(v|djs)$/i.test(',                        // 沙盒域判定也⛔ 在别处自己写（X19 那颗就是它）
  ];

  it('extension/src 里除主人外⛔ 再有第二处写死的域判定（正件：主人的扫描真看得见＝这把尺⛔ 瞎）', () => {
    const dir = path.join(ROOT, 'extension/src');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !MASTER.includes(f));
    expect(files.length).toBeGreaterThan(10);                 // 射程空＝恒绿的假尺
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // ⚠ 形状的教训：`expect(msg, value)` ⛔ 是 vitest 的签名——那颗 msg 会被当成**被测值**，
      //   于是这把尺永远红（第一跑就是这样，报的还是字典序第一颗文件，看着像"那儿有主人"）。
      const hit = BANNED.filter((b) => src.includes(b));
      expect(`${f} → ${hit.join(' | ')}`).toBe(`${f} → `);
    }
    expect(fs.readFileSync(path.join(dir, 'verilogDomain.ts'), 'utf8').includes('findFiles(')).toBe(true);
  });

  it('manifest 里那第五、第六处域判定也吃同一颗名单：resourceExtname 的每条 when/keybinding 都含三域', () => {
    // 域界还会藏在声明式产物里：`contributes.menus` 的 when 与 `keybindings` 的 when。
    // 修前那里写的是 `/\.(v|sv)$/` ⇒ `.vh` 在资源管理器里没有右键项、Ctrl+F5 也没反应
    // （代码侧的门修好了，菜单这侧照旧隐身＝用户看到的还是"不支持 .vh"）。
    const raw = fs.readFileSync(path.join(ROOT, 'extension/package.json'), 'utf8');
    const clauses = raw.split('\n').filter((l) => l.includes('resourceExtname =~'));
    // R160（批1问题A）：Explorer 右键补齐 .v 侧绑定三项（bindParts/auditBindings/completeBindings）
    //   ⇒ 4 条涨到 7 条（4 菜单 + 1 键位 + 2 混合域）。
    expect(clauses.length).toBe(7);                      // 正件：射程非空
    for (const c of clauses) expect(['v', 'sv', 'vh'].filter((e) => !c.includes(`|${e}`))).toEqual([]);
  });

  it('主人口径逐颗现读：三域判定、fsPath 形状、剥扩展名（那颗读反的 .sv? 就是这颗钉的）', () => {
    expect(VERILOG_EXT).toEqual(['v', 'sv', 'vh']);
    expect(isVerilogPath('D:\\p\\lib\\alu.SV')).toBe(true);    // Windows 反斜杠 + 大写扩展都得认
    expect(isVerilogPath('defs.vh')).toBe(true);
    expect(isVerilogPath('a.djs')).toBe(false);
    expect(isSandboxPath('parts/画布.djs')).toBe(true);
    expect(isBindablePath('defs.vh')).toBe(true);
    expect(isBindablePath('parts/画布.djs')).toBe(true);         // 沙盒那一半也得测（⛔ 只验编译域＝这颗门瞎一半）
    expect(isBindablePath('notes.txt')).toBe(false);
    expect(isBindingTargetValue('legacy.gate')).toBe(true);     // 表里的旧 .gate 值⛔ 判废
    expect(stripVerilogExt('adder.v')).toBe('adder');           // 旧 `/\.sv?$/` 对 .v 原样返回＝静默零补全的根
    expect(stripVerilogExt('adder.sv')).toBe('adder');
    expect(stripVerilogExt('defs.vh')).toBe('defs');
    expect(stripVerilogExt('parts/alu')).toBe('parts/alu');     // 无域扩展＝原样
    expect(watcherGlobs().slice().sort()).toEqual(['**/*.djs', '**/*.sv', '**/*.v', '**/*.vh']);
  });
});

describe('根相对名一颗主人 rootRel（R153 深度自检：本仓曾有七份，三份按根串长度切）', () => {
  const U = (p: string) => vscode.Uri.file(p);

  it('根内／子目录／盘符大小写漂／中文段／根自己：一律交斜杠分隔的相对名', () => {
    expect(rootRel(U('D:/p'), U('D:/p/top.v'))).toBe('top.v');
    // 盘符大小写一漂正是那三份"按根串长度切"的死处（截出来的是一截尾巴或整颗绝对路径）
    expect(rootRel(U('D:/p'), U('d:/p/lib/adder.v'))).toBe('lib/adder.v');
    expect(rootRel(U('D:\\p'), U('D:\\p\\部件\\甲.djs'))).toBe('部件/甲.djs');
    expect(rootRel(U('D:/p'), U('D:/p'))).toBe('');            // 根自己＝空相对名（钉住这颗选择）
  });

  it('根外的 Uri 交回**绝对路径**（⛔ 折成相对名混进目录表的键里）', () => {
    const out = rootRel(U('D:/p'), U('D:/other/x.v'));
    expect(/^[a-zA-Z]:\//.test(out)).toBe(true);
    expect(out.endsWith('other/x.v')).toBe(true);
  });
});

describe('真宿主 E2E 启动器的那两颗 dev 旗标（kebab 会被基座静默丢弃）', () => {
  // 为什么这颗要存在：基座 argv 只认 `extensionDevelopmentPath`/`extensionTestsPath`（驼峰），
  // kebab 别名被**静默丢掉**——不报错、不开测试通道，整层真机测试死了 8 天没人看见（R139→R154）。
  // ⚠ 尺⛔ 扫全文：启动器文件头那段注释正是**解释这件事**的，里面写着 kebab 原形——
  //   拿整档做"禁项"判定＝把尺撞在自己的说明上（名册 308 同族）。所以只吃 `const args = [...]` 那一块。
  const src = fs.readFileSync(path.join(ROOT, 'extension/test-real-launch.mjs'), 'utf8');
  const argsBlock = /const args = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';

  it('args 里两颗都是驼峰形（⛔ kebab），且这块⛔ 是正则失配读出来的空串', () => {
    expect(argsBlock.length).toBeGreaterThan(20);                 // 失配＝空串，那下面两条会假绿
    expect(argsBlock).toContain("'--extensionDevelopmentPath'");
    expect(argsBlock).toContain("'--extensionTestsPath'");
    expect(argsBlock).not.toMatch(/--extension-(development|tests)-path/);
  });

  it('第一个位置参数是 app 目录（源码构建形状：%CODE% . %*），工作区紧随其后', () => {
    const first = argsBlock.split(',').map((s) => s.trim()).filter(Boolean)[0];
    expect(first).toBe("'.'");
  });
});
