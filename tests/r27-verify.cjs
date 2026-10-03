// R27 验收：数字钟示例（Memory 组合读做 BCD→七段译码）+ Memory 批量操作
//  （R28 修复上线：根因是 Display7 被 g() 默认 bits:1 事后 set 重建端口 → 连线 warning
//   → digitaljs 停整个引擎；且 Memory 初始内容必须走构造属性 memdata）
//  [1] 插入数字钟示例：12 个器件齐全
//  [2] ROM 段码表就位（memdataInit → gate.memdata）
//  [3] 显示联动：Display7 输入 ∈ 段码表集合（组合读工作）
//  [4] 右键「内存清零」→ Display7 全灭（批量操作生效）
//  [5] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1474;
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
const menuClick = async (page, label, exact = true) => {
  const loc = exact ? page.locator(`button:text-is("${label}")`) : page.locator(`button:has-text("${label}")`);
  await loc.first().click(); await sleep(400);
};
// 与 SandboxCanvas.SEVEN_SEG_TABLE 一致：0-9 段码 + 10-15 全灭（00000000）
const TABLE = ['01111110','00110000','01101101','01111001','00110011','01011011','01011111','01110000','01111111','01111011','00000000','00000000','00000000','00000000','00000000','00000000'];
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
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await page.locator('button[title="沙盒"]').click(); await sleep(800);
    await page.locator('button[title="新建文件"]').click(); await sleep(1300);

    // [1] 插入数字钟示例
    await page.mouse.click(1150, 760, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '数字钟（计数器 + 译码 + 数码管）', false);
    await sleep(1000);
    const comp = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); by[t] = (by[t] || 0) + 1; });
      return by;
    });
    console.log('    数字钟器件:', JSON.stringify(comp));
    (comp.Clock === 1 && comp.Dff === 4 && comp.Not === 4 && comp.BusGroup === 1 && comp.Memory === 1 && comp.Display7 === 1)
      ? ok('[1] 数字钟 12 个器件齐全') : bad('[1] 器件缺失', JSON.stringify(comp));

    // [2] ROM 段码表
    const table = await page.evaluate(() => {
      const mem = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Memory')?.memdata;
      if (!mem) return null;
      return [0, 1, 2, 9].map(a => mem.get(a).toString().replace('Vector3vl ', ''));
    });
    console.log('    段码[0,1,2,9]:', JSON.stringify(table));
    (table && table[0] === TABLE[0] && table[1] === TABLE[1] && table[2] === TABLE[2] && table[3] === TABLE[9])
      ? ok('[2] 段码表经 memdataInit 快照恢复') : bad('[2] 段码表异常', JSON.stringify(table));

    // [3] 显示联动：时钟跑动后 Display7 输入 ∈ 段码表
    // R32 起进入沙盒保持 IDE 面板语境（默认落「文件」），需先切「部件」；
    // 且部件库分组默认折叠 —— 展开后才能点到 Constant
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(500);
    for (const n of ['逻辑门', '输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) {
      try { await page.getByText(n, { exact: true }).first().click({ timeout: 800 }); await sleep(120); } catch {}
    }
    await page.locator('button[data-gate="Constant"]').click(); await sleep(800); // 真实用户操作触发 commit+flush
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      const v = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        window.__lastDump = {
          busOut: (() => { const bus = p.model.getCells().find(c => c.get('type') === 'BusGroup'); const v = bus?.get('outputSignals')?.out; return v ? v.toString() : 'n/a'; })(),
          busIns: (() => { const bus = p.model.getCells().find(c => c.get('type') === 'BusGroup'); const s = bus?.get('inputSignals') || {}; return Object.entries(s).map(([k, v]) => k + '=' + String(v).replace('Vector3vl ', '')).join(','); })(),
          dff0: (() => { const d = p.model.getCells().find(c => /^exD0_/.test(String(c.id))); const v = d?.get('outputSignals')?.out; return v ? v.toString() : 'n/a'; })(),
          linkCount: p.model.getLinks().length,
          memAddr: (() => { const mem = p.model.getCells().find(c => c.get('type') === 'Memory'); const v = mem?.get('inputSignals')?.rd0addr; return v ? v.toString() : 'n/a'; })(),
        };
        const disp = p.model.getCells().find(c => c.get('type') === 'Display7');
        const v = disp?.get('inputSignals')?.in;
        return v ? v.toString().replace('Vector3vl ', '') : 'n/a';
      });
      seen.add(v);
      if (i === 3) { const d = await page.evaluate(() => window.__lastDump || null); console.log('    链路 dump:', JSON.stringify(d)); }
      await sleep(400);
    }
    const allValid = [...seen].every(v => TABLE.includes(v));
    console.log('    Display7 输入采样:', JSON.stringify([...seen]));
    (seen.size >= 1 && allValid && ![...seen].includes('xxxxxxxx'))
      ? ok('[3] 组合读译码工作：Display7 输入始终为合法段码', `${seen.size} 种`)
      : bad('[3] 显示联动异常', JSON.stringify([...seen]));

    // 清掉 [3] 前放置的常量 —— 它落在画布中央会盖住 Memory 的右键命中点
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      p.model.getCells().find(c => c.get('type') === 'Constant')?.remove();
    });
    await sleep(400);

    // [4] 内存清零 → Display7 全灭
    const memId = await page.evaluate(() => window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Memory')?.id);
    // zoomToFit 会把示例右半部分铺进右侧器件库面板下方 —— 先把画布左移挪出遮挡区
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const mem = p.model.getCells().find(c => c.get('type') === 'Memory');
      const r = mem.findView(p).el.getBoundingClientRect();
      if (r.right > 1080) { const t = p.translate(); p.translate(t.tx - (r.right - 900), t.ty); }
    });
    await sleep(300);
    const pt = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      // 不能用 g 元素 bbox 中心 —— 端口标签把 bbox 撑大，中心可能落在未被绘制覆盖的
      // 空白处，SVG 命中测试会穿透到画布 → 弹出空白菜单。取最大的 rect（body）中心。
      const rects = Array.from(v.el.querySelectorAll('rect'));
      const body = rects.sort((a, b) => (b.getBBox().width * b.getBBox().height) - (a.getBBox().width * a.getBBox().height))[0] || v.el;
      const r = body.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, memId);
    await page.mouse.move(pt.x - 60, pt.y - 40); await page.mouse.move(pt.x, pt.y, { steps: 8 }); await sleep(200);
    // 打开弹窗 → 点「清零」→ 关闭
    await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
    await menuClick(page, '查看 / 编辑内存', false);
    await sleep(700);
    await page.locator('[data-mem-fill="0"]').click(); await sleep(600);
    await page.locator('[data-memory-view] button[title="关闭"]').click(); await sleep(600);
    const after = await page.evaluate(() => {
      const disp = window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Display7');
      const v = disp?.get('inputSignals')?.in;
      return v ? v.toString().replace('Vector3vl ', '') : 'n/a';
    });
    console.log('    清零后 Display7 输入:', after);
    /^0+$/.test(after) ? ok('[4] 内存清零 → 数码管全灭（批量操作生效）', after) : bad('[4] 清零未生效', after);

    // [5]
    errors.length === 0 ? ok('[5] 全程无页面异常') : bad('[5] 有页面异常', errors[0].slice(0, 120));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
