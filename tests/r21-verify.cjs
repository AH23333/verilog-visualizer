// R21 验收：第二批器件 —— Mux / 比较器 / 移位 / 取负 + 右键属性编辑
//  1) 调色板放置 Mux（自动 sel/out/in0/in1 端口）
//  2) Mux 功能：sel=0 选 in0，sel=1 选 in1
//  3) 比较器：Eq 2==2→1，Lt 3<2→0，Gt 3>2→1
//  4) 移位：1 左移 2 位 = 4
//  5) 取负：2 → -2 mod 16 = 14
//  6) 右键编辑常量值（Constant change:constant 自动更新位宽/端口并传播）
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1492;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
const realClickGate = async (page, label) => {
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click(); await sleep(500);
};
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(600);
  return true;
}
// 在浏览器上下文里读取向量（含 x 时回退 toString）
const READ_FN = `function vec(v){ if(v==null) return 'n/a'; try{ if(typeof v.toBigInt==='function'){ const b=v.toBigInt(); if(b!=null&&Number.isFinite(Number(b))) return String(b);} }catch(e){} return v.toString(); }`;
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    // ===== [1] 放置 Mux =====
    console.log('\n===== [1] 放置多路选择器 =====');
    await realClickGate(page, 'Mux');
    const mux = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Mux');
      return c ? { id: c.id, ports: (c.getPorts?.() || []).map(x => x.id).sort() } : null;
    });
    console.log('    Mux:', JSON.stringify(mux));
    (mux && ['in0','in1','out','sel'].every(x => mux.ports.includes(x)))
      ? ok('[1] 调色板放置 Mux 且端口齐全', mux.ports.join(','))
      : bad('[1] Mux 放置/端口异常', JSON.stringify(mux));

    // ===== [2] Mux 功能 =====
    console.log('\n===== [2] Mux 选择功能 =====');
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      return {
        c0: add('Constant', { type: 'Constant', constant: '1', position: { x: 120, y: 100 } }),
        c1: add('Constant', { type: 'Constant', constant: '0', position: { x: 120, y: 220 } }),
        sel: add('Input', { type: 'Input', bits: 1, position: { x: 120, y: 340 } }),
      };
    });
    await sleep(600);
    const w2 = [];
    w2.push(await wire(page, ids2.c0, 'out', mux.id, 'in0'));
    w2.push(await wire(page, ids2.c1, 'out', mux.id, 'in1'));
    w2.push(await wire(page, ids2.sel, 'out', mux.id, 'sel'));
    await sleep(800);
    const readOut = (id) => page.evaluate(`(() => { const p = window.__sandboxPaper; const o = p.model.getCell('${id}')?.get('outputSignals'); const v = o?.out; ${READ_FN}; return vec(v); })()`);
    const out0 = await readOut(mux.id);
    console.log('    sel=0 时 out =', out0, ' 连线:', JSON.stringify(w2));
    await clickInputSel();
    async function clickInputSel() {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, ids2.sel);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const out1 = await readOut(mux.id);
    console.log('    点击 sel（0→1）后 out =', out1);
    (out0 === '1' && out1 === '0')
      ? ok('[2] Mux 按选择端正确切换 in0/in1', `sel=0→${out0}, sel=1→${out1}`)
      : bad('[2] Mux 选择异常', `sel=0→${out0}, sel=1→${out1}`);

    // ===== [3] 比较器 =====
    console.log('\n===== [3] 比较器 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    const ids3 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      return {
        a: add('Constant', { type: 'Constant', constant: '0010', position: { x: 100, y: 150 } }),
        b2: add('Constant', { type: 'Constant', constant: '0010', position: { x: 100, y: 260 } }),
        b3: add('Constant', { type: 'Constant', constant: '0011', position: { x: 100, y: 370 } }),
        eq: add('Eq', { type: 'Eq', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 150 } }),
        lt: add('Lt', { type: 'Lt', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 260 } }),
        gt: add('Gt', { type: 'Gt', bits: { in1: 4, in2: 4 }, position: { x: 380, y: 370 } }),
      };
    });
    await sleep(600);
    const w3 = [];
    w3.push(await wire(page, ids3.a, 'out', ids3.eq, 'in1'));
    w3.push(await wire(page, ids3.b2, 'out', ids3.eq, 'in2'));
    w3.push(await wire(page, ids3.b3, 'out', ids3.lt, 'in1'));
    w3.push(await wire(page, ids3.b2, 'out', ids3.lt, 'in2'));
    w3.push(await wire(page, ids3.b3, 'out', ids3.gt, 'in1'));
    w3.push(await wire(page, ids3.b2, 'out', ids3.gt, 'in2'));
    await sleep(1000);
    const cmp = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const rd = (id) => { const o = p.model.getCell(id)?.get('outputSignals'); const v = o?.out; if (!v) return 'n/a'; try { if (typeof v.toBigInt === 'function') { const b = v.toBigInt(); if (b != null && Number.isFinite(Number(b))) return String(b); } } catch (e) {} return v.toString(); };
      return { eq: rd(ids.eq), lt: rd(ids.lt), gt: rd(ids.gt) };
    }, ids3);
    console.log('    比较结果:', JSON.stringify(cmp), ' 连线:', JSON.stringify(w3));
    (cmp.eq === '1' && cmp.lt === '0' && cmp.gt === '1')
      ? ok('[3] 比较器 Eq/Lt/Gt 输出正确', JSON.stringify(cmp))
      : bad('[3] 比较器输出异常', JSON.stringify(cmp));

    // ===== [4] 移位 + 取负 =====
    console.log('\n===== [4] 移位与取负 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    const ids4 = await page.evaluate(() => {
      const p = window.__sandboxPaper, dj = window.digitaljs;
      const add = (C, args) => { const c = new dj.cells[C](args); p.model.addCell(c); return c.id; };
      return {
        s1: add('Constant', { type: 'Constant', constant: '0001', position: { x: 100, y: 150 } }),
        sh: add('Constant', { type: 'Constant', constant: '10', position: { x: 100, y: 260 } }),
        sl: add('ShiftLeft', { type: 'ShiftLeft', bits: { in1: 4, in2: 2, out: 4 }, position: { x: 380, y: 150 } }),
        n_in: add('Constant', { type: 'Constant', constant: '0010', position: { x: 100, y: 400 } }),
        neg: add('Negation', { type: 'Negation', bits: { in: 4, out: 4 }, position: { x: 380, y: 400 } }),
      };
    });
    await sleep(600);
    const w4 = [];
    w4.push(await wire(page, ids4.s1, 'out', ids4.sl, 'in1'));
    w4.push(await wire(page, ids4.sh, 'out', ids4.sl, 'in2'));
    w4.push(await wire(page, ids4.n_in, 'out', ids4.neg, 'in'));
    await sleep(1000);
    const sr = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const rd = (id) => { const o = p.model.getCell(id)?.get('outputSignals'); const v = o?.out; if (!v) return 'n/a'; try { if (typeof v.toBigInt === 'function') { const b = v.toBigInt(); if (b != null && Number.isFinite(Number(b))) return String(b); } } catch (e) {} return v.toString(); };
      return { shift: rd(ids.sl), neg: rd(ids.neg) };
    }, ids4);
    console.log('    移位/取负:', JSON.stringify(sr), ' 连线:', JSON.stringify(w4));
    (sr.shift === '4' && sr.neg === '14')
      ? ok('[4] 左移 1<<2=4、取负 2→14（模 16）', JSON.stringify(sr))
      : bad('[4] 移位/取负输出异常', JSON.stringify(sr));

    // ===== [5] 右键编辑常量值 =====
    console.log('\n===== [5] 右键编辑常量值 =====');
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);
    await realClickGate(page, 'Constant'); await realClickGate(page, 'Lamp');
    const ids5 = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await wire(page, ids5.Constant[0], 'out', ids5.Lamp[0], 'in');
    // 右键常量 → 常量值 → 输入 1
    const pt = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      const r = v.el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ids5.Constant[0]);
    await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(600);
    const hasInput = await page.evaluate(() => !!document.querySelector('input[placeholder="二进制，如 1010"]'));
    console.log('    右键菜单含常量值输入 =', hasInput);
    if (hasInput) {
      await page.fill('input[placeholder="二进制，如 1010"]', '1');
      await page.keyboard.press('Enter'); await sleep(900);
      const lamp = await page.evaluate((id) => {
        const p = window.__sandboxPaper;
        const o = p.model.getCell(id)?.get('inputSignals'); const v = o?.in;
        const lv = p.model.getCell(id)?.findView(p)?.el?.querySelector?.('.led');
        return { in: v ? v.toString() : 'n/a', led: lv ? getComputedStyle(lv).fill : null };
      }, ids5.Lamp[0]);
      console.log('    修改常量后 灯:', JSON.stringify(lamp));
      (/3, 192, 60|#03c03c/.test(lamp.led))
        ? ok('[5] 右键修改常量值立即生效并传播', JSON.stringify(lamp))
        : bad('[5] 常量值修改未生效', JSON.stringify(lamp));
    } else bad('[5] 右键菜单没有常量值输入');

    console.log('\n  pageerrors:', JSON.stringify(errors.slice(0, 4)));
    console.log(`\n===== R21 DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(0); }
})();
