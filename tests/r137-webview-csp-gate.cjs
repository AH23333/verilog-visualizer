// R137 闸门：**壳里那份 CSP 之下，这张画布到底跑不跑得起来**（无头判据，⛔ 开扩展开发宿主）。
//
// 起因：R136 壳落地时 `buildCsp` 的 `script-src` 只写了 nonce，`style-src` 只写了 cspSource。
// 而 `index.html` 里有两颗 **CDN `<link rel=stylesheet>`**（Prism 主题），且构建后的 chunk 图是
// `index.js --动态import()--> browserHost/vscodeHost.js`（宿主层按宿主挑实现）。
// 这两件事在 dev 服务器上**完全看不见**（dev 不带 CSP），只在壳里现形。
//
// 这颗闸门把三件事分开判，⛔ 用同一份页面既设靶子又报"零违规"：
//   `/`          ＝ 壳现在这份 CSP（含探针，⛔ 无 nonce 靶子）
//   `/__trap`    ＝ 同一份 CSP ＋一颗故意不带 nonce 的内联脚本（只为验"CSP 真在拦"）
//   `/__strict`  ＝ 把 `script-src` 里那颗 cspSource 摘掉（变异份，判它有没有牙）
//
// CSP 与资产改写**都从 `extension/src/html.ts` 现读**（esbuild 就地编成 CJS 再 require），
// ⛔ 在本文件里抄一份 CSP 字符串——抄的那份红了也证明不了壳里那份是对的。
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UI = require('./_ui.cjs');
const PORT = 1803;
const ORIGIN = `http://localhost:${PORT}`;
const URL = `${ORIGIN}/`;
const sleep = UI.sleep;
const J = (o) => { try { return JSON.stringify(o); } catch { return String(o); } };
let pass = 0, fail = 0, unver = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unver++; console.log(`  UNVERIFIED  ${n} — ${d}`); };

/** 把壳那份纯 TS 的改写器现编成 CJS（单一真源，⛔ 抄第二份） */
function loadHtmlModule() {
  const esbuild = require(path.join(ROOT, 'extension', 'node_modules', 'esbuild'));
  const res = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'extension', 'src', 'html.ts')],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

/** 只服务 dist/（＋两颗探针虚拟文件）的静态服务器 */
function serve(distDir, pages, virtual) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const raw = decodeURIComponent((req.url || '/').split('?')[0]);
      if (pages[raw] != null) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return void res.end(pages[raw]); }
      if (virtual[raw] != null) { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return void res.end(virtual[raw]); }
      const rel = path.normalize(raw.replace(/^\/+/, ''));
      const file = path.join(distDir, rel);
      if (!file.startsWith(distDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return void res.end('404');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

/** 探针 A：内联 nonce 模块 → 动态 import 一颗真分块（先证明"能不能取"） */
const probeInline = (chunkUrl) => `<script type="module">
window.__p = { dyn: 'pending', wasm: 'pending', djs: 'pending' };
try { const m = await import('${chunkUrl}'); window.__p.dyn = 'ok:' + Object.keys(m).sort().join(','); }
catch (e) { window.__p.dyn = 'err:' + (e && e.name) + ':' + String(e && e.message).slice(0, 70); }
try { const b = await (await fetch('/yosys/yosys.wasm')).arrayBuffer();
  const mod = await WebAssembly.compile(b); window.__p.wasm = 'ok:' + mod.constructor.name + ':' + b.byteLength + 'B'; }
catch (e) { window.__p.wasm = 'err:' + (e && e.name) + ':' + String(e && e.message).slice(0, 70); }
window.__p.djs = typeof window.digitaljs;
<\/script>`;

/** 探针 B：**外联** nonce 模块 → 动态 import（= 构建产物 `index.js` 挑宿主实现那条真路） */
const probeExternalTag = '<script type="module" src="/__probeB.js"></script>';

const collectViolations = () => {
  window.__v = [];
  window.addEventListener('securitypolicyviolation', (e) => {
    window.__v.push(String(e.blockedURI).slice(0, 46) + '|' + String(e.effectiveDirective));
  });
};

const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p && p.model.getCell(id); const v = c && c.findView(p);
  if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });
