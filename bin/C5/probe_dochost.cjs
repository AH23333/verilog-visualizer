// 只读探针（片 C5）：假宿主 + doc.html 这条路**到底通不通**，先打现场再改闸门。
// 判据＝三问，逐条打读数（这颗⛔ 是闸门：它没有 PASS/FAIL 断言，只交读数——名册「纯读数探针不进跑批」）：
//  ① doc.html 在假宿主下挂得出画布吗（`__sandboxPaper`）；
//  ② 从调色板真点一颗门进去，DocApp 会不会把**全量序列化串**经 `{vvh:'doc',op:'edit'}` 交给宿主；
//  ③ 刷新（同 seedId＝磁盘不动）后，那颗门还在不在画布上——这是「保存→刷新→重开」第一次能在浏览器里判。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const UI = require(path.join(ROOT, 'tests', '_ui.cjs'));
const DH = require(path.join(ROOT, 'tests', '_dochost.cjs'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1561;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED_ID = 'probe' + Date.now();
const DOC = 'parts/probe_main.djs';

(async () => {
  let server, browser;
  try {
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'pipe' });
    const dl = Date.now() + 40000; while (Date.now() < dl) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const perr = [];
    page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    page.on('console', (m) => { if (m.type() === 'error') perr.push('[console] ' + (m.text() || '').slice(0, 140)); });

    await DH.installFakeHost(page, {
      seedId: SEED_ID, docName: DOC,
      files: { [DOC]: JSON.stringify({ cells: [] }) },
    });
    await DH.bootDoc(page, PORT);
    const canvasNow = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return { paper: !!p, cells: p ? p.model.getCells().length : -1, sidebar: !!document.querySelector('[data-sandbox-sidebar]') };
    });
    console.log('[1] doc.html 挂载:', JSON.stringify(canvasNow), '| 假宿主:', JSON.stringify(await DH.fakeHostReadout(page)));

    // ② 真点一颗门（走 UI.ensurePalette + UI.clickGate 这两把既有锚点）
    await UI.ensurePalette(page);
    const before = await page.evaluate(() => (window.__sandboxPaper ? window.__sandboxPaper.model.getElements().length : -1));
    await UI.clickGate(page, 'And');
    await sleep(1600);
    const after = await page.evaluate(() => (window.__sandboxPaper ? window.__sandboxPaper.model.getElements().length : -1));
    const readout = await DH.fakeHostReadout(page);
    console.log('[2] 放置:', JSON.stringify({ before, after }), '| edit 流水:', JSON.stringify({
      edits: readout && readout.edits, docMessages: readout && readout.docMessages,
      落盘正文里有And: readout && /"And"/.test(String(readout.files[DOC] || '')),
    }));

    // ③ 刷新＝同 seedId（磁盘⛔ 重铺），看画布是否从"盘上正文"长回来
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 30000 }).catch(() => { });
    await sleep(2500);
    const reopened = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return {
        paper: !!p,
        elements: p ? p.model.getElements().length : -1,
        types: p ? p.model.getElements().map((c) => String(c.get('type'))) : [],
      };
    });
    const readout2 = await DH.fakeHostReadout(page);
    console.log('[3] 刷新重开:', JSON.stringify(reopened), '| 盘上正文颗数:',
      JSON.stringify(Object.keys((readout2 && readout2.files) || {})));
    console.log('[4] 页面异常/错误读数:', JSON.stringify(perr.slice(0, 6)), `共 ${perr.length} 条`);
    console.log('[读数小结] 挂载=' + canvasNow.paper + ' 放置前后=' + before + '→' + after
      + ' 重开后=' + reopened.elements + ' 落盘含And=' + (readout && /"And"/.test(String(readout.files[DOC] || ''))));
  } catch (e) { console.log('FATAL', e); } finally {
    try { browser && await browser.close(); } catch { }
    try { server && server.kill(); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
    process.exit(0);
  }
})();
