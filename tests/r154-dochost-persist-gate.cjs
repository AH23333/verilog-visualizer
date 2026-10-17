// R154 新增闸门：`.djs` 文档在**真产品路径**上的持久化闭环（浏览器侧，经假宿主）
//
// 为什么要有这颗：`qc-realuser`/`qc-paused`/`qc-preview` 那一族量的是"保存→刷新→重开不丢"，
// 但它们的地板是**旧 React 单页 + localStorage 沙盒库**——那颗主人已随片 5 退役，
// 而今天 `.djs` 的真身是工作区文件、编辑器是 `doc.html`（custom editor）。⇒ 这条最关键的用户承诺
// 一度⛔ 任何自动化覆盖（只剩真机点验）。
// 落点＝`tests/_dochost.cjs` 那颗假宿主：它按 `dispatch.ts`/`customEditors.ts` 的同一条线协议说话，
// 文件表落 localStorage 键 `vv-fake-fs` 跨 reload 存活 ⇒「编辑→commit→刷新→重开」能在浏览器里真判，
// 而测的是 **DocApp + SandboxCanvas 这两颗产品代码本体**（⛔ 退役单页、⛔ 我另写一套画布）。
//
//  [1] doc.html 在假宿主下挂得出画布（`__sandboxPaper` + 沙盒侧栏）
//  [2] 从部件库真点一颗 And ⇒ 画布器件 +1（走的是 DOM 点击，⛔ 调内部 API）
//  [3] DocApp 把**全量序列化串**经 `{vvh:'doc',op:'edit'}` 交给宿主，且落盘正文里找得到那颗 And
//  [4] 同 seedId 刷新（＝磁盘⛔ 重铺）⇒ 那颗还长回画布上：持久化闭环
//  [5] 反向臂：换 seedId 重铺磁盘 ⇒ 那颗**必须消失**——没有这一格，[4] 可能只是同页内存没清干净
//  [6] 全程无 pageerror
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const UI = require('./_ui.cjs');
const DH = require('./_dochost.cjs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1562;
const URL = `http://localhost:${PORT}/`;
try { process.on('exit', () => UI.reapViteByPort(PORT)); } catch { }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC = 'parts/r154_persist.djs';
const EMPTY = JSON.stringify({ cells: [] });
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  let server, browser, fatal = false;
  try {
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'pipe' });
    const dl = Date.now() + 40000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const perr = [];
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    page.on('console', (m) => { if (m.type() === 'error') perr.push('[console] ' + (m.text() || '').slice(0, 140)); });

    const seedId = 'r154' + Date.now();
    await DH.installFakeHost(page, { seedId, docName: DOC, files: { [DOC]: EMPTY } });
    await DH.bootDoc(page, PORT);
    const mounted = await page.evaluate(() => ({
      paper: !!window.__sandboxPaper,
      sidebar: !!document.querySelector('[data-sandbox-sidebar]'),
      cells: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : -1,
      gates: document.querySelectorAll('button[data-gate]').length,
    }));
    (mounted.paper && mounted.sidebar && mounted.gates > 0)
      ? ok('[1] doc.html 在假宿主下挂载（产品那颗 custom editor 本体）', `器件 ${mounted.cells} 颗 / 部件库 ${mounted.gates} 颗`)
      : bad('[1] doc.html 没挂起来', JSON.stringify(mounted));

    const before = await page.evaluate(() => (window.__sandboxPaper ? window.__sandboxPaper.model.getElements().length : -1));
    await UI.clickGate(page, 'And');
    await sleep(1800);
    const after = await page.evaluate(() => (window.__sandboxPaper ? window.__sandboxPaper.model.getElements().length : -1));
    (before >= 0 && after === before + 1)
      ? ok('[2] 从部件库点一颗 And ⇒ 画布 +1（走 DOM，⛔ 调内部 API）', `${before} → ${after}`)
      : bad('[2] 点了部件库而画布没多器件', JSON.stringify({ before, after }));

    await sleep(1200);                       // DocApp 的 commit 是 300ms debounce，给它落盘的时间
    const ro = await DH.fakeHostReadout(page);
    const body = ro && String(ro.files[DOC] || '');
    (ro && ro.docMessages.includes('ready') && ro.docMessages.includes('edit') && ro.edits >= 1 && /"And"/.test(body))
      ? ok('[3] DocApp 把全量序列化串经 doc/edit 交给宿主，落盘正文里找得到那颗 And',
        `edits=${ro.edits} doc流水=${JSON.stringify(ro.docMessages)} 正文 ${body.length}B`)
      : bad('[3] 编辑没走到宿主（或落盘正文⛔ 含那颗器件）', JSON.stringify({ ro: ro && { edits: ro.edits, docMessages: ro.docMessages }, 正文头: body.slice(0, 60) }));
    // 顺带钉一道形状：交出去的必须是 `cells` 画布格式（loadCells 要的形状），⛔ 编译格式
    (/^\{"cells":\s*\[/.test(body.replace(/\s/g, '')) || /"cells":\[/.test(body))
      ? ok('[3b] 落盘正文是画布 `{cells:[…]}` 形状（与 `sandboxSerialize`/`loadCells` 同一种子）')
      : bad('[3b] 落盘正文形状不对（画布打不开的那种）', body.slice(0, 80));

    // [4] 同 seedId 刷新＝磁盘⛔ 重铺 ⇒ 那颗必须从"盘上正文"长回来（这才是"保存→重开不丢"）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 30000 }).catch(() => { });
    await sleep(2600);
    const reopened = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { paper: !!p, elements: p ? p.model.getElements().length : -1, types: p ? p.model.getElements().map((c) => String(c.get('type'))) : [] };
    });
    (reopened.paper && reopened.elements >= 1 && reopened.types.includes('And'))
      ? ok('[4] 刷新重开：画布从盘上正文长回来（器件还在、类型对）', `elements=${reopened.elements} types=${JSON.stringify(reopened.types)}`)
      : bad('[4] 刷新后画布空了＝保存的正文没回到编辑器', JSON.stringify(reopened));

    // [5] 反向臂：把**盘上正文换回空档**（这颗假宿主的文件表就是磁盘，直写＝模拟另一个进程改了那颗文件，
    // 真壳里对应"用户在编辑器外改了 .djs"）⇒ 画布必须跟着变空。
    // 没这一格，[4] 可能只是同一页的内存/缓存没清干净（"保存重开"读成假绿的那条路）。
    // ⚠ ⛔ 用"再装一次假宿主、换个 seedId"的做法：`addInitScript` 是**累加**的，
    //   第二颗装上后两把脚本都会跑，先注册那颗会把磁盘又铺回去——那不是"换磁盘"而是我自己造脏。
    await page.evaluate((k) => {
      const fs = JSON.parse(localStorage.getItem('vv-fake-fs') || '{}');
      fs[k] = JSON.stringify({ cells: [] });
      localStorage.setItem('vv-fake-fs', JSON.stringify(fs));
    }, DOC);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 30000 }).catch(() => { });
    await sleep(2600);
    const fresh = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { paper: !!p, elements: p ? p.model.getElements().length : -1 };
    });
    const roFresh = await DH.fakeHostReadout(page);
    (fresh.paper && fresh.elements === 0 && /"cells":\s*\[\s*\]/.test(String((roFresh && roFresh.files[DOC]) || '')))
      ? ok('[5] 反向臂：盘上正文换回空档后画布跟着变空（证明 [4] 读的是磁盘，⛔ 同页内存）', `elements=${fresh.elements}`)
      : bad('[5] 盘已换空而画布还摆着那颗＝[4] 读的⛔ 是磁盘', JSON.stringify({ fresh, 正文: String((roFresh && roFresh.files[DOC]) || '').slice(0, 60) }));

    perr.length === 0
      ? ok('[6] 全程无页面异常')
      : bad('[6] 存在页面异常', JSON.stringify(perr.slice(0, 4)));
  } catch (e) { console.log('FATAL', e); fatal = true; } finally {
    try { browser && await browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
    console.log(`\n== R154 doc 持久化闸门: ${pass} PASS / ${fail} FAIL${fatal ? ' + FATAL' : ''} ==`);
    process.exit(fail > 0 || fatal ? 1 : 0);
  }
})();
