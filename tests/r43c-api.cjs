// 缩放锚点公式对照：三种候选公式，用 clientToLocalPoint 量残差（越小越对）
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1536; const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
(async () => {
  let s, b;
  try {
    s = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const d = Date.now() + 30000; while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) break; } catch { } await sleep(400); }
    b = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
    page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    for (const f of ['adder.v', 'full_adder.v']) {
      await page.evaluate(async (a) => { const { fileStore } = await import('/src/store/fileStore.ts'); const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); }, { n: f, c: rd(f) });
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(700);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    for (let i = 0; i < 60; i++) { await sleep(700); const done = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll()[0]; return !!(f && f.status === 'compiled' && f.circuitJson); }); if (done) break; }
    await sleep(2500);
    const r = await page.evaluate(() => {
      const p = window.__djsDebug.getPaper();
      const rect = p.el.getBoundingClientRect();
      const H = rect.height, W = rect.width;
      const out = [];
      const k = 1.3;
      const trials = [
        // A: 现状 —— 两轴都用「元素内坐标」直接当锚点
        { name: 'A 现状(元素内坐标)', fn: (ax, ay) => { const cx = ax - rect.left, cy = ay - rect.top; const t = p.translate(); p.translate(t.tx + cx - (cx - t.tx) * k, t.ty + cy - (cy - t.ty) * k); } },
        // B: y 用翻转后的锚点（joint 的 SVG 有 y 轴翻转）
        { name: 'B y 翻转', fn: (ax, ay) => { const cx = ax - rect.left, cy = H - (ay - rect.top); const t = p.translate(); p.translate(t.tx + cx - (cx - t.tx) * k, t.ty + cy - (cy - t.ty) * k); } },
        // C: 用 localToClientPoint 反解（不依赖手写公式）
        { name: 'C 先测后补', fn: (ax, ay) => { const before = p.clientToLocalPoint(ax, ay); const cur = p.scale().sx; p.scale(cur * k, cur * k); const after = p.clientToLocalPoint(ax, ay); const t = p.translate(); p.translate(t.tx + (after.x - before.x) * cur * k, t.ty - (after.y - before.y) * cur * k); } },
        { name: 'D joint scale(带原点)', fn: (ax, ay) => { const before = p.clientToLocalPoint(ax, ay); const cur = p.scale().sx; p.scale(cur * k, cur * k, before.x, before.y); } },
        { name: 'E joint scale(flat 原点)', fn: (ax, ay) => { const before = p.clientToLocalPoint(ax, ay); const cur = p.scale().sx; const f = p.getArea ? p.getArea() : null; p.scale(cur * k, cur * k, before.x, f ? f.height - before.y : before.y); } },
        { name: 'F C 的 y 取正号', fn: (ax, ay) => { const before = p.clientToLocalPoint(ax, ay); const cur = p.scale().sx; p.scale(cur * k, cur * k); const after = p.clientToLocalPoint(ax, ay); const t = p.translate(); p.translate(t.tx + (after.x - before.x) * cur * k, t.ty + (after.y - before.y) * cur * k); } },
        { name: 'G 先 scale 再 translate(正)', fn: (ax, ay) => { const before = p.clientToLocalPoint(ax, ay); const cur = p.scale().sx; const t0 = p.translate(); p.translate(t0.tx + ax - rect.left - (ax - rect.left - t0.tx) * k, t0.ty + (H - (ay - rect.top)) - (H - (ay - rect.top) - t0.ty) * k); p.scale(cur * k, cur * k); } },
      ];
      for (const anchor of [[0.3, 0.7], [0.5, 0.5], [0.85, 0.15]]) {
        const cx = rect.left + W * anchor[0], cy = rect.top + H * anchor[1];
        for (const tr of trials) {
          p.scale(1, 1); p.translate(0, 0);
          const before = p.clientToLocalPoint(cx, cy);
          const rectBefore = [Math.round(p.el.getBoundingClientRect().left), Math.round(p.el.getBoundingClientRect().top)];
          try { tr.fn(cx, cy); } catch (e) { out.push({ anchor, name: tr.name, err: String(e.message).slice(0, 60) }); continue; }
          const re = p.clientToLocalPoint(cx, cy);
          out.push({
            anchor: anchor.map((v) => v.toFixed(2)).join('/'), name: tr.name,
            driftPx: +Math.hypot(re.x - before.x, re.y - before.y).toFixed(1),
            dx: +(re.x - before.x).toFixed(1), dy: +(re.y - before.y).toFixed(1),
            rectMoved: [Math.round(p.el.getBoundingClientRect().left) - rectBefore[0], Math.round(p.el.getBoundingClientRect().top) - rectBefore[1]],
            scaleNow: +p.scale().sx.toFixed(3),
          });
        }
      }
      return out;
    });
    for (const row of r) console.log(JSON.stringify(row));
  } catch (e) { console.log('FATAL', e); } finally { try { await b && b.close(); } catch { } try { s && s.kill(); } catch { } process.exit(0); }
})();
