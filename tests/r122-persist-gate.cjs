// R122 切文件丢编辑回归 + 自动保存三态验收：
//  [A] 建 A.djs / B.djs（活动 = B）
//  [B] 打开 A 放 Input —— **不手动保存** → 画布 1 格
//  [C] 切到 B：B 画布应为空
//  [D] 切回 A：Input 必须仍在（根因：切回走 store 最新快照，而非过期列表快照）
//  [E] 自动保存「关闭」：commit 不落盘，但切档兜底以活画布落盘 → A 的 Lamp+Input 不失
//  [F] 自动保存「开启」+ 间隔内立即切档：pending 防抖被丢弃，以活画布落盘 → Or 不失
//  [G] 自动保存防抖落盘：放 Display 等超过 interval → localStorage 真写了
// 用法: node tests/r122-persist-gate.cjs
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1490;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1490)); } catch {}
const URL = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
const ok = (n, m = '') => { results.pass++; console.log(`  PASS  ${n}${m ? ' — ' + m : ''}`); };
const bad = (n, m = '') => { results.fail++; console.log(`  FAIL  ${n}${m ? ' — ' + m : ''}`); };
const UI = require('./_ui.cjs');

async function waitForServer(t = 15000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

/** 点击侧栏文件树里的某一行（data-sbfile = 文件名）打开它 */
async function openFile(page, name) {
  const sel = `[data-sbfile="${name}"]`;
  // 文件树只在左栏「文件」面板挂载；ensurePalette 会把左栏切到部件库，先切回文件面板
  if (!(await page.locator(sel).count())) {
    const fb = page.locator('button[data-activity="files"]');
    if (await fb.count()) { await fb.first().click(); await sleep(350); }
  }
  await page.locator(sel).first().click();
  await sleep(900);
}

/** 当前沙盒画布上的器件 type 列表（__sandboxPaper 没建好返回 null） */
const paperTypes = (page) => page.evaluate(() => {
  const p = window.__sandboxPaper;
  if (!p) return null;
  return p.model.getElements().map((c) => String(c.get('type')));
});

/** 读 localStorage 里某文件的最新 graphJson cells type 列表 */
const storedTypes = (page, name) => page.evaluate((n) => {
  try {
    const all = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
    const f = Object.values(all).find((x) => x.name === n);
    if (!f) return null;
    const g = JSON.parse(f.graphJson || '{}');
    return (g.cells || []).map((c) => String(c.type));
  } catch { return null; }
}, name);

const has = (arr, t) => Array.isArray(arr) && arr.includes(t);

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
    await page.evaluate(() => {
      ['verilog-viz-sandbox-files','verilog-viz-sandbox-active','verilog-viz-sandbox-folders',
        'verilog-viz-sandbox-gates','verilog-viz-sandbox-settings','verilog-viz-autosave-settings']
        .forEach(k => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'networkidle' }); await sleep(2000);
    try { await page.locator('button:has-text("Skip"), button:has-text("跳过")').first().click({ timeout: 2500 }); } catch {}
    await UI.enterSandbox(page);

    // ===== [A] 建两个空文件 A.djs、B.djs（活动 = B） =====
    console.log('[A] 建 A.djs / B.djs');
    await UI.newSandboxFile(page, 'A.djs');
    await UI.newSandboxFile(page, 'B.djs');
    const filesNow = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')).map((f) => f.name));
    (filesNow.includes('A.djs') && filesNow.includes('B.djs'))
      ? ok('文件 A/B 已建', filesNow.join(', '))
      : bad('文件 A/B 已建', filesNow.join(', '));
    const activeIsB = await page.evaluate(() => { const a = localStorage.getItem('verilog-viz-sandbox-active'); const f = Object.values(JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}')).find((x) => x.id === a); return f && f.name === 'B.djs'; });
    activeIsB ? ok('活动文件 = B.djs') : bad('活动文件 = B.djs');

    // ===== [B] 打开 A，放 Input，不手动保存 =====
    console.log('[B] 打开 A 放 Input（不保存）');
    await openFile(page, 'A.djs');
    await UI.ensurePalette(page);
    await UI.clickGate(page, 'Input');
    const aTypes1 = await paperTypes(page);
    (has(aTypes1, 'Input')) ? ok('A 放置 Input 成功', JSON.stringify(aTypes1)) : bad('A 放置 Input 成功', JSON.stringify(aTypes1));

    // ===== [C] 切到 B：画布应为空 =====
    console.log('[C] 切到 B');
    await openFile(page, 'B.djs');
    const bTypes = await paperTypes(page);
    (has(bTypes, 'Input')) ? bad('[C] B 画布串进了 A 的内容', JSON.stringify(bTypes)) : ok('[C] B 画布为空（无串台）', JSON.stringify(bTypes));

    // ===== [D] 切回 A：Input 必须仍在（回归点） =====
    console.log('[D] 切回 A');
    await openFile(page, 'A.djs');
    const aTypes2 = await paperTypes(page);
    has(aTypes2, 'Input')
      ? ok('[D] 切回 A：未保存的编辑仍在（store 最新快照重建）', JSON.stringify(aTypes2))
      : bad('[D] 切回 A：编辑丢失（回归！）', JSON.stringify(aTypes2));
    const storedA = await storedTypes(page, 'A.djs');
    has(storedA, 'Input')
      ? ok('[D] store 里 A.djs 已含 Input（切档时以活画布落盘）', JSON.stringify(storedA))
      : bad('[D] store 里 A.djs 已含 Input', JSON.stringify(storedA));

    // ===== [E] 自动保存「关闭」：切档兜底落盘，Lamp+Input 不失 =====
    console.log('[E] 自动保存关闭场景');
    await page.evaluate(() => localStorage.setItem('verilog-viz-autosave-settings', JSON.stringify({ enabled: false, intervalMs: 2000 })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await UI.backToSandbox(page);
    await openFile(page, 'A.djs');
    await UI.ensurePalette(page);
    await UI.clickGate(page, 'Lamp');
    await openFile(page, 'B.djs');
    await openFile(page, 'A.djs');
    const eTypes = await paperTypes(page);
    (has(eTypes, 'Lamp') && has(eTypes, 'Input'))
      ? ok('[E] 关闭自动保存：切档兜底落盘，Lamp+Input 均在', JSON.stringify(eTypes))
      : bad('[E] 关闭自动保存丢编辑', JSON.stringify(eTypes));

    // ===== [F] 自动保存「开启」+ 间隔内立即切档：persist 不失 =====
    console.log('[F] 自动保存开启 + 间隔内立即切档');
    await page.evaluate(() => localStorage.setItem('verilog-viz-autosave-settings', JSON.stringify({ enabled: true, intervalMs: 2000 })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await UI.backToSandbox(page);
    await openFile(page, 'A.djs');
    await UI.ensurePalette(page);
    await UI.clickGate(page, 'Or');
    await openFile(page, 'B.djs');   // 距放 Or < 2s：pending 防抖应被丢弃，改以活画布落盘
    await openFile(page, 'A.djs');
    const fTypes = await paperTypes(page);
    (has(fTypes, 'Or') && has(fTypes, 'Lamp') && has(fTypes, 'Input'))
      ? ok('[F] 间隔内切档不丢：Or/Lamp/Input 均在', JSON.stringify(fTypes))
      : bad('[F] 间隔内切档丢编辑', JSON.stringify(fTypes));

    // ===== [G] 自动保存防抖真实落盘 =====
    console.log('[G] 自动保存防抖落盘');
    await UI.clickGate(page, 'NumDisplay');
    await sleep(2600); // > 2000ms interval
    const gStored = await storedTypes(page, 'A.djs');
    has(gStored, 'NumDisplay')
      ? ok('[G] 自动保存防抖已把 NumDisplay 写进 localStorage', JSON.stringify(gStored))
      : bad('[G] 自动保存未落盘', JSON.stringify(gStored));

    console.log(`\n===== 结果: ${results.pass} pass, ${results.fail} fail =====`);
  } catch (e) { console.log('FATAL', e); if (results.pass + results.fail === 0) results.fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(results.fail > 0 ? 1 : 0); }
})();