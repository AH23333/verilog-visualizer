// R115 闸门：两模式左栏视觉对齐（R99 项4 的收官断言）
// 判据全部走 getComputedStyle 互比，不硬编码主题色值/像素（换主题不碎）。
//  [1] 六组面板头（IDE 文件/模块/层次 + 沙盒 文件/部件/层次）css 全等：
//      padding、borderBottom、标题字号/字重/字距/颜色
//  [2] 头文本无英文字母残留（Modules/Hierarchy 那一族回潮即红）
//  [3] 两模式侧栏容器外沿 borderRight（宽度+颜色）互相一致
//  [4] 清 storage 后两模式默认侧栏宽一致（240 对齐的防回归）
//  [5] 全程无页面异常
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1159;
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); };

// 页内读数器：找当前可见左栏容器 + 其头部（带 borderBottom 的第一层盒）
const READER = () => {
  const sb = document.querySelector('[data-sandbox-sidebar]');
  let host = sb;
  if (!host) {
    host = [...document.querySelectorAll('body div')].find((d) => {
      const cs = getComputedStyle(d); const r = d.getBoundingClientRect();
      return r.left < 75 && r.left >= 30 && r.width >= 170 && r.width <= 520 && r.height > 400
        && cs.borderRightWidth !== '0px' && cs.position !== 'absolute' && !d.hasAttribute('data-sandbox-sidebar');
    }) || null;
  }
  if (!host) return null;
  const hcs = getComputedStyle(host);
  // 头部：容器内第一层、贴顶（top 偏移 < 90）、borderBottom 非零的盒
  let head = null;
  for (const d of host.querySelectorAll('div')) {
    const cs = getComputedStyle(d);
    if (cs.borderBottomWidth !== '0px' && d.getBoundingClientRect().top - host.getBoundingClientRect().top < 90) { head = d; break; }
  }
  if (!head) return null;
  const fcs = getComputedStyle(head);
  // 头文本元素：head 自身若直接含文字则用之，否则找内部第一个含文字的 span/div
  let tEl = head;
  if (![...(head.childNodes || [])].some((n) => n.nodeType === 3 && n.textContent.trim())) {
    tEl = [...head.querySelectorAll('span,div')].find((x) => x.textContent.trim() && x.children.length === 0) || head;
  }
  const tcs = getComputedStyle(tEl);
  return {
    pad: fcs.paddingTop + '/' + fcs.paddingLeft,
    bb: fcs.borderBottomWidth + ' ' + fcs.borderBottomColor,
    fs: tcs.fontSize, fw: tcs.fontWeight, ls: tcs.letterSpacing, tc: tcs.color,
    text: (tEl.textContent || '').trim().slice(0, 12),
    hostBorderRight: hcs.borderRightWidth + ' ' + hcs.borderRightColor,
    hostWidth: Math.round(host.getBoundingClientRect().width),
  };
};

async function pickPanel(page, key, wantText) {
  // 先点目标键，再验证头文本命中；「点当前面板=收起」语义下读不到就再点一次恢复
  for (let i = 0; i < 3; i++) {
    await page.evaluate((k) => { const b = document.querySelector(`button[data-activity="${k}"]`); if (b) b.click(); }, key);
    await sleep(420);
    const r = await page.evaluate(READER);
    if (r && (!wantText || r.text === wantText)) return r;
  }
  return page.evaluate(READER);
}

