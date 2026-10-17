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
const URL_GATE = `http://localhost:${PORT}/gates.html`;
const UI = require('./_ui.cjs');
// R155 fileStore 削皮：编译那一侧＝index.html + 宿主推送单（旧 fileStore + 『编译』按钮随旧 React UI 退役）。
const { pushCompile, waitCompiled } = UI;
// 夹具按末段名解析（test_files/ 会被用户在产品里整理）：见 tests/fixtures.cjs
const { fixture } = require('./fixtures.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log('  PASS  ' + n + (d ? ' — ' + d : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); };
// 跳过 ≠ 通过：够不着的格子单列（本档的对账对象有一半已经不在浏览器里了，见 [setup] 那格的说明）
const skip = (n, d) => { unver++; console.log('  UNVERIFIED  ' + n + (d ? ' — ' + d : '')); };

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
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    // ---- 沙盒三面板：gates.html 的 SandboxCanvas（活动栏三颗切左栏）----
    // ⚠ 编译侧那一半（旧 App.tsx 的文件/模块/层次面板 + sim-lock-toggle 胶囊）随旧 React UI 退役了：
    //   index.html 现在只剩 CanvasApp 残体（没有左栏、没有活动栏）。旧夹具的 UI.boot(page, URL) 等
    //   `button[data-activity]` 在这张页面上永远够不着 ⇒ 沙盒侧先量，编译侧按真形状去探并如实登记。
    await UI.boot(page, URL_GATE, { settle: 2200 });
    await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('verilog-viz-')).forEach((k) => localStorage.removeItem(k)); });
    await UI.boot(page, URL_GATE, { reload: true });
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await sleep(500);
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
    if (![sbFiles, sbModules, sbHier].every(Boolean)) { bad('[setup] 沙盒面板读数缺失', J([sbFiles, sbModules, sbHier])); throw new Error('setup2'); }

    // ---- [6] 编译侧仿真控制胶囊：注入 adder.v + full_adder.v → 真编译 → 探容器 css ----
    const fsMod = require('fs');
    const code = fsMod.readFileSync(fixture('adder.v'), 'utf8');
    const code2 = fsMod.readFileSync(fixture('full_adder.v'), 'utf8');
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2400);
    await pushCompile(page, {
      files: [{ name: 'adder.v', content: code }, { name: 'full_adder.v', content: code2 }],
      topModule: 'adder', entryName: 'adder.v',
    });
    const comp = await waitCompiled(page, { minCells: 3 });
    if (comp.status !== 'compiled') { bad('[6] 编译侧胶囊', 'adder.v 没编译出来：' + J(comp)); }
    // 编译侧左栏/胶囊的现场探针：有没有活动栏、有哪些 data-testid（读数原样打进判据行）
    const ideProbe = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="sim-lock-toggle"]');
      let capsule = null;
      if (b && b.parentElement) {
        const host = b.parentElement; const cs = getComputedStyle(host);
        const slider = host.querySelector('input[type="range"]');
        const ms = slider && slider.getBoundingClientRect().width;
        capsule = { pad: cs.paddingTop + '/' + cs.paddingLeft, bg: cs.backgroundColor, bw: cs.borderTopWidth, bc: cs.borderTopColor, r: cs.borderTopLeftRadius, sliderW: ms ? Math.round(ms) : null };
      }
      return {
        hasActivityBar: !!document.querySelector('button[data-activity]'),
        sidebar: !!document.querySelector('[data-sandbox-sidebar]'),
        testids: [...document.querySelectorAll('[data-testid]')].map((x) => x.getAttribute('data-testid')),
        capsule,
      };
    });
    const trio = ideProbe.hasActivityBar
      ? [await pickPanel(page, 'files', '文件'), await pickPanel(page, 'modules', '模块'), await pickPanel(page, 'hierarchy', '层次结构')]
      : [null, null, null];
    ideCapsuleRef = ideProbe.capsule;
    if (trio.every(Boolean)) ok('[setup] IDE 三面板头读数到手', trio.map((t) => t.text).join(','));
    else skip('[setup] IDE 三面板头读数',
      `编译侧左栏不在浏览器里了：index.html 现读 活动栏=${ideProbe.hasActivityBar} 侧栏=${ideProbe.sidebar} data-testid=${J(ideProbe.testids)}` +
      `（文件/模块/层次那一半现在归 VS Code 原生树视图，本档量不到）`);
    const all6 = [...trio, sbFiles, sbModules, sbHier];
    const got6 = all6.filter(Boolean);

    // ---- [1] 六组头 css 全等（以 IDE files 头为基准）----
    if (!trio.every(Boolean)) {
      skip('[1] 六组面板头 css 全等（padding/borderBottom/字号/字重/字距/颜色）',
        `只有沙盒三组量得到（IDE 三组的宿主已退役，见 [setup]）；沙盒三组内部读数=${J([sbFiles, sbModules, sbHier].map((r) => [r.text, r.pad, r.fs, r.fw]))}`);
    } else {
      const base = all6[0];
      const mism = all6.map((r, i) => ({
        i, text: r.text,
        diff: ['pad', 'bb', 'fs', 'fw', 'ls', 'tc'].filter((k) => r[k] !== base[k]).map((k) => `${k}:${base[k]}→${r[k]}`),
      })).filter((x) => x.diff.length);
      if (!mism.length) ok('[1] 六组面板头 css 全等（padding/borderBottom/字号/字重/字距/颜色）', J([base.pad, base.fs, base.fw, base.ls]));
      else bad('[1] 六组头 css 全等', J(mism));
    }

    // ---- [2] 头文本无英文残留 ----
    const eng = got6.filter((r) => /[A-Za-z]/.test(r.text)).map((r) => r.text);
    if (!eng.length) ok('[2] 头文本无英文残留（Modules/Hierarchy 那一族回潮即红）', `量到 ${got6.length} 组：${got6.map((r) => r.text).join(',')}`);
    else bad('[2] 英文残留', eng.join(','));

    // ---- [3] 容器外沿 borderRight 两模式一致 ----
    if (!trio.every(Boolean)) skip('[3] 两模式侧栏外沿 borderRight 一致', '编译侧那一半量不到（见 [setup]）');
    else {
      const brs = [...new Set(all6.map((r) => r.hostBorderRight))];
      if (brs.length === 1) ok('[3] 两模式侧栏外沿 borderRight 一致', brs[0]);
      else bad('[3] 外沿不一致', J(brs));
    }

    // ---- [4] 默认宽一致（沙盒新键刚建，两侧都没写过宽度存储）----
    if (!trio.every(Boolean)) skip('[4] 两模式默认侧栏宽一致', '编译侧那一半量不到（见 [setup]）');
    else {
      const ws = [...new Set(all6.map((r) => r.hostWidth))];
      if (ws.length === 1) ok('[4] 两模式默认侧栏宽一致', ws[0] + 'px');
      else bad('[4] 默认宽分叉', J(ws));
    }

    // ---- [6] 调试条容器＝编译侧同款胶囊（R115b）----
    if (ideCapsuleRef && sbBar) {
      const keys = ['pad', 'bg', 'bw', 'bc', 'r'];
      const diffs = keys.filter((k) => String(ideCapsuleRef[k]) !== String(sbBar[k])).map((k) => `${k}: ide=${ideCapsuleRef[k]} sb=${sbBar[k]}`);
      if (!diffs.length) ok('[6] 沙盒调试条与编译侧仿真胶囊 css 全等', J([sbBar.pad, sbBar.bg, sbBar.r]));
      else bad('[6] 胶囊不一致', diffs.join(' | '));
      // ---- [7] 两侧速度滑条同宽（90px 契约）----
      if (ideCapsuleRef.sliderW === sbBar.sliderW) ok('[7] 两侧速度滑条同宽', sbBar.sliderW + 'px');
      else bad('[7] 滑条宽度分叉', `ide=${ideCapsuleRef.sliderW} sb=${sbBar.sliderW}`);
    } else if (sbBar && ideProbe && !ideProbe.capsule) {
      // 那颗 [data-testid="sim-lock-toggle"]（旧 App 的仿真锁定胶囊）随旧 React UI 退役，
      // 编译侧现在能看见的锚点原样打出来：对照物不存在 ⇒ 这一臂不作数（⛔ 记成产品坏了）
      skip('[6] 调试条胶囊＝编译侧同款胶囊',
        `编译侧没有 sim-lock-toggle：index.html 现读 data-testid=${J(ideProbe.testids)}（旧仿真胶囊已退役）`);
      skip('[7] 两侧速度滑条同宽（90px 契约）', '同一前置：编译侧胶囊读数拿不到');
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
  console.log(`\n===== R115 sidebar-align: PASS=${pass} FAIL=${fail} UNVERIFIED=${unver} =====`);
  process.exitCode = fail ? 1 : 0;
})();