async function wire(page, s, sp, t, tp) {
  const a = await portCenter(page, s, sp); const b = await portCenter(page, t, tp);
  if (!a || !b) return false;
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(120);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await sleep(100);
  await page.mouse.move(b.x, b.y, { steps: 6 }); await sleep(250); await page.mouse.up(); await sleep(500);
  return true;
}

/** 挂载并读探针（A＋B），⛔ 在这里放宽判据——读数原样交给调用方判 */
async function open(browser, url, waitMs = 1800) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(collectViolations);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 110)));
  page.on('console', (m) => { if (/error/i.test(m.type())) errors.push('console: ' + m.text().slice(0, 110)); });
  let mounted = false;
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { });
  try { await page.waitForFunction(() => { const r = document.querySelector('#root'); return !!r && r.children.length > 0; }, null, { timeout: 30000 }); mounted = true; } catch { }   // 波次四：生产入口通用挂载证据（#root×React），⛔ 绑夹具活动栏
  await sleep(waitMs);
  const out = await page.evaluate(() => ({
    hasCsp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '',
    base: (document.querySelector('base') || {}).href || null,
    scripts: document.querySelectorAll('script').length,
    withNonce: document.querySelectorAll('script[nonce]').length,
    p: window.__p || null, pb: window.__pb || null, nononce: window.__nononce,
    v: (window.__v || []).slice(),
  })).catch((e) => ({ evalErr: String(e).slice(0, 80) }));
  return { ctx, page, errors, mounted, out };
}

