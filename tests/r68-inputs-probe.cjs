// R68 探针（先拿读数，再决定改不改白名单）：
// digitaljs 的 n 元门（And/Or/Nand/Nor/Xor/Xnor = GateX1 族）在 **initialize 里**按
// `inputs` 生成 in1..inN 端口并把盒体设成 60*(n/2) × 32*(n/2)（bundle @2302908），
// 且 `inputs` 被列进 `_unsupportedPropChanges`（@2303863）⇒ 事后 set 会被回滚。
// r66 的参数清点发现沙盒存档把这颗键**整个丢掉**（Xnor 只剩 inputs 这一项）。
// 今天它是 2＝类默认值，所以往返看不出错；要判"丢了我有没有损失"，只能**喂一个不等于默认值的
// 存档**看它回不回得来 —— 这里用 sandboxStore.save 直接把 graphJson 里的 inputs 改成 4。
//
// 本脚本不作判定，只打四组读数：
//   [A] 画布上刚放下的 And：inputs / 端口 id 列表 / size
//   [B] 上游构造器直读：new cells.And({inputs:4}) 后的端口与 size（证 `inputs` 真是构造期参数）
//   [C] 存档里那颗 And 的全部键（证 inputs 没被序列化）
//   [D] 把存档里的 inputs 改成 4 → 重开文件 → 实际 inputs 与端口（4＝白名单认；2＝丢参数）
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1681; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'And');
    await sleep(700);

    const A = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getElements().find((e) => String(e.get('type')) === 'And');
      if (!c) return { noCell: true };
      const ports = (c.get('ports')?.items || []).map((x) => x.id);
      const sz = c.get('size');
      return { id: String(c.id), inputs: c.get('inputs') ?? null, bits: c.get('bits') ?? null, ports, size: sz && { width: sz.width, height: sz.height } };
    });
    console.log('[A] 画布上刚放下的 And =', J(A));

    const B = await page.evaluate(() => {
      const d = window.digitaljs;
      if (!d?.cells?.And) return { noCtor: true };
      const c = new d.cells.And({ inputs: 4, bits: 1, position: { x: 900, y: 900 } });
      return {
        inputs: c.get('inputs') ?? null,
        ports: (c.get('ports')?.items || []).map((x) => x.id),
        size: (() => { const s = c.get('size'); return s && { width: s.width, height: s.height }; })(),
      };
    });
    console.log('[B] 上游 new cells.And({inputs:4}) =', J(B));
    if (A.noCell) {
      console.log('画布上没有 And，后面三组读数不作数');
      await browser.close().catch(() => { }); server.kill(); UI.freePort(PORT); process.exit(0);
    }

    await page.evaluate(() => window.__sandboxSave && window.__sandboxSave());
    await sleep(900);
    const C = await page.evaluate(async (a) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      for (const f of sandboxStore.list()) {
        if (!f.graphJson) continue;
        let j; try { j = JSON.parse(f.graphJson); } catch { continue; }
        const c = (j.cells || []).find((x) => x.type === 'And' && String(x.id) === a.id);
        if (c) return { file: f.name, fileId: f.id, keys: Object.keys(c), inputs: c.inputs === undefined ? null : c.inputs };
      }
      return null;
    }, { id: A.id });
    console.log('[C] 存档里那颗 And 的键 =', J(C));

    // 把存档里的 inputs 改成 4（模拟"携带非默认 inputs 的 .djs"）
    const patched = await page.evaluate(async (a) => {
      const { sandboxStore } = await import('/src/store/sandboxStore.ts');
      const f = sandboxStore.list().find((x) => x.id === a.fileId);
      if (!f || !f.graphJson) return { err: 'no-file' };
      const j = JSON.parse(f.graphJson);
      const c = (j.cells || []).find((x) => x.type === 'And' && String(x.id) === a.id);
      if (!c) return { err: 'no-cell' };
      c.inputs = 4;
      sandboxStore.save(f.id, JSON.stringify(j));
      const back = sandboxStore.list().find((x) => x.id === f.id);
      const again = JSON.parse(back.graphJson).cells.find((x) => String(x.id) === a.id);
      return { wrote: again.inputs ?? null };
    }, { id: A.id, fileId: C && C.fileId });
    console.log('[D1] 改写存档后立刻回读 =', J(patched));

    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2600);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    if (!(await UI.backToSandbox(page))) console.log('[D2] 回不到沙盒画布，未验证');
    else if (!C || !C.file) console.log('[D2] 没有存档可读，未验证');
    else {
      await page.locator('span').filter({ hasText: String(C.file).replace(/\.djs$/, '') }).first().click();
      await sleep(1800);
      const D = await page.evaluate(async (a) => {
        let hint = null;
        if (!window.__sandboxPaper) {
          const { sandboxStore } = await import('/src/store/sandboxStore.ts');
          const f = sandboxStore.list().find((x) => x.graphJson && /"And"/.test(x.graphJson));
          if (f) hint = '存储里的候选文件=' + f.name;
        }
        const p = window.__sandboxPaper;
        if (!p) return { noPaper: true, hint };
        const c = p.model.getCell(a.id) || p.model.getElements().find((e) => String(e.get('type')) === 'And');
        if (!c) return { noCell: true, hint };
        return {
          hint,
          inputs: c.get('inputs') ?? null,
          ports: (c.get('ports')?.items || []).map((x) => x.id),
          size: (() => { const s = c.get('size'); return s && { width: s.width, height: s.height }; })(),
        };
      }, { id: A.id });
      console.log('[D2] 重开文件后 =', J(D), '（存档里写的是 inputs=4）');
    }
    console.log('[E] 页面异常 =', J(perr.slice(0, 3)));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 500));
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    UI.freePort(PORT);
  }
})();
