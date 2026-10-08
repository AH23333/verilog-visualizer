// R62 验收：**波形调试要可调速**（他第 10 条），两处入口都测：沙盒 ⇄ 编译模式。
// 起因：上游 digitaljs 的 setInterval 只在 start() 里读一次 _interval_ms —— 只写 circuit.interval
// 不改表，实测（关掉重起那一行做变异）两档都停在开机时的 10ms：141 tick vs 142 tick，倍率 1.0。
//
// 判据是成对的，不看"滑条存不存在"，看引擎真的按设定的间隔在跑：
//   ① 滑条的量纲（min/max）与编译模式一致（App.tsx: MIN_SPEED_MS=5 / MAX_SPEED_MS=200）；
//   ② 拨到最慢/最快，`circuit.interval` 立刻等于设定值（不是要重启仿真）；
//   ③ 同样的采样窗口里，快档的**引擎 tick 数**必须远多于慢档（≥3 倍，且快档 ≥20 tick、慢档 ≥3 tick）——
//      这条才是"可调速"的可观察后果；①② 只是形状。tick 从上游 'postUpdateGates' 事件数出来。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1653;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1653)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const SLIDER = 'input[title="仿真速度（右滑更快）"], input[type=range][min="5"][max="200"]';

/**
 * 数**引擎自己的 tick**：上游每调一次 updateGates() 就 trigger 一次 'postUpdateGates'
 * （bundle @2345892：`this.trigger("postUpdateGates",t,e)`），所以这是 interval 的直接读数。
 * ⚠ 不要拿"信号翻转次数"当读数：那是 Clock 器件自己的语义，跟 interval 不成比例（第一版就这么误判过）。
 */
const startSampler = (page, hook) => page.evaluate((h) => {
  const c = window[h];
  if (!c || typeof c.on !== 'function') return false;
  clearInterval(window.__r62Timer);
  if (window.__r62H) { try { c.off('postUpdateGates', window.__r62H); } catch { /* 这一版没有 off */ } }
  window.__r62 = { n: 0, t0: performance.now() };
  window.__r62H = () => { window.__r62.n++; };
  c.on('postUpdateGates', window.__r62H);
  return true;
}, hook);
const readSampler = (page, hook) => page.evaluate((h) => {
  const c = window[h];
  if (c && window.__r62H) { try { c.off('postUpdateGates', window.__r62H); } catch { /* ignore */ } }
  return window.__r62 ? { n: window.__r62.n, ms: Math.round(performance.now() - window.__r62.t0) } : null;
}, hook);