(async () => {
  let server, browser;
  let ideCapsuleRef = null;
  const errs = [];
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await UI.boot(page, URL, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await sleep(500);

    // ---- IDE 三面板头读数 ----
    const ideFiles = await pickPanel(page, 'files', '文件');
    const ideModules = await pickPanel(page, 'modules', '模块');
    const ideHier = await pickPanel(page, 'hierarchy', '层次结构');
    const trio = [ideFiles, ideModules, ideHier];
    if (trio.every(Boolean)) ok('[setup] IDE 三面板头读数到手', trio.map((t) => t.text).join(','));
    else { bad('[setup] IDE 面板读数缺失', J(trio)); throw new Error('setup'); }

    // ---- [6] 编译侧仿真控制胶囊：注入 adder.v + full_adder.v → 编译 → 读容器 css ----
    const fsMod = require('fs');
    const code = fsMod.readFileSync(path.join(ROOT, 'test_files', 'adder.v'), 'utf8');
    const code2 = fsMod.readFileSync(path.join(ROOT, 'test_files', 'full_adder.v'), 'utf8');
    await page.evaluate(async (a) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      const nf = fileStore.createFile('adder.v'); fileStore.saveContent(nf.id, a.c);
      const nf2 = fileStore.createFile('full_adder.v'); fileStore.saveContent(nf2.id, a.c2);
    }, { c: code, c2: code2 });
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.locator('[title="adder.v"]').first().click({ force: true }); await sleep(900);
    await page.locator('button[title^="编译"], button[title^="Compile"]').first().click();
    let compiled = false;
    for (let i = 0; i < 60; i++) {
      await sleep(700);
      compiled = await page.evaluate(async () => { const { fileStore } = await import('/src/store/fileStore.ts'); const f = fileStore.getAll().find((x) => x.name === 'adder.v'); return !!(f && f.status === 'compiled' && f.circuitJson); });
      if (compiled) break;
    }
    if (!compiled) { bad('[6] 编译侧胶囊', 'adder.v 没编译出来'); }
    else {
      const ideCapsule = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="sim-lock-toggle"]');
        const host = b && b.parentElement; if (!host) return null;
        const cs = getComputedStyle(host);
        const slider = host.querySelector('input[type="range"]');
        const ms = slider && slider.getBoundingClientRect().width;
        return { pad: cs.paddingTop + '/' + cs.paddingLeft, bg: cs.backgroundColor, bw: cs.borderTopWidth, bc: cs.borderTopColor, r: cs.borderTopLeftRadius, sliderW: ms ? Math.round(ms) : null };
      });
      ideCapsuleRef = ideCapsule;
      if (!ideCapsule) bad('[6] 编译侧胶囊', '没找到 sim-lock-toggle 的容器');
      else ok('[6] 编译侧胶囊读数到手', J(ideCapsule));
    }

    // ---- 沙盒三面板 ----
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const b = document.querySelector('button[data-activity="sandbox"]'); if (b) b.click(); });
    await sleep(900);
    await UI.newSandboxFile(page);
    await sleep(300);
    // [6续][7] 沙盒调试条胶囊与速度滑条
    const sbBar = await page.evaluate(() => {
      const host = document.querySelector('[data-sandbox-debug-bar]'); if (!host) return null;
      const cs = getComputedStyle(host);
      const slider = host.querySelector('input[type="range"]');
      const ms = slider && slider.getBoundingClientRect().width;
      return { pad: cs.paddingTop + '/' + cs.paddingLeft, bg: cs.backgroundColor, bw: cs.borderTopWidth, bc: cs.borderTopColor, r: cs.borderTopLeftRadius, sliderW: ms ? Math.round(ms) : null };
    });
    const sbFiles = await pickPanel(page, 'files', '文件');
    const sbModules = await pickPanel(page, 'modules', '部件');
    const sbHier = await pickPanel(page, 'hierarchy', '层次结构');
    const all6 = [...trio, sbFiles, sbModules, sbHier];
    if (!all6.every(Boolean)) { bad('[setup] 沙盒面板读数缺失', J([sbFiles, sbModules, sbHier])); throw new Error('setup2'); }

    // ---- [1] 六组头 css 全等（以 IDE files 头为基准）----
    const base = all6[0];
    const mism = all6.map((r, i) => ({
      i, text: r.text,
      diff: ['pad', 'bb', 'fs', 'fw', 'ls', 'tc'].filter((k) => r[k] !== base[k]).map((k) => `${k}:${base[k]}→${r[k]}`),
    })).filter((x) => x.diff.length);
    if (!mism.length) ok('[1] 六组面板头 css 全等（padding/borderBottom/字号/字重/字距/颜色）', J([base.pad, base.fs, base.fw, base.ls]));
    else bad('[1] 六组头 css 全等', J(mism));

    // ---- [2] 头文本无英文残留 ----
    const eng = all6.filter((r) => /[A-Za-z]/.test(r.text)).map((r) => r.text);
    if (!eng.length) ok('[2] 六组头文本无英文残留', all6.map((r) => r.text).join(','));
    else bad('[2] 英文残留', eng.join(','));

    // ---- [3] 容器外沿 borderRight 两模式一致 ----
    const brs = [...new Set(all6.map((r) => r.hostBorderRight))];
    if (brs.length === 1) ok('[3] 两模式侧栏外沿 borderRight 一致', brs[0]);
    else bad('[3] 外沿不一致', J(brs));

    // ---- [4] 默认宽一致（沙盒新键刚建，两侧都没写过宽度存储）----
    const ws = [...new Set(all6.map((r) => r.hostWidth))];
    if (ws.length === 1) ok('[4] 两模式默认侧栏宽一致', ws[0] + 'px');
    else bad('[4] 默认宽分叉', J(ws));

    // ---- [6] 调试条容器＝编译侧同款胶囊（R115b）----
    if (ideCapsuleRef && sbBar) {
      const keys = ['pad', 'bg', 'bw', 'bc', 'r'];
      const diffs = keys.filter((k) => String(ideCapsuleRef[k]) !== String(sbBar[k])).map((k) => `${k}: ide=${ideCapsuleRef[k]} sb=${sbBar[k]}`);
      if (!diffs.length) ok('[6] 沙盒调试条与编译侧仿真胶囊 css 全等', J([sbBar.pad, sbBar.bg, sbBar.r]));
      else bad('[6] 胶囊不一致', diffs.join(' | '));
      // ---- [7] 两侧速度滑条同宽（90px 契约）----
      if (ideCapsuleRef.sliderW === sbBar.sliderW) ok('[7] 两侧速度滑条同宽', sbBar.sliderW + 'px');
      else bad('[7] 滑条宽度分叉', `ide=${ideCapsuleRef.sliderW} sb=${sbBar.sliderW}`);
    } else if (sbBar) bad('[6] 调试条胶囊', '编译侧读数缺失（见上）');
    else bad('[6] 调试条胶囊', '沙盒 [data-sandbox-debug-bar] 不存在');

    // ---- [5] 无页面异常 ----
    if (!errs.length) ok('[5] 全程无页面异常'); else bad('[5] 页面异常', errs.join(' | '));
  } catch (e) {
    bad('FATAL', String(e && e.message || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server && server.kill('SIGTERM'); } catch { }
    try { UI.reapViteByPort(PORT); } catch { }
  }
  console.log(`\n===== R115 sidebar-align: PASS=${pass} FAIL=${fail} =====`);
  process.exitCode = fail ? 1 : 0;
})();
