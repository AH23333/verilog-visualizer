// 完全模拟真实用户：全部用真实鼠标操作（放置/连线/点击输入引脚），
// 并覆盖「保存 → 刷新 → 重开」持久化路径。生产构建 (vite preview) 下运行。
// 与 qc-realuser 的唯一差别：交一份 `autoStartSim:false` 的宿主配置，钉"仿真没起时"那一族规则。
//
// ⚠ 入口（波次三，2026-10-18）：原来开的是 dist 根路径＝旧 React 单页（活动栏 + localStorage 沙盒库），
//   那颗主人随片 5 退役 ⇒ `boot()` 等的 `button[data-activity]` 永远等不到，整格 FATAL 在 30s。
//   生产包里的沙盒只剩一颗主人＝`doc.html`（gates.html ⛔ 在 `vite build` 的 inputs 里，正本 `vite.config.ts:19-25`），
//   ⇒ 入口搬到 doc.html + `tests/_dochost.cjs` 的同协议假宿主：量的仍是**构建产物**，只是终于量在产品真身上。
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright-core'));
const DH = require('./_dochost.cjs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 4174;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(4174)); } catch { }
const URL = DH.DOC_URL(PORT);
const DOC = 'qc/paused_circuit.djs';
const EMPTY = JSON.stringify({ cells: [] });
// 宿主推送单（形状正本 `src/lib/host/host.ts` 的 HostConfig）：这一颗只把 autoStartSim 关掉，
// 其余按默认——`settingsStore.applyHostConfig` 会 `{...DEFAULT_SANDBOX, ...cfg.sandbox}` 落店。
const CFG_PAUSED = { ...DH.DEFAULT_CONFIG, sandbox: { autoStartSim: false } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 跑批只认 PASS/FAIL 行：本格原来通篇 `>>>` 叙述、一条断言都不打 ⇒ NOVERDICT 被 FATAL 盖成 RED，
// 谁也没法说它到底判了什么。下面把三条真实交互结论各钉一颗判据。
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
async function waitForServer(t = 20000) {
  const d = Date.now() + t;
  while (Date.now() < d) { try { const r = await fetch(URL); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}
// 真实鼠标点击调色板按钮（不用 JS click）
async function realClickGate(page, label) {
  await require('./_ui.cjs').ensurePalette(page);
  const btn = page.locator(`button[data-gate="${label}"]`);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();           // Playwright 真实鼠标点击
  await sleep(500);
}
const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper; const c = p.model.getCell(id); const v = c?.findView(p); if (!v) return null;
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
const lampState = (page, id) => page.evaluate((id) => {
  const p = window.__sandboxPaper; const l = p.model.getCell(id);
  const v = l?.findView(p)?.el?.querySelector?.('.led');
  const o = l?.get('inputSignals'); const iv = o?.in;
  return { led: v ? getComputedStyle(v).fill : null, in: iv && iv.toString ? iv.toString() : String(iv) };
}, id);
(async () => {
  let server, browser;
  try {
    try { require('child_process').execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`); } catch {}
    // 这一格量的是**构建产物**：先证明 dist 不比 src 旧，否则读的是上一版的壳（#265 一族）。
    console.log('产物新鲜度:', require('./_ui.cjs').ensureFreshDist(PROJECT_ROOT));
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log('preview:', (await waitForServer()) ? 'OK' : 'FAIL');
    browser = await PLAYWRIGHT.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    // 前置「仿真没自动起」：旧写法是往 `localStorage['verilog-viz-sandbox-settings']` 塞一颗档，
    // 而那颗 store 从片 5 起**不再持久化**（真源＝宿主 `contributes.configuration`）⇒ 今天再那么写＝写给不存在的主人。
    // 现形状＝宿主推送单：假宿主按同一条线答 `getConfig`，`applyHostConfig` 落成 autoStartSim:false。
    const seedId = `qc-paused-${Date.now()}`;
    await DH.installFakeHost(page, { seedId, docName: DOC, files: { [DOC]: EMPTY }, config: CFG_PAUSED });
    await DH.bootDoc(page, PORT, { settle: 1500 });
    const mounted = await DH.mountProbe(page);
    (mounted.paper && mounted.sidebar && mounted.gates > 0 && mounted.toolbar)
      ? ok('[0] 生产包里的 doc.html 挂起沙盒（画布 + 部件库 + 工具条都在）', `器件库 ${mounted.gates} 颗 / 画布 ${mounted.cells} 格`)
      : bad('[0] dist 的 doc.html 没挂全 ⇒ 下面各格的前置⛔ 成立', JSON.stringify(mounted));
    // 前置的另一半只能退成**够得着**的证据：这颗档跑的是 dist，`settingsStore` 那颗源模块⛔ 载得进来
    //   （`_ui.cjs` 的 `sandboxPref` 契约就写着"只认 vite dev"，它刚才在 4174 上响亮地拒了——守卫有用）。
    //   ① 这里问"画布开局有没有向宿主要过配置"，读的是假宿主记下的**发出去的字节**；
    //   ② "引擎到底起没起"留给 [1b]，那一格读的是画布上有没有信号读数。
    const asked = await DH.fakeHostReadout(page);
    (asked && asked.reqs.includes('getConfig'))
      ? ok('[0b] 画布开局向宿主问过配置（`autoStartSim` 那份推送单走的是真线）', `reqs=${JSON.stringify(asked.reqs)}`)
      : bad('[0b] 开局没问过宿主配置 ⇒ "非运行态"这一族的前提⛔ 成立', `reqs=${JSON.stringify(asked && asked.reqs)}`);

    console.log('===== 真实鼠标放置 + 连线 =====');
    await realClickGate(page, 'Input'); await realClickGate(page, 'Input');
    await realClickGate(page, 'And');  await realClickGate(page, 'Lamp');
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    放置:', JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.length]))));
    const inPorts = await page.evaluate((id) => window.__sandboxPaper.model.getCell(id).getPorts().filter(p => p.group === 'in').map(p => p.id), ids.And[0]);
    await wire(page, ids.Input[0], 'out', ids.And[0], inPorts[0]);
    await wire(page, ids.Input[1], 'out', ids.And[0], inPorts[1]);
    await wire(page, ids.And[0], 'out', ids.Lamp[0], 'in');
    const nLinks = await page.evaluate(() => window.__sandboxPaper.model.getLinks().length);
    console.log('    links =', nLinks);
    (nLinks >= 3 ? ok : bad)('[1] 生产包下真鼠标放置 + 三根连线都接上', `links=${nLinks}`);

    // [1b] 前置「引擎没自动起」的**屏幕证据**：工具条那颗钮此刻写着「运行」＝引擎没在跑
    //   （形状正本 `src/components/SandboxToolbar.tsx:72`：`running ? 「暂停」 : 「运行」`，用户看的就是这两个字）。
    //   ⚠ 我第一版把这把尺写成"灯上没有 Vector3vl 读数"，那是**我猜的**：`commit` 里那句 `seedGateOutputs`
    //     会在引擎从没跑过时就把输出播成 `Vector3vl 0`——它测的是"播过种"，⛔ 是"在跑"。
    //     这一格第一次跑就用现读 `{"in":"Vector3vl 0"}` 把那颗假尺否掉了（并把 X25 顶了出来）。
    const runBtn = await page.evaluate(() => String((document.querySelector('button[title="运行 / 暂停仿真"]') || {}).innerText || '').trim());
    console.log('    连线后、点击输入前 工具条那颗钮:', JSON.stringify(runBtn));
    const engineRan = /暂停/.test(runBtn);
    (!engineRan
      ? ok : bad)('[1b] 非运行态：工具条那颗还写着「运行」（引擎确实没起）', JSON.stringify({ runBtn }));

    // 真实点击两个输入引脚（点盒体中心，不借助内部选择器）
    for (const iId of ids.Input) {
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, iId);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
    }
    const s1 = await lampState(page, ids.Lamp[0]);
    console.log('    点击两个输入后 灯:', JSON.stringify(s1));
    // R112 判据更新：本 gate 交的是 `autoStartSim:false` 那份宿主配置（见 CFG_PAUSED + [0b] 的现读）
    //   ⇒ 电路**从不启动引擎**。用户规则「非运行状态下用户与部件交互，禁止组件传输信号」
    //   正是这个场景 ⇒ 期望「输入值可改、但信号不往下游传，灯不亮」。
    //   旧判据（要求灯亮）编码的是改动前"无条件 updateGates"的行为，与新规则冲突。
    //   ⚠ 产品侧同步修正：R103 把规则实现成"直接拒绝改输入值"，会让用户在未运行态
    //     **永远设不了输入初值**（r50 三格全红：rst 拨不动、单步没 clk）。
    //     R112 改为「值照改，只是不调 updateGates」。
    const lit1 = /3, 192, 60|#03c03c/.test(s1.led);
    if (engineRan) bad('[2] 前置没成（那颗钮写着「暂停」＝引擎已在跑）⇒ "不传播"这一格不作数', JSON.stringify({ runBtn, s1 }));
    else (!lit1 ? ok : bad)('[2] 非运行态（autoStartSim:false）：拨输入**不点亮**灯 —— 信号被禁止传输', `${JSON.stringify(s1)}（links=${nLinks}）`);
    // 输入值本身必须已经改了（证明是"不传播"，不是"拒绝交互"）
    const inpVals = await page.evaluate((list) => list.map((id) => {
      const c = window.__sandboxPaper.model.getCell(id);
      const o = c.get('outputSignals'); const v = o && (o.out ?? Object.values(o)[0]);
      return v == null ? 'null' : String(v).replace(/^Vector3vl\s+/, '');
    }), ids.Input);
    (inpVals.some((v) => /1/.test(v)) ? ok : bad)
      ('[2a] 非运行态下**输入值仍可改**（只是不传播）', JSON.stringify(inpVals));

    // 点「运行」⇒ 引擎启动 ⇒ 传播恢复，灯应点亮。
    // ⚠ 旧写法在找不到那颗钮/抛错时只 `console.log('跳过')`——跑批读不到判据，
    //   那一格就等于没判（还占一颗编号）。工具条在 [0] 已按屏幕证实挂着，这里⛔ 再留静默出口。
    {
      const toggle = page.locator('button[title="运行 / 暂停仿真"]').first();
      if (!(await toggle.count())) bad('[2b] 工具条上没有「运行 / 暂停仿真」那颗钮 ⇒ 这一格没判', '见 [0] 的 mounted.toolbar 读数');
      else {
        await toggle.click({ force: true }); await sleep(1400);
        const sRun = await lampState(page, ids.Lamp[0]);
        const litRun = /3, 192, 60|#03c03c/.test(sRun.led);
        (litRun ? ok : bad)('[2b] 点「运行」启动引擎 → 与门点亮灯（传播恢复）', `${JSON.stringify(sRun)}`);
        await toggle.click({ force: true }); await sleep(600);            // 复位成暂停
      }
    }

    console.log('\n===== 保存 → 刷新 → 重开 =====');
    // 保存＝点工具条那颗真「保存」钮，然后**问宿主收到了什么正文**（读发出去的字节，⛔ 从画布复算）。
    // 旧档点完直接 sleep(900) 就刷新——"到底交出去没有"从没判过，于是 [3]「部件还在」
    // 可能只是同一页内存没清（r154 doc 持久化那颗的 [5] 反向臂就是补这一刀）。
    await page.locator('button[title^="保存"]').first().click();
    await sleep(1200);
    const ro = await DH.fakeHostReadout(page);
    const body = ro ? String(ro.files[DOC] || '') : '';
    (ro && ro.edits >= 1 && /"And"/.test(body) && /"Lamp"/.test(body))
      ? ok('[S] 「保存」把正文交给宿主（落盘正文里找得到与门和灯）', `edits=${ro.edits} 正文 ${body.length}B`)
      : bad('[S] 保存没落到宿主（画布上的东西⛔ 交出去）', JSON.stringify({ edits: ro && ro.edits, doc: ro && ro.docMessages, 正文头: body.slice(0, 70) }));
    // 同 seedId 刷新＝假宿主那盘⛔ 重铺 ⇒ 画布只能从"盘上正文"长回来
    await page.reload({ waitUntil: 'domcontentloaded' });
    const restored = await page.waitForFunction(() => !!window.__sandboxPaper, null, { timeout: 15000 }).then(() => true).catch(() => false);
    if (!restored) {
      bad('[3] 刷新后活动沙盒文件自动带回', '重载后没有 paper：文档没被重新交给编辑器');
      bad('[4] 刷新后与门仍响应真鼠标点击', '前置没成（没有画布），不作数');
    } else {
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper; if (!p) return null;
      const by = {};
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { const t = c.get('type'); (by[t] = by[t] || []).push(c.id); });
      return by;
    });
    console.log('    重开后的部件:', JSON.stringify(Object.fromEntries(Object.entries(ids2 || {}).map(([k,v])=>[k,v.length]))));
    const kept = !!(ids2 && ids2.And && ids2.Input && ids2.Input.length >= 2 && ids2.Lamp);
    kept ? ok('[3] 刷新后与门/两个输入/灯都带回来了', JSON.stringify(Object.fromEntries(Object.entries(ids2).map(([k, v]) => [k, v.length]))))
         : bad('[3] 刷新后部件丢失', JSON.stringify(ids2));
    if (kept) {
      // 重开后再点一次第一个输入引脚（0→1，另一个仍 0）⇒ 与门输出 0，灯必须**跟着变**，
      // 这一格判的是"重开后的连线还活着"，不预设灯色（预设就是没见过的读数）。
      const pt = await page.evaluate((id) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
        const r = v.el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, ids2.Input[0]);
      await page.mouse.click(pt.x, pt.y); await sleep(700);
      const s2 = await lampState(page, ids2.Lamp[0]);
      console.log('    重开后点击输入 灯:', JSON.stringify(s2));
      (/3, 192, 60|#03c03c|252, 124, 104|#fc7c68/.test(String(s2.led)) && s2.in !== 'n/a')
        ? ok('[4] 刷新后与门仍响应真鼠标点击（灯被重画、端口有读数）', `${JSON.stringify(s2)}`)
        : bad('[4] 刷新后与门无响应', JSON.stringify(s2));
    } else {
      bad('[4] 刷新后与门仍响应真鼠标点击', '前置没成（部件丢失），不作数');
    }
    }
    console.log('pageerrors:', JSON.stringify(errors.slice(0, 5)));
    console.log(`\n===== QC-PAUSED DONE: ${pass} pass, ${fail} fail =====`);
    await browser.close();
  } catch (e) { console.log('FATAL', String(e)); fail++; }
  finally { try { server?.kill('SIGKILL'); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
