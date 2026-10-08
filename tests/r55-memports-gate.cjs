// R55 验收：沙盒里的**存储器端口配置**（digitaljs 的 Memory 支持多读/多写口、时钟/使能/复位极性、
// init/srst/arst 值、透明/冲突行为、words/offset —— 以前本仓只能吃默认「1 读 1 写带时钟」）。
//
// 钉的是上游事实，不是本文档的想当然（cells/memory.mjs:44-84）：
//  - 端口是否存在取决于**键在不在**（`'clock_polarity' in port`），留 `键: undefined` 照样会长出端口；
//  - 读口端口是 rdNaddr / rdNdata(+clk/en/srst/arst)，写口是 wrNdata / wrNaddr(+en/clk)；
//  - 高度 = 16×行数 + 8，行数由最终端口表算出 —— 重建后若按旧表算高就会端口叠字。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1625;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1625)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const freePort = (p) => {
  try {
    require('child_process').execSync(
      `powershell -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' });
  } catch { }
};

const memSnapshot = (page) => page.evaluate(() => {
  const paper = window.__sandboxPaper;
  const c = paper.model.getElements().find((e) => String(e.get('type')) === 'Memory');
  if (!c) return null;
  return {
    id: c.id,
    ports: (c.getPorts() || []).map((p) => p.id).sort(),
    size: c.size(),
    rd: JSON.parse(JSON.stringify(c.get('rdports') || [])),
    wr: JSON.parse(JSON.stringify(c.get('wrports') || [])),
    bits: c.get('bits'), abits: c.get('abits'), words: c.get('words'), offset: c.get('offset'),
  };
});

(async () => {
  let server, browser;
  try {
    freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'pipe' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务未起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await UI.enterSandbox(page);

    // 放一颗 Memory
    try { await UI.clickGate(page, 'Memory'); ok('[0] 放置存储器'); }
    catch (e) { bad('[0] 放置存储器', String(e.message).slice(0, 80)); }
    let m = await memSnapshot(page);
    if (!m) { bad('[0b] 画布上有 Memory 器件', '没找到'); throw new Error('no memory cell'); }
    ok('[0b] 画布上有 Memory 器件', `端口 ${m.ports.join('/')} 高 ${Math.round(m.size.height)}`);

    const cellCenter = await page.evaluate((id) => {
      const paper = window.__sandboxPaper;
      const v = paper.findViewByModel(paper.model.getCell(id));
      const r = v.el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, m.id);

    // ===== [1] 菜单里有「端口配置…」，点开弹窗 =====
    await UI.menuClick(page, '端口配置…', cellCenter);
    await sleep(500);
    const modal = await page.locator('[data-memports-modal]').count();
    (modal ? ok : bad)('[1] 右键菜单「端口配置…」打开配置窗', `modal=${modal}`);
    if (!modal) throw new Error('端口配置窗没打开');

    // ===== [2] 默认口数 =====
    const rdRows = await page.locator('[data-memports-rd]').count();
    const wrRows = await page.locator('[data-memports-wr]').count();
    (rdRows === 1 && wrRows === 1 ? ok : bad)('[2] 默认 1 读口 + 1 写口', `rd=${rdRows} wr=${wrRows}`);

    // ===== [3] 加第二个读口并设成「无时钟（组合读）」→ 应用后端口表与高度都跟着走 =====
    await page.locator('[data-memports-add-rd]').click(); await sleep(300);
    const rows2 = await page.locator('[data-memports-rd]').count();
    (rows2 === 2 ? ok : bad)('[3a] 「+ 加读口」多出一行', `rows=${rows2}`);
    await page.locator('[data-memports-rd="1"] select').first().selectOption('none');   // 无时钟
    await page.locator('[data-memports-apply]').click(); await sleep(900);
    m = await memSnapshot(page);
    const combOk = m.ports.includes('rd1addr') && m.ports.includes('rd1data')
      && !m.ports.includes('rd1clk') && m.rd[1] && !('clock_polarity' in m.rd[1]);
    (combOk ? ok : bad)('[3b] 第二个读口建出 rd1addr/rd1data 且没有 rd1clk（键删掉才不长端口）',
      m ? `端口=${m.ports.join(',')} rd=${JSON.stringify(m.rd)}` : '器件丢了');
    // 行数取自 digitaljs memory.mjs:36-88 的 num：读口 addr/data **共一行**（左右各一），
    // 写口 data/addr 各占一行；clk/en/srst/arst 各再加一行。高度 = num*16+8。
    const rowsOf = (m.rd || []).reduce((n, p) => n + 1 + (('srst_polarity' in p) ? 1 : 0) + (('arst_polarity' in p) ? 1 : 0)
      + (('enable_polarity' in p) ? 1 : 0) + (('clock_polarity' in p) ? 1 : 0), 0)
      + (m.wr || []).reduce((n, p) => n + 2 + (('enable_polarity' in p) ? 1 : 0) + (('clock_polarity' in p) ? 1 : 0), 0);
    const wantH = 16 * rowsOf + 8;
    (Math.round(m.size.height) === wantH ? ok : bad)('[3c] 重建后高度按最终端口表重算',
      `实际 ${Math.round(m.size.height)}，按 ${rowsOf} 行应为 ${wantH}`);
    const idKept = await page.evaluate((id) => !!window.__sandboxPaper.model.getCell(id), m.id);
    (idKept ? ok : bad)('[3d] 重建后器件 id 不变（连线不搬家）');

    // ===== [4] 同址行为：透明读 =====
    await UI.menuClick(page, '端口配置…', await page.evaluate((id) => {
      const paper = window.__sandboxPaper;
      const v = paper.findViewByModel(paper.model.getCell(id));
      const r = v.el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, m.id));
    await sleep(400);
    await page.locator('[data-memports-hazard="0"]').selectOption('T');
    await page.locator('[data-memports-f="words"]').fill('64');
    await page.locator('[data-memports-apply]').click(); await sleep(900);
    m = await memSnapshot(page);
    const transp = m.rd[0] && m.rd[0].transparent === true && !('collision' in m.rd[0]);
    (transp ? ok : bad)('[4] 「同址写：透明」写成 transparent=true 且不夹带 collision', JSON.stringify(m.rd[0]));
    (m.words === 64 ? ok : bad)('[4b] 字数 words 写进器件（digitaljs 构造期读走）', String(m.words));

    // ===== [5] 存盘 → 重载：端口表 / words / offset 不许静默丢 =====
    await page.keyboard.press('Control+s'); await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2000 }); } catch { }
    await UI.enterSandbox(page);
    const revived = await memSnapshot(page);
    const same = revived && JSON.stringify(revived.rd) === JSON.stringify(m.rd)
      && JSON.stringify(revived.wr) === JSON.stringify(m.wr) && revived.words === m.words;
    (same ? ok : bad)('[5] 存盘重开后 rdports/wrports/words 一致',
      same ? '' : JSON.stringify({ was: { rd: m.rd, wr: m.wr, words: m.words }, now: revived && { rd: revived.rd, wr: revived.wr, words: revived.words } }));
    const portsSame = revived && JSON.stringify(revived.ports) === JSON.stringify(m.ports);
    (portsSame ? ok : bad)('[5b] 重载后端口集合不变', portsSame ? '' : JSON.stringify({ was: m.ports, now: revived && revived.ports }));

    (perr.length ? bad : ok)('[6] 全程无页面异常', perr.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
  } finally {
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
    process.exit(fail ? 1 : 0);
  }
})();