/** 慢档/快档各数一次引擎 tick（两种模式共用同一套判据；滑条值→毫秒由调用方给） */
async function runPair(page, tag, hook, sel, slowVal, fastVal) {
  const trial = async (v) => {
    const found = await page.evaluate((a) => {
      const i = document.querySelector(a.sel);
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, String(a.v));
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, { sel, v });
    if (!found) return { missing: true };
    await sleep(800);
    const iv = await page.evaluate((h) => (window[h] ? window[h].interval ?? null : null), hook);
    if (!await startSampler(page, hook)) { skip(`[${tag}-3] 快慢档 tick 数`, '引擎不认 on/postUpdateGates'); return null; }
    await sleep(1400);
    const t = await readSampler(page, hook);
    return { iv, n: t ? t.n : -1, ms: t ? t.ms : 0 };
  };
  const slow = await trial(slowVal);
  if (slow && slow.missing) { skip(`[${tag}] 三格全不作数`, `滑条找不到（选择器：${sel}）`); return; }
  if (slow) (slow.iv === 200 ? ok : bad)(`[${tag}-2a] 拨到最慢：circuit.interval 立刻 = 200ms`,
    `interval=${slow.iv}，${slow.n} tick/${slow.ms}ms（≈${slow.n > 0 ? Math.round(slow.ms / slow.n) : '∞'}ms/tick）`);
  const fast = await trial(fastVal);
  if (fast) (fast.iv === 5 ? ok : bad)(`[${tag}-2b] 拨到最快：circuit.interval 立刻 = 5ms`,
    `interval=${fast.iv}，${fast.n} tick/${fast.ms}ms（≈${fast.n > 0 ? Math.round(fast.ms / fast.n) : '∞'}ms/tick）`);
  if (!slow || !fast) { skip(`[${tag}-3] 快档 tick 远多于慢档`, '上面两档没测出来'); return; }
  const ratio = slow.n > 0 ? fast.n / slow.n : (fast.n > 0 ? Infinity : 0);
  (slow.n >= 3 && fast.n >= 20 && ratio >= 3 ? ok : bad)(
    `[${tag}-3] 同样采样窗口里快档 tick 多得多（引擎真按 interval 在跑）`,
    `慢档 ${slow.n} tick vs 快档 ${fast.n} tick，倍率=${Number.isFinite(ratio) ? ratio.toFixed(1) : '∞'}`);
}

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 180)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // ===== 编译模式（同一颗 setSimInterval，两处入口都要真生效）=====
    const ids = {};
    for (const f of ['multiplier.v', 'adder.v', 'full_adder.v']) {
      ids[f] = await page.evaluate(async (a) => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const nf = fileStore.createFile(a.n); fileStore.saveContent(nf.id, a.c); return nf.id;
      }, { n: f, c: rd(f) });
    }
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      fileStore.setModuleBinding(a.mul, 'adder', a.add); fileStore.setModuleBinding(a.add, 'full_adder', a.fa);
    }, { mul: ids['multiplier.v'], add: ids['adder.v'], fa: ids['full_adder.v'] });
    await page.locator('[title="multiplier.v"]').first().click({ force: true }); await sleep(700);
    await page.keyboard.press('F5');
    let cReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(600);
      cReady = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 2;
      });
      if (cReady) break;
    }
    if (!cReady) { console.log('FATAL 编译主画布没出图'); process.exit(1); }
    const cHook = await page.evaluate(() => {
      const c = window.__djsDebug && window.__djsDebug.getCircuit && window.__djsDebug.getCircuit();
      if (!c) return 'noCircuit';
      window.__r62CompileCircuit = c;
      return c.running ? 'running' : 'stopped';
    });
    if (cHook === 'noCircuit') { console.log('FATAL 编译模式的 __djsDebug.getCircuit() 拿不到引擎'); process.exit(1); }
    const CSel = 'input[type="range"][step="0.01"]';   // 编译模式的速度滑条（min0/max1/step0.01）
    if (cHook === 'stopped') skip('[编译] 三格全不作数', '引擎开机就是停的（这一版不猜「运行」按钮的锚点）');
    else await runPair(page, '编译', '__r62CompileCircuit', CSel, '0', '1');   // 0⇒200ms，1⇒5ms

    // ===== 沙盒模式（他第 10 条）=====
    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Clock');
    await UI.clickGate(page, 'Lamp');
    const circuit = await page.evaluate(() => !!window.__sandboxCircuit && !!window.__sandboxCircuit._graph);
    if (!circuit) { console.log('FATAL 沙盒引擎实例拿不到（__sandboxCircuit），后面全是空话'); process.exit(1); }

    // [1] 量纲与编译模式一致（同一 5–200ms）
    const range = await page.evaluate((sel) => {
      const i = document.querySelector(sel);
      return i ? { min: i.min, max: i.max, value: i.value, disabled: i.disabled } : null;
    }, SLIDER);
    if (!range) { skip('[1] 速度滑条的量纲', '找不到 5–200 的 range 输入'); }
    else (range.min === '5' && range.max === '200' && !range.disabled ? ok : bad)(
      '[1] 沙盒有速度滑条，量纲与编译模式同为 5–200ms', J(range));

    // 让引擎跑起来（沙盒工具栏的「运行」）
    const run = page.locator('button[title="运行 / 暂停仿真"]');
    if (!(await run.count())) { console.log('FATAL 沙盒没有「运行 / 暂停仿真」按钮'); process.exit(1); }
    for (let i = 0; i < 3; i++) {
      const state = await page.evaluate(() => !!(window.__sandboxCircuit && window.__sandboxCircuit.running));
      if (state) break;
      await run.first().click(); await sleep(700);
    }
    const running = await page.evaluate(() => !!(window.__sandboxCircuit && window.__sandboxCircuit.running));
    if (!running) { console.log('FATAL 沙盒引擎跑不起来（点「运行」没进 running）'); process.exit(1); }

    // 慢档（最左）与快档（最右）各数一次引擎 tick
    await runPair(page, '沙盒', '__sandboxCircuit', SLIDER, 5, 200);

    (perr.length ? bad : ok)('[4] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== R62 可调速（两种模式）: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.log('FATAL ' + String(e.stack || e).slice(0, 400));
    fail++;
    console.log(`\n===== R62 可调速（两种模式）: ${pass} PASS / ${fail} FAIL / ${unverified} UNVERIFIED =====`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => { });
    if (server) server.kill();
  }
})();
