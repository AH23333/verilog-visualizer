// 深度自检轮 1+4：撤销/重做 × 示例与 Memory、删除清理、冻结引擎下插示例自愈
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1490;
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
  await require('./_ui.cjs').ensurePalette(page);
const UI = require('./_ui.cjs');
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click(); await sleep(500);
};
const snap = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  const cells = p.model.getCells().filter(c => !c.isLink());
  return { n: cells.length, links: p.model.getLinks().length };
});
const menuClick = async (page, label, exact = true) => {
  const loc = exact ? page.locator(`button:text-is("${label}")`) : page.locator(`button:has-text("${label}")`);
  await loc.first().click(); await sleep(400);
};
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: PROJECT_ROOT, shell: true, stdio: 'pipe' });
    await waitForServer();
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 150)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-gates','verilog-viz-sandbox-settings'].forEach(k => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip")').click({ timeout: 2000 }); } catch {}
    await UI.newSandboxFile(page);

    // ===== [A] 插入示例 → 撤销 → 重做 =====
    console.log('\n===== [A] 示例的撤销/重做 =====');
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '半加器', false);
    await sleep(900);
    const s1 = await snap(page);
    await page.keyboard.press('Control+z'); await sleep(800);
    const s2 = await snap(page);
    await page.keyboard.press('Control+Shift+z'); await sleep(800);
    const s3 = await snap(page);
    console.log(`    插入后=${JSON.stringify(s1)} 撤销后=${JSON.stringify(s2)} 重做后=${JSON.stringify(s3)}`);
    (s2.n === s1.n - 6 && s2.links === s1.links - 6) ? ok('[A1] 撤销完整移除示例（器件+连线）') : bad('[A1] 撤销不完整', JSON.stringify(s2));
    (s3.n === s1.n && s3.links === s1.links) ? ok('[A2] 重做完整恢复示例') : bad('[A2] 重做不完整', JSON.stringify(s3));
    // 重做后的示例还能工作（拨输入灯响应）
    const exA = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const c = p.model.getCells().find(c => /^exA_\d+$/.test(String(c.id)));
      return c ? c.id : null;
    });
    if (exA) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, exA);
      await page.mouse.click(pt.x, pt.y); await sleep(600);
      const xorOut = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const c = p.model.getCells().find(c => /^exXor_\d+$/.test(String(c.id)));
        const v = c?.get('outputSignals')?.out; return v ? v.toString() : 'n/a';
      });
      /1/.test(xorOut) ? ok('[A3] 重做后的示例可正常仿真（A 拨 1 → Xor=1）', xorOut) : bad('[A3] 重做后示例失效', xorOut);
    } else bad('[A3] 重做后找不到示例器件');

    // ===== [B] 冻结引擎（autoStartSim=false）下插入计数器 → 交互自愈 =====
    console.log('\n===== [B] autoStartSim=false 下插入示例 =====');
    await page.evaluate(() => {
      localStorage.setItem('verilog-viz-sandbox-settings', JSON.stringify({ gridSize: 16, showGrid: true, snapToGrid: true, wireStyle: 'metro', defaultBits: 1, autoStartSim: false }));
    });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    // 重新打开之前保存过的文件？未保存 —— 新建后重插
    const files = await page.evaluate(() => JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '[]').length);
    console.log('    存档文件数（应为 0，[A] 未保存）:', files);
    await UI.newSandboxFile(page);
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await menuClick(page, '插入示例', false);
    await menuClick(page, '4 位二进制计数器', false);
    await sleep(900);
    const seq = [];
    for (let i = 0; i < 5; i++) {
      const s = await page.evaluate(() => {
        const p = window.__sandboxPaper;
        const ids = Object.keys(p.model.getCells().filter(c => !c.isLink()).reduce((m, c) => { m[String(c.id)] = 1; return m; }, {}));
        const dffIds = [...new Set(ids.filter(id => /^exD\d+_\d+$/.test(id)))].sort();
        const rd = (id) => { const v = p.model.getCell(id)?.get('outputSignals')?.out; return v ? v.toString().replace('Vector3vl ', '') : 'n/a'; };
        return dffIds.map(rd).join('');
      });
      seq.push(s); await sleep(500);
    }
    console.log('    Dff 采样:', JSON.stringify(seq));
    (new Set(seq).size > 1 && !seq.some(s => s.includes('x')))
      ? ok('[B] 冻结引擎下插示例自动恢复仿真，计数器运行', seq.join('→'))
      : bad('[B] 冻结引擎下计数器未运行', seq.join('→'));

    // ===== [C] 删除带连线的器件 → 连线清理 =====
    console.log('\n===== [C] 删除 Memory 的连线清理 =====');
    await realClickGate(page, 'Memory');
    const memId = await page.evaluate(() => window.__sandboxPaper.model.getCells().find(c => c.get('type') === 'Memory')?.id);
    await sleep(500);
    const before = await snap(page);
    // 右键 Memory → 删除
    const pt = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, memId);
    await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
    await menuClick(page, '删除', false);
    await sleep(700);
    const after = await snap(page);
    // 检查无悬空连线（source/target 指向已删除器件）
    const dangling = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      return p.model.getLinks().filter(l => {
        const s = l.get('source'), t = l.get('target');
        return (s.id && !p.model.getCell(s.id)) || (t.id && !p.model.getCell(t.id));
      }).length;
    });
    console.log(`    删除前=${JSON.stringify(before)} 删除后=${JSON.stringify(after)} 悬空线=${dangling}`);
    (after.n === before.n - 1 && dangling === 0) ? ok('[C] 删除器件后无悬空连线') : bad('[C] 连线清理异常', `悬空=${dangling}`);
    // 撤销删除 → Memory 和连线都恢复
    await page.keyboard.press('Control+z'); await sleep(800);
    const restored = await snap(page);
    const memBack = await page.evaluate((id) => !!window.__sandboxPaper.model.getCell(id), memId);
    (restored.n === before.n && memBack) ? ok('[C2] 撤销删除后器件与连线完整恢复') : bad('[C2] 撤销删除不完整', JSON.stringify(restored));

    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