(async () => {
  let srv, browser;
  try {
    const { buildCsp, rewriteWebviewHtml } = loadHtmlModule();
    console.log('产物新鲜度:', UI.ensureFreshDist(ROOT));
    const distDir = path.join(ROOT, 'dist');
    const rawIndex = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    const chunk = fs.readdirSync(path.join(distDir, 'assets')).find((f) => /^browserHost-.*\.js$/.test(f));
    if (!chunk) {
      console.log('FATAL dist/assets 里没有 browserHost 分块 ⇒ 宿主层不再代码分割了？先读 vite.config 与 src/lib/host/host.ts 再动这颗闸门');
      bad('[0] 有可被判的真实动态分块', 'dist/assets 找不到 browserHost-*.js');
      throw new Error('no chunk');
    }
    const chunkUrl = '/assets/' + chunk;
    const probeB = `window.__pb = 'pending';
import('${chunkUrl}').then(m => window.__pb = 'ok:' + Object.keys(m).sort().join(','))
  .catch(e => window.__pb = 'err:' + (e && e.name) + ':' + String(e && e.message).slice(0, 70));`;

    const mk = ({ strict = false, trap = false } = {}) => {
      const nonce = Array.from({ length: 32 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
      const seeded = rawIndex.replace('</body>', probeInline(chunkUrl) + probeExternalTag + '</body>');
      let html = rewriteWebviewHtml({ rawHtml: seeded, assetUri: (rel) => (rel ? '/' + rel : '/'), cspSource: ORIGIN, nonce });
      if (strict) html = html.replace(/content="[^"]*"/, (m) => m.replace(/script-src [^;]*/, (s) => s.replace(ORIGIN, '').replace(/\s+/g, ' ')));
      // 靶子⛔ 交给改写器（它会给每颗 `<script>` 挂 nonce），且只放进 `/__trap` 那一份
      if (trap) html = html.replace('</body>', '<script id="trap">window.__nononce = 1;</script></body>');
      return html;
    };
    const home = mk();
    const trap = mk({ trap: true });
    const strict = mk({ strict: true });
    if (home === trap || home === strict) { bad('[0a] 三份页面真的互不相同（改了个空串就宣称有变异）', J({ t: home === trap, s: home === strict })); throw new Error('pages identical'); }
    if (!/script-src[^;]*localhost/.test(strict.match(/content="[^"]*"/)[0])) console.log('  [现场] 变异份 script-src 已摘掉 origin ✓');
    console.log('  [现场] 壳这份 CSP:', /script-src [^;]*/.exec(buildCsp(ORIGIN, 'N'))[0]);
    console.log('  [现场]           ', /style-src [^;]*/.exec(buildCsp(ORIGIN, 'N'))[0]);

    srv = await serve(distDir, { '/': home, '/__trap': trap, '/__strict': strict }, { '/__probeB.js': probeB });
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });

    // ================= 固定份 =================
    const H = await open(browser, URL);
    const dom = H.out;
    console.log('  [现场] 挂载:', H.mounted, '| <script>', dom.scripts, '颗 / 带 nonce', dom.withNonce, '颗');
    console.log('  [现场] 探针A(内联→import):', J(dom.p && dom.p.dyn), '| 探针B(外联→import):', J(dom.pb));
    console.log('  [现场] 探针(wasm/djs):', J(dom.p && { wasm: dom.p.wasm, djs: dom.p.djs }));
    console.log('  [现场] violations:', J(dom.v), '| console/pageerror', H.errors.length, '条');

    (H.mounted ? ok : bad)('[0] CSP 之下应用挂载（React 真进页面）', H.mounted ? 'rail 在' : '没挂载 ⇒ 整页判据作废');
    ((dom.hasCsp && dom.base && dom.scripts > 0 && dom.withNonce === dom.scripts) ? ok : bad)(
      '[1] CSP + <base> + 每颗 <script> 都挂上 nonce（三件套真进了文档）',
      `csp=${dom.hasCsp} base=${J(dom.base)} nonce ${dom.withNonce}/${dom.scripts}`);

    const bothOk = dom.p && /^ok:/.test(dom.p.dyn) && /^ok:/.test(String(dom.pb));
    (bothOk ? ok : bad)('[2] 两条 import() 路都放行：内联探针 + **外联 chunk**（宿主层挑实现那条真路）',
      `A=${J(dom.p && dom.p.dyn)} B=${J(dom.pb)}`);

    const wasmOk = dom.p && /^ok:/.test(dom.p.wasm);
    (wasmOk ? ok : bad)('[4] CSP 下能编译 yosys.wasm（script-src 的 wasm-unsafe-eval 那条）', dom.p && dom.p.wasm);

    const djsOk = dom.p && dom.p.djs === 'object';
    (djsOk ? ok : bad)('[5] CSP 下 digitaljs 全局可用（bundle 里那两处 new Function 是死支）', 'typeof digitaljs = ' + (dom.p && dom.p.djs));

    const prism = dom.v.filter((x) => /prism|style-src/.test(x));
    (prism.length === 0 ? ok : bad)('[6] CSP 下 Prism 那张 CDN 样式表没被拒（style-src 收着 cdnjs）', J(prism.slice(0, 2)));

    // ---- 全流程：CSP 下进沙盒画电路、真起仿真 ----
    // 波次四语义迁移：生产包沙盒画布的主人是 **doc.html（custom editor）**，index.html 是编译面——
    //   "画电路真起仿真"这段的当代正路＝假宿主推空文档进真 webview（qc-paused 同型通道，同一壳内 CSP）。
    //   旧"清五件套 localStorage 再 newSandboxFile"路随 store 退役（且那行本带 forEach 括号错位死码）。
    {
      const DH = require('./_dochost.cjs');
      const docName = 'csp_probe.djs';
      await DH.installFakeHost(H.page, {
        seedId: 'r137-' + Date.now(), docName,
        files: { [docName]: JSON.stringify({ cells: [] }) },
      });
      await DH.bootDoc(H.page, PORT, { settle: 1600 });
    }
    try { await H.page.locator('button:has-text("Skip")').click({ timeout: 2500 }); } catch { }
    for (const g of ['Input', 'Input', 'And', 'Lamp']) { await UI.clickGate(H.page, g); await sleep(450); }
    const ids = await H.page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter((c) => !c.isLink()).forEach((c) => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    if (!ids || !ids.And) bad('[7] CSP 下能放件、连线并真起仿真', '沙盒里一个与门都放不出来');
    else {
      const inPorts = await H.page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter((x) => x.group === 'in').map((x) => x.id), ids.And[0]);
      const w = [await wire(H.page, ids.Input[0], 'out', ids.And[0], inPorts[0]),
        await wire(H.page, ids.Input[1], 'out', ids.And[0], inPorts[1]),
        await wire(H.page, ids.And[0], 'out', ids.Lamp[0], 'in')];
      const links = await H.page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
      for (const iId of ids.Input) {
        const pt = await H.page.evaluate((id) => {
          const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
          const b = v.el.querySelector('.btnface') || v.el.querySelector('.body') || v.el;
          const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, iId);
        await H.page.mouse.click(pt.x, pt.y); await sleep(700);
      }
      const lamp = await H.page.evaluate((l) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(l).findView(p);
        const led = v && v.el.querySelector('.led'); return led ? getComputedStyle(led).fill : null;
      }, ids.Lamp[0]);
      console.log('  [现场] 放置/连线/仿真:', J({ links, w, lamp }));
      (/3, 192, 60|#03c03c/.test(String(lamp)) && links >= 3 ? ok : bad)(
        '[7] CSP 下能放件、连线并真起仿真（与门把灯点亮）', `links=${links} 连线=${J(w)} 灯=${J(lamp)}`);
    }

    const vAll = await H.page.evaluate(() => (window.__v || []).slice());
    (vAll.length === 0 ? ok : bad)('[8] 首屏＋全流程零 securitypolicyviolation（字体/blob/运行时注样式的兜底）', J(vAll.slice(0, 4)));
    const hostile = H.errors.filter((e) => /Content Security Policy/.test(e));
    (hostile.length === 0 ? ok : bad)('[8b] 固定份控制台没有 CSP 拒绝信息', J(hostile.slice(0, 2)));
    await H.ctx.close();

    // ================= 靶子份：CSP 真在拦东西 =================
    const T = await open(browser, `${URL}__trap`, 1200);
    const trapBlocked = T.out.nononce === undefined;
    const trapViolation = (T.out.v || []).some((x) => /script-src/.test(x));
    (trapBlocked && trapViolation ? ok : bad)('[3] 无 nonce 的内联脚本被拦（CSP 确实在生效，⛔ 只是没测到）',
      `__nononce=${J(T.out.nononce)} script-violations=${T.out.v.filter((x) => /script/.test(x)).length}`);
    await T.ctx.close();

    // ================= 变异份：摘掉 script-src 的 origin 有没有牙 =================
    const S = await open(browser, `${URL}__strict`);
    const strictSrc = /script-src [^;]*/.exec(S.out.csp || '')[0];
    const sBlocked = (x) => /^err:/.test(String(x));
    const hostChunkRefused = S.errors.filter((e) => /Content Security Policy/.test(e) && /assets|\.js/.test(e));
    console.log('  [现场] 变异份 script-src:', strictSrc);
    console.log('  [现场] 变异份 挂载:', S.mounted, '| A:', J(S.out.p && S.out.p.dyn), '| B:', J(S.out.pb));
    console.log('  [现场] 变异份 violations:', J(S.out.v.slice(0, 3)), '| CSP 拒绝条数', hostChunkRefused.length);
    const hasTeeth = sBlocked(S.out.pb) || sBlocked(S.out.p && S.out.p.dyn) || hostChunkRefused.length > 0 || !S.mounted;
    if (hasTeeth) ok('[9] 变异臂：摘掉 script-src 的 origin ⇒ 这条 import() 路当场被拒（那颗不是装饰）',
      `挂载=${S.mounted} A=${J(S.out.p && S.out.p.dyn)} B=${J(S.out.pb)} CSP拒绝=${hostChunkRefused.length} 条`);
    else skip('[9] 变异臂无牙（这颗闸门在本浏览器判不了 cspSource 的必要性）',
      '摘掉 origin 后 import() 仍放行 ⇒ 该 Chromium 把调用方 script 的 nonce 传给了 import()。cspSource 保留＝⛔ 已测缺陷的修法，＝对"nonce 是否传递"这件事不做赌注');
    await S.ctx.close();

    const cspStr = buildCsp(ORIGIN, 'NONCE');
    (!/script-src[^;]*unsafe-inline/.test(cspStr) ? ok : bad)('[10] script-src 里⛔ unsafe-inline（⛔ 为省事把 CSP 关掉）',
      /script-src [^;]*/.exec(cspStr)[0]);
  } catch (e) {
    console.log('FATAL', String((e && e.stack) || e).slice(0, 300));
    bad('[F] 闸门跑完了（没有中途抛错）', String((e && e.message) || e).slice(0, 160));
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (srv) srv.close(); } catch { }
  }
  console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unver} unverified =====`);
  process.exit(fail > 0 ? 1 : 0);
})();
