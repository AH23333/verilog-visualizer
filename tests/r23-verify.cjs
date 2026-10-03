// R23 验收：存储器（RAM）+ 内置示例电路
//  1) 放置 Memory：端口齐全（rd0addr/rd0data/rd0clk + wr0data/wr0addr/wr0clk）
//  2) 真实读写仿真：手动时钟把 data=1 写入 addr0 → 读口输出 1 灯亮；再写 0 → 灯灭
//  3) 插入示例·半加器：拨 A/B，和/进位两灯正确
//  4) 插入示例·4 位计数器：时钟自动跑，Dff 输出确定且随时间翻转
//  5) Memory 持久化：保存/重载后端口仍在
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1476;
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
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
const clickBody = async (page, id) => {
  const pt = await page.evaluate((id) => {
    const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
    const r = v.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.click(pt.x, pt.y); await sleep(650);
};
const vecOf = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper;
  const v = p.model.getCell(id)?.get('outputSignals')?.out;
  return v ? v.toString() : 'n/a';
}, id);
// 示例器件 id 带插入批号（exA_1、exD0_2…），按「前缀+批号」精确匹配
// （不能裸用 startsWith：exA 会撞上 exAnd）
const exId = async (page, prefix) => page.evaluate((pfx) => {
  const re = new RegExp('^' + pfx + '_\\d+$');
  const hits = window.__sandboxPaper.model.getCells().filter(c => !c.isLink() && re.test(String(c.id)));
  return hits.length === 1 ? hits[0].id : null;
}, prefix);
// 通过多位 Input 自带的 valinput 输入框设置数值（digitaljs 原生交互）
const setInputVal = async (page, id, val) => page.evaluate(({ id, val }) => {
  const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
  const e = v.el.querySelector('.valinput input');
  if (!e) return false;
  e.value = val;
  e.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { id, val });
const menuClick = async (page, label, exact = true) => {
  // 菜单项是按钮文本（可能拼接英文 hint），用包含匹配
  const loc = exact
    ? page.locator(`button:text-is("${label}")`)
    : page.locator(`button:has-text("${label}")`);
  await loc.first().click(); await sleep(400);
};
// 走真实右键菜单改器件位宽（openCellMenu → 位宽 input → Enter）
const setBits = async (page, id, n) => {
  const pt = await page.evaluate((id) => {
    const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
    const r = v.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
  const inp = page.locator('input[placeholder="bits"]');
  await inp.fill(String(n)); await sleep(150);
  await inp.press('Enter'); await sleep(500);
  await page.keyboard.press('Escape'); await sleep(300);
};
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    // PROD=1 时跑生产构建（vite preview serve dist），否则 dev server
    const PROD = !!process.env.PROD;
    server = PROD
      ? spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, stdio: 'pipe' })
      : spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
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

    // ===== [1] 放置 Memory =====
    console.log('\n===== [1] 放置存储器 =====');
    await realClickGate(page, 'Memory');
    const mem = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Memory');
      if (!c) return null;
      const ports = (c.getPorts?.() || []).map(x => `${x.id}(b${typeof x.bits === 'object' ? JSON.stringify(x.bits) : x.bits})`).sort();
      const v = c.findView(p); const r = v?.el?.getBoundingClientRect();
      return { id: c.id, ports, w: r ? Math.round(r.width) : -1, h: r ? Math.round(r.height) : -1 };
    });
    console.log('    Memory:', JSON.stringify(mem));
    const need = ['rd0addr', 'rd0data', 'rd0clk', 'wr0addr', 'wr0data', 'wr0clk'];
    (mem && need.every(n => mem.ports.some(p => p.startsWith(n))) && mem.h >= 80)
      ? ok('[1] Memory 端口齐全且渲染高度正常', `${mem.ports.join(',')} ${mem.w}x${mem.h}`)
      : bad('[1] Memory 端口/尺寸异常', JSON.stringify(mem));

    // ===== [2] 读写仿真：手动时钟写 1 → 读出灯亮；再写 0 → 灯灭 =====
    console.log('\n===== [2] Memory 读写仿真 =====');
    for (const t of ['Input', 'Input', 'Input', 'Lamp']) await realClickGate(page, t);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    await sleep(400);
    // 地址端口是 2 位宽（abits=2），走真实右键菜单把 Input[0] 改成 2 位再连线
    await setBits(page, ids.Input[0], 2);
    const addrBits = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const c = p.model.getCell(id);
      const v = c.get('outputSignals')?.out;
      return { bits: c.get('bits'), portBits: c.getPort?.('out')?.bits, sig: v ? v.toString() : 'undefined' };
    }, ids.Input[0]);
    console.log('    地址引脚改 2 位后:', JSON.stringify(addrBits));
    (addrBits.bits === 2 && addrBits.portBits === 2 && !/x/.test(addrBits.sig))
      ? ok('[2-pre] 右键改 Input 位宽 1→2 生效（端口同步、输出重置为 00 可点击）', JSON.stringify(addrBits))
      : bad('[2-pre] Input 位宽修改未生效或输出仍是 x', JSON.stringify(addrBits));
    // addrIn 同时接 wr0addr 与 rd0addr；dataIn → wr0data；clkIn → 两个 clk；rd0data → Lamp
    let wok = true;
    wok = await wire(page, ids.Input[0], 'out', mem.id, 'wr0addr') && wok;
    wok = await wire(page, ids.Input[0], 'out', mem.id, 'rd0addr') && wok;
    wok = await wire(page, ids.Input[1], 'out', mem.id, 'wr0data') && wok;
    wok = await wire(page, ids.Input[2], 'out', mem.id, 'wr0clk') && wok;
    wok = await wire(page, ids.Input[2], 'out', mem.id, 'rd0clk') && wok;
    wok = await wire(page, mem.id, 'rd0data', ids.Lamp[0], 'in') && wok;
    const links = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    连线成功:', JSON.stringify(wok), 'links =', links);
    (wok && links === 6) ? ok('[2a] 六条连线全部建立（含共享地址/时钟）') : bad('[2a] 连线不完整', `links=${links}`);

    // 初始全 0。同步读：写入上升沿读到的还是旧值，第二拍才见新值 → 每次写后补一拍再断言
    await clickBody(page, ids.Input[1]);           // data: 0 → 1
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（上升沿，写入 1）
    await clickBody(page, ids.Input[2]);           // clk: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（第二拍，读出新值）
    await sleep(400);
    const lampOn = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const v = p.model.getCell(id)?.get('inputSignals')?.in;
      return v ? v.toString() : 'n/a';
    }, ids.Lamp[0]);
    console.log('    写 1 后 读出(灯):', JSON.stringify(lampOn));
    /1/.test(lampOn) ? ok('[2b] 写入 1 后读口输出 1（灯亮）', lampOn) : bad('[2b] 写入未生效', lampOn);

    await clickBody(page, ids.Input[1]);           // data: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（上升沿，写入 0）
    await clickBody(page, ids.Input[2]);           // clk: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（第二拍，读出新值）
    await sleep(400);
    const lampOff = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const v = p.model.getCell(id)?.get('inputSignals')?.in;
      return v ? v.toString() : 'n/a';
    }, ids.Lamp[0]);
    console.log('    写 0 后 读出(灯):', JSON.stringify(lampOff));
    /0/.test(lampOff) ? ok('[2c] 覆盖写 0 后读口输出 0（灯灭）', lampOff) : bad('[2c] 覆盖写未生效', lampOff);

    // ===== [2d] 多位地址访问：valinput 设 addr=2 → 写读第 2 字 =====
    console.log('\n===== [2d] 多位地址访问 =====');
    const okVal = await setInputVal(page, ids.Input[0], '2');
    await sleep(400);
    const addrNow = await vecOf(page, ids.Input[0]);
    console.log('    addr 经 valinput 设 2 →', JSON.stringify(addrNow), ' valinput 可用:', okVal);
    (okVal && /10/.test(addrNow.replace('Vector3vl ', '')))
      ? ok('[2d-pre] 2 位引脚 valinput 输入生效（addr=10）', addrNow)
      : bad('[2d-pre] valinput 输入未生效', `${okVal} ${addrNow}`);
    // data 0→1；clk 当前为 1 → 产生写沿与第二拍读沿
    await clickBody(page, ids.Input[1]);           // data: 0 → 1
    await clickBody(page, ids.Input[2]);           // clk: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（写 addr=2 ← 1）
    await clickBody(page, ids.Input[2]);           // clk: 1 → 0
    await clickBody(page, ids.Input[2]);           // clk: 0 → 1（第二拍读出）
    await sleep(400);
    const lampW2 = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const v = p.model.getCell(id)?.get('inputSignals')?.in;
      return v ? v.toString() : 'n/a';
    }, ids.Lamp[0]);
    console.log('    字 2 写 1 后 读出(灯):', JSON.stringify(lampW2));
    /1/.test(lampW2) ? ok('[2d] addr=2 写 1 读 1 —— 多位地址可访问，存储器全功能', lampW2)
                     : bad('[2d] 多位地址读写失败', lampW2);

    // ===== [3] 插入示例·半加器 =====
    console.log('\n===== [3] 插入示例：半加器 =====');
    // 在画布空白处右键
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);       // 打开二级菜单
    await menuClick(page, '半加器', false);
    await sleep(800);
    // 插入后 id 带批号（exA_1…），按前缀唯一查找
    const haIds = {};
    for (const pfx of ['exA', 'exB', 'exXor', 'exAnd', 'exLs', 'exLc']) haIds[pfx] = await exId(page, pfx);
    const ha = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const found = Object.values(ids).filter(Boolean).length;
      return { found, links: p.model.getLinks().length };
    }, haIds);
    console.log('    半加器元件:', JSON.stringify(ha), JSON.stringify(haIds));
    (ha.found === 6 && ha.links >= 6) ? ok('[3a] 半加器 6 元件 + 连线插入') : bad('[3a] 示例插入不完整', JSON.stringify(ha));
    // 拨 A=1,B=1：S=0, C=1
    await clickBody(page, haIds.exA); await clickBody(page, haIds.exB);
    const s1 = await vecOf(page, haIds.exXor), c1 = await vecOf(page, haIds.exAnd);
    console.log('    A=1,B=1 → S(Xor):', JSON.stringify(s1), ' C(And):', JSON.stringify(c1));
    (/0/.test(s1) && /1/.test(c1)) ? ok('[3b] 半加器 1+1 → 和=0 进位=1') : bad('[3b] 半加器结果错误', `S=${s1} C=${c1}`);

    // ===== [4] 插入示例·4 位计数器 =====
    console.log('\n===== [4] 插入示例：4 位二进制计数器 =====');
    await page.mouse.click(1150, 760, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '4 位二进制计数器', false);
    await sleep(900);
    const clkId = await exId(page, 'exClk');
    const dffIds = {};
    for (const pfx of ['exD0', 'exD1', 'exD2', 'exD3']) dffIds[pfx] = await exId(page, pfx);
    const cnt = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const rd = (id) => { const v = p.model.getCell(id)?.get('outputSignals')?.out; return v ? v.toString() : 'n/a'; };
      const list = Object.values(ids).filter(Boolean);
      return { dff: list.length, v1: list.map(rd) };
    }, dffIds);
    console.log('    计数器 Dff:', cnt.dff, ' 初读:', JSON.stringify(cnt.v1));
    // 示例 Clock propagation=25（半周期≈0.25s）→ 每 0.5s 减 1；采样窗口要 > 全周期(16×0.5=8s 太长)，
    // 只要跨过 2 个上升沿就能看到变化 —— 6×600ms=3.6s 足够。
    const seq = [JSON.stringify(cnt.v1)];
    for (let i = 0; i < 6; i++) {
      await sleep(600);
      seq.push(JSON.stringify(await page.evaluate((ids) => {
        const p = window.__sandboxPaper;
        return Object.values(ids).map((id) => {
          const v = p.model.getCell(id)?.get('outputSignals')?.out; return v ? v.toString() : 'n/a';
        });
      }, dffIds)));
    }
    console.log('    采样序列(600ms):', seq.join(' → '));
    const changed = new Set(seq).size > 1;
    const noX = !seq.some(s => s.includes('x'));
    (cnt.dff === 4 && changed && noX)
      ? ok('[4] 计数器时钟自动运行，Dff 输出确定且随时间翻转', seq.join(' → '))
      : bad('[4] 计数器未运行/输出含 x', seq.join(' → '));

    // ===== [5] Memory 持久化 =====
    console.log('\n===== [5] Memory 持久化 =====');
    await page.keyboard.press('Control+s'); await sleep(800);
    await page.reload({ waitUntil: 'networkidle' }); await sleep(1800);
    await page.locator('button[title="沙盒"]').click(); await sleep(900);
    const memAfter = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(x => x.get('type') === 'Memory');
      return c ? (c.getPorts?.() || []).map(x => x.id).sort() : null;
    });
    console.log('    重载后 Memory 端口:', JSON.stringify(memAfter));
    (memAfter && need.every(n => memAfter.some(p => p === n)))
      ? ok('[5] 保存/重载后 Memory 端口配置完整')
      : bad('[5] 重载后 Memory 端口丢失', JSON.stringify(memAfter));

    // ===== [6] 同一画布重复插入示例（id 唯一化 + 位置平移） =====
    console.log('\n===== [6] 重复插入示例 =====');
    const cntBefore = await page.evaluate(() => window.__sandboxPaper.model.getCells().filter(c => !c.isLink()).length);
    await page.mouse.click(950, 620, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '半加器', false);
    await sleep(800);
    await page.mouse.click(1200, 800, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '半加器', false);
    await sleep(900);
    const rep = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const cells = p.model.getCells().filter(c => !c.isLink());
      const ids = cells.map(c => String(c.id));
      const aIds = ids.filter(id => /^exA_\d+$/.test(id)); // 精确匹配，避开 exAnd
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      const posA = aIds.map(id => { const q = p.model.getCell(id).get('position'); return Math.round(q.x); });
      return { n: cells.length, aIds: aIds.length, dup, posA };
    });
    const deltaCells = rep.n - cntBefore;
    console.log('    两次插入后: 器件增量 =', deltaCells, ' exA 数 =', rep.aIds, ' 重复 id =', rep.dup.length, ' exA.x =', JSON.stringify(rep.posA));
    (deltaCells === 12 && rep.aIds === 3 && rep.dup.length === 0 && rep.posA.length === 3
      && Math.abs(rep.posA[1] - rep.posA[0]) > 50 && Math.abs(rep.posA[2] - rep.posA[1]) > 50)
      ? ok('[6] 重复插入：器件全部落位、id 唯一、位置随右键点平移', `Δ=${deltaCells} exA×${rep.aIds} x=${JSON.stringify(rep.posA)}`)
      : bad('[6] 重复插入异常（id 冲突/位置重叠）', JSON.stringify(rep));

    // ===== 汇总 =====
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
    if (errors.length) { console.log('页面错误:', errors.slice(0, 4).join(' | ').slice(0, 400)); }
  } catch (e) {
    console.log('FATAL', e);
    if (fail === 0 && pass === 0) { console.log(`===== 结果: 0 pass, 1 fail =====`); }
  } finally {
    try { await browser?.close(); } catch {}
    try { server?.kill(); } catch {}
    process.exit(fail > 0 ? 1 : 0);
  }
})();
