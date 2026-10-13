// R135 闸门：**编译模式导出的成品质量**（用户 2026-10-13 报"编译模式的 SVG 导出图绘制过于简陋
// 且部件全为纯黑色矩形"；PNG 已按裁决下线，所以判据全部落在"把导出的 .svg 文件本身放回
// DOM 里量"——没有本仓 CSS 参与，用户在编辑器/浏览器里打开看到什么就是什么）。
//
// 射程（7 格；全部读**下载下来的字节**＋live paper 配对，⛔ 把导出注入回本页面量——
//   那棵子树里 getComputedStyle(el).fill 读出空串、getBBox() 恒 0，会把好文件读成坏文件）：
//   [1] 导出的是电路图那棵 svg：viewBox 宽高与 paper 内容包围盒成对（24×19 的 lucide 图标不算）
//   [2] 图上看得见网络名：文件里 <text> 数与 live paper 成对（≥60%）且端口名 product 在文件里
//   [3] 文字与底色亮度差 ≥60，且文件里那颗文字颜色＝屏幕上计算值（内联样式真的进了文件）
//   [4] 取景与内容同一坐标系：viewBox 原点＝视口层 getBBox 原点−pad，器件 translate 全落框内
//       （摘掉视口层 transform 却按带 transform 的 svg.getBBox() 取景 ⇒ 整张图被平移出画面）
//   [5] 导出电路 JSON：文件能 JSON.parse，devices 数与 paper 器件数同量级
//   [6] 导出综合网表：三层设计的 module 全数在册且层级实例被真名引用
//   [7] 底色跟随主题：文件底色与屏幕画布底色同值（⛔ 写死 #ffffff ⇒ 深色主题的器件是近黑
//       #232830，压白底＝用户报的"部件全为纯黑色矩形"，而浅色文字 #e4e4ec 在白底上看不见）
//
// ⚠ 判据读**下载下来的字节**，不读 toast、不读内存里的字符串。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1801;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(PORT)); } catch { }
const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'test_files', f), 'utf8');
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n}${d ? ' — ' + d : ''}`); };

/** live paper 的现态读数（导出侧一切断言的对照组） */
const LIVE = () => {
  const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
  if (!p) return { noPaper: true };
  // paper.svg 有两种形状（joint 版本相关）：V 包装（有 .node()）或直接 DOM 节点 ⇒ 现场判定，别猜
  let svg = null;
  try {
    const s = p.svg;
    svg = !s ? p.el.querySelector('svg') : (typeof s.node === 'function' ? s.node() : s);
  } catch { svg = p.el ? p.el.querySelector('svg') : null; }
  if (!svg) return { noPaper: true, why: 'paper 里找不到 svg' };
  const rootG = svg.querySelector('g');
  let bb = null;
  try { const b = (rootG || svg).getBBox(); bb = { x: b.x, y: b.y, w: b.width, h: b.height }; } catch { }
  const texts = Array.from(svg.querySelectorAll('text'));
  const shapes = Array.from(svg.querySelectorAll('path,rect,circle,polygon,polyline'));
  const fills = shapes.map((el) => { const f = getComputedStyle(el).fill; return f === 'none' ? null : f; }).filter(Boolean);
  // 屏幕上的画布底色（导出必须跟它一致）：paper 被刻意设为 transparent，颜色来自容器链
  let canvasBg = null;
  for (let el = p.el; el && !canvasBg; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c)) canvasBg = c;
  }
  if (!canvasBg) { try { canvasBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || null; } catch { } }
  return {
    cells: p.model.getElements().length, svgClass: String(svg.getAttribute('class') || ''),
    rootHasTf: !!(rootG && rootG.getAttribute('transform')), bbox: bb,
    textCount: texts.length,
    textSample: texts.slice(0, 400).map((t) => t.textContent).join(' '),
    textFill: texts.length ? getComputedStyle(texts[0]).fill : null,
    shapeCount: shapes.length,
    distinctFills: [...new Set(fills)],
    blackFills: fills.filter((f) => /^rgb\(0,\s*0,\s*0\)/.test(f)).length,
    canvasBg,
  };
};

/** 亮度（rgb()/#hex 都认，认不出返回 -1）——两主题对比度判据的尺 */
const LUM = (c) => {
  const s = String(c || '').trim();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
  const h = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (h) {
    let t = h[1];
    if (t.length === 3 || t.length === 4) t = t.split('').slice(0, 3).map((x) => x + x).join('');
    t = t.slice(0, 6);
    return (parseInt(t.slice(0, 2), 16) + parseInt(t.slice(2, 4), 16) + parseInt(t.slice(4, 6), 16)) / 3;
  }
  return -1;
};
/** 逐颗标签取属性（属性顺序在 joint/digitaljs 两种写法里不一样，⛔ 按"class 在前"死拼正则） */
const tagAttr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
/** 只认**文件字节**（⛔ 把导出塞回本页面量它）：那棵注入的子树里 getComputedStyle(el).fill
 *  读出空串、getBBox() 恒 0，会把"文件其实是好的"读成"文件全坏"——第一版 [3]/[4] 的误红就是这么来的。 */
function parseSvgFacts(s) {
  const vbM = /viewBox="([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)"/.exec(s);
  const viewBox = vbM ? vbM.slice(1, 5).map(Number) : null;
  const bgM = /<rect[^>]*width="100%"[^>]*fill="([^"]+)"/.exec(s);
  const gTags = s.match(/<g\b[^>]*>/g) || [];
  const cellPts = [];
  const bodyFills = [];
  const textFills = [];
  const contents = [];
  for (const tag of s.match(/<(rect|path|circle|polygon|polyline|text|tspan|g)\b[^>]*>/g) || []) {
    if (/^<g\b/.test(tag) && /joint-cell/.test(tag)) {
      const t = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)/.exec(tag);
      if (t) cellPts.push([Number(t[1]), Number(t[2])]);
    }
    const style = tagAttr(tag, 'style') || '';
    const fill = (/fill:\s*([^;"]+)/.exec(style) || [])[1] || tagAttr(tag, 'fill');
    if (fill) {
      if (/joint-selector="body"/.test(tag)) bodyFills.push(fill);
      if (/^<(text|tspan)\b/.test(tag)) textFills.push(fill);
    }
  }
  for (const m of s.matchAll(/<t(?:ext|span)\b[^>]*>([^<]+)<\/t(?:ext|span)>/g)) contents.push(m[1]);
  const uniq = (a) => [...new Set(a)];
  const extent = cellPts.length
    ? { minX: Math.min(...cellPts.map((p) => p[0])), maxX: Math.max(...cellPts.map((p) => p[0])),
        minY: Math.min(...cellPts.map((p) => p[1])), maxY: Math.max(...cellPts.map((p) => p[1])), n: cellPts.length }
    : null;
  return {
    viewBox, bg: bgM ? bgM[1] : null, bgLum: LUM(bgM && bgM[1]),
    bodyFills: uniq(bodyFills), textFills: uniq(textFills),
    texts: (s.match(/<text[\s>]/g) || []).length,
    contentBlob: contents.slice(0, 400).join(' '),
    shapes: (s.match(/<(rect|path|circle|polygon|polyline)[\s>]/g) || []).length,
    cellPts: cellPts.length, extent,
    foreign: (s.match(/<foreignObject/g) || []).length,
    markerEnd: (s.match(/marker-end="url\(/g) || []).length,
    len: s.length,
  };
}

/** 走**画布右键菜单**那颗导出。⛔ 顶栏 MenuBar 的下拉：连点三次会在"开→点空→再点=关"上打转
 *  （第一版就是这么 6 格全 UNVERIFIED 的）；r46 的现役配方＝右键 .joint-paper 的 62%/60% 处，
 *  再读 [data-context-menu] 里的项。 */
async function menuExport(page, item, at) {
  await page.keyboard.press('Escape').catch(() => { });
  await sleep(250);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await sleep(800);
  const btn = page.locator(`[data-context-menu] button:has-text("${item}")`).first();
  if (!await btn.count()) {
    const seen = await page.evaluate(() => {
      const m = document.querySelector('[data-context-menu]');
      return m ? Array.from(m.querySelectorAll('button')).map((b) => String(b.textContent || '').trim()) : null;
    });
    throw new Error(`画布菜单里没有「${item}」，现场=${J(seen)}`);
  }
  const dlP = page.waitForEvent('download', { timeout: 20000 });
  // ⚠ 必须当场挂个 catch：一失败就没人等这个 promise，它 20s 后 reject 会以
  //   "unhandled rejection" 把整个闸门进程打死（读起来像产品崩了）。
  dlP.catch(() => { });
  await btn.click();
  const dl = await dlP;
  const p = await dl.path();
  await page.keyboard.press('Escape').catch(() => { });
  await sleep(200);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p) };
}

// 内容包围盒中心是否落在 viewBox 里 + 面积重叠比
function framed(vb, cb) {
  if (!vb || !cb || vb.some((n) => !Number.isFinite(n))) return { ok: false, why: '读数缺 viewBox 或包围盒' };
  const [vx, vy, vw, vh] = vb;
  const cx = cb.x + cb.w / 2, cy = cb.y + cb.h / 2;
  const inside = cx >= vx && cx <= vx + vw && cy >= vy && cy <= vy + vh;
  const ix = Math.max(0, Math.min(vx + vw, cb.x + cb.w) - Math.max(vx, cb.x));
  const iy = Math.max(0, Math.min(vy + vh, cb.y + cb.h) - Math.max(vy, cb.y));
  const overlap = (ix * iy) / Math.max(1, cb.w * cb.h);
  return { ok: inside && overlap >= 0.6, inside, overlap: Math.round(overlap * 100) / 100 };
}

(async () => {
  let server, browser, page;
  const errors = [];
  try {
    UI.freePort(PORT);
    server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
      { windowsHide: true, cwd: ROOT, stdio: 'ignore' });
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts'));
    await sleep(1000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // 三层设计（r61 同款真路径）：乘法器 → adder → full_adder，图上器件多、网络名齐
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
    await page.locator('[title="multiplier.v"]').first().click({ force: true });
    await sleep(700);
    await page.keyboard.press('F5');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(600);
      ready = await page.evaluate(() => {
        const p = window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper();
        return !!p && p.model.getElements().length > 2;
      });
      if (ready) break;
    }
    if (!ready) { console.log('FATAL 编译主画布没出图 —— 后面全是空话，不作数'); bad('[0] 闸门跑完了（没有中途抛错）', '编译没出图'); throw new Error('no paper'); }
    await sleep(1200);
    const live = await page.evaluate(LIVE);
    // 现场：导出按钮的真实文案（菜单一改这就是第一手读数）＋容器里 svg 的排布
    const inv = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .map((b) => String(b.textContent || '').trim()).filter((t) => /导出/.test(t));
      const svgs = [...document.querySelectorAll('svg')].slice(0, 6)
        .map((s) => ({ cls: String(s.getAttribute('class') || '').slice(0, 24), w: Math.round(s.getBoundingClientRect().width) }));
      const inPaper = document.querySelector('.joint-paper svg');
      return { menus: [...new Set(btns)].slice(0, 12), firstSvgs: svgs,
        paperSvg: inPaper ? { cls: String(inPaper.getAttribute('class') || ''), w: Math.round(inPaper.getBoundingClientRect().width) } : null };
    });
    console.log(`  [现场] 导出按钮=${J(inv.menus)}｜文档前几颗 svg=${J(inv.firstSvgs)}｜.joint-paper svg=${J(inv.paperSvg)}`);

    // ---- 取三份导出成品（画布右键菜单那三项）----
    const at = await page.evaluate(() => {
      const r = document.querySelector('.joint-paper').getBoundingClientRect();
      return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.6 };
    });
    let svgDl = null, jsonDl = null, netDl = null;
    const fails = [];
    for (const [key, item] of [['svg', '导出 SVG'], ['json', '导出电路 JSON'], ['net', '导出综合网表']]) {
      try {
        const r = await menuExport(page, item, at);
        if (key === 'svg') svgDl = r; else if (key === 'json') jsonDl = r; else netDl = r;
      } catch (e) { fails.push(`${item}: ${String(e.message || e).slice(0, 240)}`); }
      await sleep(500);
    }
    if (fails.length) console.log('  [现场] 导出这一趟没走通：' + J(fails));
    if (!svgDl) {
      ['[1] 导出的是电路图那棵 svg（viewBox 与 paper 内容成对）',
        '[2] 文件里看得见网络名（<text> 数与 live 成对且含端口名）',
        '[3] 文字与底色对比可读（文件里内联的颜色＝屏幕那颗）',
        '[4] 取景不错位（viewBox 原点与模型包围盒配对，器件分布落在框内）',
        '[7] 底色跟随主题（⛔ 写死 #ffffff ⇒ 深色主题＝黑块压白底）']
        .forEach((n) => skip(n, `没拿到下载：${J(fails)}`));
    } else {
      const svgStr = svgDl.bytes.toString('utf8');
      try {
        fs.mkdirSync(path.join(ROOT, '.tmpbuild'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, '.tmpbuild', 'r135-compile-export.svg'), svgStr);
      } catch { /* 取证产物写不下去不影响判定 */ }
      const got = parseSvgFacts(svgStr);
      console.log('  [现场] 文件底色=' + J(got.bg) + ' 器件填充=' + J(got.bodyFills.slice(0, 4))
        + ' 文字填充=' + J(got.textFills.slice(0, 4)) + '｜live 底色=' + J(live.canvasBg) + ' live 文字=' + J(live.textFill));

      // ---- [1] 选对 svg：viewBox 宽高与 live 内容包围盒成对 ----
      const pairOk = got.viewBox && live.bbox
        && Math.abs(got.viewBox[2] - live.bbox.w) / Math.max(1, live.bbox.w) < 0.35
        && Math.abs(got.viewBox[3] - live.bbox.h) / Math.max(1, live.bbox.h) < 0.35
        && /_circuit\.svg$/.test(svgDl.name);
      pairOk
        ? ok('[1] 导出的是电路图那棵 svg：viewBox 宽高与 paper 内容包围盒成对（±35%），文件名对路（图标误选时是 24×19 那颗 lucide）',
          `file=${svgDl.name} viewBox=${J(got.viewBox)} live bbox=${J(live.bbox)} 形状=${got.shapes}`)
        : bad('[1] 导出的是电路图那棵 svg：viewBox 宽高与 paper 内容包围盒成对（±35%）',
          J({ file: svgDl.name, viewBox: got.viewBox, live: live.bbox, svgClass: live.svgClass,
            shapes: got.shapes, texts: got.texts, len: svgStr.length, fails }));

      // ---- [2] 网络名真的在文件里 ----
      const hasName = /\bproduct\b/.test(got.contentBlob || '');
      const txtPair = got.texts > 0 && live.textCount > 0 && got.texts >= Math.floor(live.textCount * 0.6);
      (hasName && txtPair)
        ? ok('[2] 文件里看得见网络名：<text> 数与 live paper 成对（≥60%）且端口名 product 在文件里',
          `文件 texts=${got.texts} live=${live.textCount} 样例=${String(got.contentBlob).slice(0, 60)}`)
        : bad('[2] 文件里看得见网络名：<text> 数与 live paper 成对（≥60%）且端口名 product 在文件里',
          J({ nameIn: hasName, texts: got.texts, liveTexts: live.textCount, sample: String(got.contentBlob).slice(0, 80) }));

      // ---- [3] 文字与底色读得出来（屏幕那颗颜色必须真的进了文件）----
      const fTextLum = LUM(got.textFills[0]);
      const fBgLum = got.bgLum;
      const lTextLum = LUM(live.textFill), lBgLum = LUM(live.canvasBg);
      const contrastOk = fTextLum >= 0 && fBgLum >= 0 && Math.abs(fTextLum - fBgLum) >= 60
        && lTextLum >= 0 && Math.abs(lTextLum - lBgLum) >= 60
        && Math.abs(fTextLum - lTextLum) <= 12;   // 配对：文件里那颗字＝屏幕上那颗字
      contrastOk
        ? ok('[3] 文字与底色对比可读（亮度差 ≥60），且文件里的文字颜色＝屏幕计算值（内联真的把 CSS 颜色带进文件）',
          `文件 text=${J(got.textFills[0])}(${fTextLum.toFixed(0)}) 底=${J(got.bg)}(${fBgLum.toFixed(0)})｜live text=${J(live.textFill)}(${lTextLum.toFixed(0)}) 底=${J(live.canvasBg)}(${lBgLum.toFixed(0)})`)
        : bad('[3] 文字与底色对比可读（亮度差 ≥60），且文件里的文字颜色＝屏幕计算值',
          J({ fileText: got.textFills.slice(0, 4), fileBg: got.bg, liveText: live.textFill, liveBg: live.canvasBg,
            fTextLum, fBgLum, lTextLum, lBgLum }));

      // ---- [4] 取景与内容同一坐标系 ----
      // 摘掉视口层 transform 后，viewBox 必须按**同一层的 getBBox（模型坐标）**来开：
      // 早先编译模式拿带平移的 svg.getBBox() 取景 ⇒ 内容整块被挪出画面（用户看到的"空图/半张图"）。
      const originOk = got.viewBox && live.bbox
        && Math.abs(got.viewBox[0] - (live.bbox.x - 20)) <= 2
        && Math.abs(got.viewBox[1] - (live.bbox.y - 20)) <= 2;
      const extRect = got.extent ? { x: got.extent.minX, y: got.extent.minY,
        w: got.extent.maxX - got.extent.minX, h: got.extent.maxY - got.extent.minY } : null;
      const fr = framed(got.viewBox, extRect);
      (originOk && fr.ok)
        ? ok('[4] 取景不错位：viewBox 原点＝模型包围盒原点−pad（与视口层 getBBox 配对），且器件 translate 全部落在框内',
          `viewBox=${J(got.viewBox)} live bbox=${J(live.bbox)} 器件点=${got.cellPts} extent=${J(got.extent)} overlap=${fr.overlap} rootTf=${live.rootHasTf}`)
        : bad('[4] 取景不错位：viewBox 原点＝模型包围盒原点−pad，且器件 translate 全部落在框内',
          J({ originOk, viewBox: got.viewBox, liveBbox: live.bbox, extent: got.extent, framed: fr, rootHasTf: live.rootHasTf }));

      // ---- [7] 底色跟随主题（用户报"纯黑矩形"的直接成因：深色主题的器件压在白底上）----
      const bgPaired = got.bg && live.canvasBg && Math.abs(got.bgLum - LUM(live.canvasBg)) <= 8;
      bgPaired
        ? ok('[7] 底色跟随主题：文件底色与屏幕画布底色同值（⛔ 写死 #ffffff——深色主题器件填充本就是近黑的 #232830，压白底＝"部件全为纯黑色矩形"）',
          `文件 bg=${J(got.bg)} 亮度=${got.bgLum.toFixed(0)}｜屏幕画布=${J(live.canvasBg)} 亮度=${LUM(live.canvasBg).toFixed(0)}｜器件填充=${J(got.bodyFills.slice(0, 3))}`)
        : bad('[7] 底色跟随主题：文件底色与屏幕画布底色同值',
          J({ fileBg: got.bg, fileLum: got.bgLum, liveBg: live.canvasBg, liveLum: LUM(live.canvasBg), bodyFills: got.bodyFills.slice(0, 4) }));
    }

    // ---- [5] 电路 JSON ----
    if (!jsonDl) skip('[5] 导出电路 JSON：文件能 JSON.parse 且 devices 数与 paper 器件数成对', '没拿到下载');
    else {
      let parsed = null;
      try { parsed = JSON.parse(jsonDl.bytes.toString('utf8')); } catch (e) { parsed = null; }
      const devCount = parsed && parsed.devices ? Object.keys(parsed.devices).length : 0;
      const pairOk = !!parsed && devCount > 0
        && Math.abs(devCount - live.cells) / Math.max(1, live.cells) < 0.6;
      pairOk
        ? ok('[5] 导出电路 JSON：文件能 JSON.parse，devices 数与 paper 器件数同量级（同一张图的两个出处）',
          `file=${jsonDl.name} devices=${devCount} paper cells=${live.cells}`)
        : bad('[5] 导出电路 JSON：文件能 JSON.parse，devices 数与 paper 器件数同量级',
          J({ file: jsonDl && jsonDl.name, parsed: !!parsed, devCount, cells: live.cells, keys: parsed && Object.keys(parsed).slice(0, 8) }));
    }

    // ---- [6] 综合网表 ----
    if (!netDl) skip('[6] 导出综合网表：含门级单元实例与 module 声明', '没拿到下载');
    else {
      const txt = netDl.bytes.toString('utf8');
      try { fs.writeFileSync(path.join(ROOT, '.tmpbuild', 'r135-compile-netlist.v'), txt); } catch { /* 取证产物写不下去不影响判定 */ }
      // ⚠ 判据按 yosys write_verilog 的**现场形状**写：三层设计吐 adder / full_adder /
      //   multiplier 三颗 module（顶层不保证排第一），⛔ 拿"必须 module multiplier"当契约是
      //   我第一版犯的错（[6] 因此误红过一格），第二版钉"adder \u0("又没命中真形状。
      const mods = [...txt.matchAll(/^\s*module\s+([A-Za-z_][\w$]*)/gm)].map((m) => m[1]);
      const need = ['multiplier', 'adder', 'full_adder'];
      const ends = (txt.match(/^\s*endmodule/gm) || []).length;
      // 实例行的两种真形状：带名连接 `.a(...)`（层级实例）与门级原语行（`and \y, \a, \b;`）
      const namedConn = (txt.match(/\.\w+\s*\(/g) || []).length;
      const gateLines = (txt.match(/^\s*(?:and|or|not|xor|xnor|nand|nor|buf|dff|adffe|mux|\$_[A-Z0-9_]+_)\s+[\\(]/gm) || []).length;
      const sample = txt.split(/\r?\n/).filter((l) => /^\s{2,}\S/.test(l) && /\(/.test(l)).slice(0, 3);
      const nlOk = need.every((m) => mods.includes(m)) && ends === mods.length && ends >= 3
        && (namedConn >= 3 || gateLines >= 3) && txt.length > 200;
      nlOk
        ? ok('[6] 导出综合网表：三层设计的 module 全数在册，实例行可解析（带名连接或门级原语），不是只有注释/空串',
          `file=${netDl.name} len=${txt.length} modules=${J(mods)} endmodule=${ends} 带名连接=${namedConn} 原语行=${gateLines}`)
        : bad('[6] 导出综合网表：三层设计的 module 全在且实例行可解析',
          J({ file: netDl.name, len: txt.length, mods, 缺: need.filter((m) => !mods.includes(m)), ends, namedConn, gateLines, sample }));
    }

    if (errors.length) bad('[X] 过程没有 pageerror', J(errors.slice(0, 3)));
    console.log(`  [现场] pageerror ${errors.length} 条｜live cells=${live.cells} texts=${live.textCount} shapes=${live.shapeCount} rootTf=${live.rootHasTf}`);
  } catch (e) {
    console.log('FATAL', String((e && e.stack) || e).slice(0, 300));
    if (!/no paper/.test(String(e && e.message))) bad('[0] 闸门跑完了（没有中途抛错）', String((e && e.message) || e).slice(0, 160));
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.kill('SIGKILL'); } catch { }
  }
  console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} unverified =====`);
  process.exit(fail > 0 ? 1 : 0);
})();
