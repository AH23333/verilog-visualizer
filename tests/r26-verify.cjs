// R26 验收：Verilog 导出
//  [1] 半加器 → xor/and 门实例、input/output 声明、netname 连线
//  [2] D 触发器 → always @(posedge ...) + initial 初始化
//  [3] 常量 → assign = n'b...
//  [4] 时钟 → forever 振荡
//  [5] 全程无页面错误
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1477;
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

    const exportV = async () => {
      const dl = page.waitForEvent('download', { timeout: 8000 });
      await page.locator('button[title*="导出 Verilog"]').click();
      const d = await dl;
      const p = await d.path();
      return fs.readFileSync(p, 'utf8');
    };

    // [1] 半加器
    await page.mouse.click(1100, 700, { button: 'right' }); await sleep(500);
    await page.locator('button:has-text("插入示例")').first().click(); await sleep(400);
    await page.locator('button:has-text("半加器")').first().click(); await sleep(900);
    const v1 = await exportV();
    console.log('    --- 半加器 Verilog ---\n' + v1.split('\n').slice(0, 14).join('\n'));
    const checks1 = [
      [/module\s+\w+\(/, 'module 声明'],
      [/input\s+\w+/, 'input 声明'],
      // 半加器示例无 Output 引脚（Lamp 观察）→ 无 output 声明是正确行为
      [/xor\s+g\d+\(/, 'xor 门实例'],
      [/and\s+g\d+\(/, 'and 门实例'],
      [/endmodule/, 'endmodule'],
    ];
    for (const [re, name] of checks1) (re.test(v1) ? ok : bad)(`[1] ${name}`);
    // 连线正确性：xor 输出与第一个 and 输出的 netname 应出现在相应实例里（半加器连线 N5/N6 由拖拽自动生成）
    // 信号合并：Input.out 拉出两条线（→xor、→and），电气上同一节点，必须同名
    const mXor = v1.match(/xor g\d+\((\w+), (\w+), (\w+)\);/);
    const mAnd = v1.match(/and g\d+\((\w+), (\w+), (\w+)\);/);
    const merged = mXor && mAnd && (mXor[2] === mAnd[2] || mXor[2] === mAnd[3]);
    merged ? ok('[1] 同一驱动端口的连线合并为同一 net（xor/and 共享输入）', mXor && `xor.in1=${mXor[2]} and.in=${mAnd[2]},${mAnd[3]}`)
           : bad('[1] 信号未合并（分叉连线成了悬空 wire）', JSON.stringify({ mXor: mXor && mXor.slice(1), mAnd: mAnd && mAnd.slice(1) }));

    // [2][3][4] 时序电路：插入计数器（Clock + 4×Dff + Not + Lamp）
    await page.mouse.click(1150, 760, { button: 'right' }); await sleep(500);
    await page.locator('button:has-text("插入示例")').first().click(); await sleep(400);
    await page.locator('button:has-text("4 位二进制计数器")').first().click(); await sleep(900);
    const v2 = await exportV();
    const checks2 = [
      [/always\s+@\s*\(posedge\s+\w+\)\s+\w+\s*<=\s*\w+;/, 'Dff always 块'],
      [/initial\s+\w+\s*=\s*1'b0;/, 'Dff initial'],
      [/forever\s+#\d+\s+\w+\s*=\s*~\w+;/, 'Clock forever 振荡'],
    ];
    for (const [re, name] of checks2) (re.test(v2) ? ok : bad)(`[2-4] ${name}`);
    const dffCount = (v2.match(/always @/g) || []).length;
    dffCount === 4 ? ok('[2] 4 个 D 触发器全部转换', `always×${dffCount}`) : bad('[2] Dff 数量异常', String(dffCount));

    // [3] 常量：放一个 Constant 并导出
    await page.locator('button[data-gate="Constant"]').click(); await sleep(500);
    await page.evaluate(() => {
      const c = window.__sandboxPaper.model.getCells().filter(x => x.get('type') === 'Constant').pop();
      if (c) c.set('constant', '0101');
    });
    await sleep(300);
    const v3 = await exportV();
    /=\s*4'b0101;/.test(v3) ? ok('[3] Constant → assign 4\'b0101') : bad('[3] 常量未转换', v3.split('\n').filter(l => l.includes('assign')).join('|'));

    // [5]
    errors.length === 0 ? ok('[5] 全程无页面异常') : bad('[5] 有页面异常', errors[0].slice(0, 120));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (pass + fail === 0) fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
