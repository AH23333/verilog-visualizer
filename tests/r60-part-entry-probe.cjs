// r60 只读探针：沙盒里"把当前电路存成部件"这个入口，**点下去到底有没有反应**。
// 起因：`setSavingGate(true)` 的输入框只在 leftPanel==='hierarchy' 那一段 JSX 里渲染
// （SandboxCanvas.tsx:3341 起），而右键「新建部件（保存当前电路）」挂在「部件」面板的菜单上
// （:3020）⇒ 面板不在 hierarchy 时，这一下可能是"记了状态但屏幕上没有"那一族（VQ）。
// 这里不猜：把三种面板下的菜单项、点击后输入框的出现情况全打出来。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1645; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const menuLabels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-context-menu] button')).map((b) => String(b.textContent || '').trim()));
const inputCount = (page) => page.evaluate(() => document.querySelectorAll('input[placeholder="自定义门名称"]').length);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    console.log('activity 按钮 =', J(await page.evaluate(() =>
      Array.from(document.querySelectorAll('button[data-activity]')).map((b) => b.getAttribute('data-activity') + '|' + b.title))));

    await UI.enterSandbox(page);
    await UI.clickGate(page, 'Input');
    await UI.clickGate(page, 'Output');
    await sleep(400);
    console.log('画布器件数 =', await page.evaluate(() => window.__sandboxPaper.model.getCells().length));

    // ① 画布空白处右键：用户能看到的顶层菜单有哪些
    const host = await page.evaluate(() => {
      const p = window.__sandboxPaper; const r = p.el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width - 40), y: Math.round(r.top + r.height - 40) };
    });
    await page.mouse.click(host.x, host.y, { button: 'right' }); await sleep(500);
    console.log('\n[① 画布空白右键]', J(await menuLabels(page)));
    const sub = page.locator('[data-context-menu] button:has-text("放置部件")');
    if (await sub.count()) { await sub.first().click(); await sleep(400); console.log('  └「放置部件」子菜单 =', J(await menuLabels(page))); }
    await page.keyboard.press('Escape'); await sleep(300);

    // ② 逐个面板：右键侧栏 → 找"新建部件（保存当前电路）"→ 点它 → 输入框出没出现
    for (const panel of ['modules', 'hierarchy', 'files']) {
      const btn = page.locator(`button[data-activity="${panel}"]`);
      if (!(await btn.count())) { console.log(`\n[② panel=${panel}] 没有这颗 activity 按钮（跳过＝不作数）`); continue; }
      await btn.first().click(); await sleep(600);
      const side = await page.evaluate((panel) => {
        // 侧栏真身锚点：面板自己的文字（部件清单标题 / 文件标题 / 层次标题），别再用几何猜
        const marks = {
          modules: '部件（可编辑电路）',
          hierarchy: 'DRC',
          files: null,
        };
        const want = marks[panel];
        let el = null;
        if (want) el = Array.from(document.querySelectorAll('div,span')).find((d) => String(d.textContent || '').trim() === want) || null;
        if (!el) {
          const cands = Array.from(document.querySelectorAll('div')).filter((d) => {
            const r = d.getBoundingClientRect();
            return r.left < 280 && r.width > 100 && r.width < 320 && r.height > 120;
          });
          el = cands.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0] || null;
        }
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        return { tag: el.tagName, text: String(el.textContent || '').slice(0, 18) };
      }, panel);
      if (!side) { console.log(`\n[② panel=${panel}] 找不到侧栏锚点（跳过＝不作数）`); continue; }
      await sleep(400);
      const box = await page.evaluate(() => {
        const wants = ['部件（可编辑电路）', 'DRC', '沙盒电路文件'];
        const el = Array.from(document.querySelectorAll('div,span')).find((d) => {
          const t = String(d.textContent || '').trim();
          return wants.some((w) => t === w || t.startsWith(w));
        });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { text: String(el.textContent || '').slice(0, 18), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      if (!box) { console.log(`\n[② panel=${panel}] 滚动后仍找不到锚点（跳过＝不作数）`); continue; }
      if (box.y < 0 || box.y > 900) {
        // 锚点在视口外 ⇒ 这一格不作数（曾经我用 y=1537 去点，等于什么都没点，别把它读成"菜单里没有"）
        console.log(`\n[② panel=${panel}] 锚点在视口外 y=${box.y}（跳过＝不作数）`);
        continue;
      }
      console.log(`\n[② panel=${panel}] 侧栏锚点=${J(box)}`);
      await page.mouse.click(box.x, box.y, { button: 'right' }); await sleep(500);
      const labels = await menuLabels(page);
      const has = labels.some((l) => String(l).includes('新建部件'));
      console.log(`\n[② panel=${panel}] 侧栏右键菜单=${J(labels)} 含「新建部件」=${has}`);
      if (!has) { await page.keyboard.press('Escape'); await sleep(200); continue; }
      const before = await inputCount(page);
      await page.locator('[data-context-menu] button', { hasText: '新建部件' }).first().click();
      await sleep(700);
      const after = await inputCount(page);
      const vis = await page.evaluate(() => {
        const i = document.querySelector('input[placeholder="自定义门名称"]');
        if (!i) return null;
        const r = i.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), visible: r.width > 0 && r.height > 0 };
      });
      console.log(`  └ 点下去：输入框 ${before} → ${after} 颗，位置=${J(vis)}`);
      console.log(`  └ toast=${J(await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('div')).filter((d) => /部件|已保存/.test(String(d.textContent || '')) && getComputedStyle(d).position === 'fixed');
        return t.slice(0, 2).map((d) => String(d.textContent || '').slice(0, 40));
      }))}`);
      await page.keyboard.press('Escape'); await sleep(200);
    }

    // ③ 存一个部件，再看它在两处菜单里落在哪一层（写闸门前先见现场形状）
    const NAME = 'R60Probe' + (Date.now() % 100000);
    await page.locator('button[data-activity="modules"]').first().click(); await sleep(500);
    const mAnchor = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div,span')).find((d) => String(d.textContent || '').trim() === '部件（可编辑电路）');
      if (!el) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (!mAnchor) { console.log('\n[③] 找不到部件面板锚点，跳过'); }
    else {
      await page.mouse.click(mAnchor.x, mAnchor.y, { button: 'right' }); await sleep(500);
      await page.locator('[data-context-menu] button', { hasText: '新建部件（保存当前电路）' }).first().click(); await sleep(500);
      await page.locator('input[placeholder="自定义门名称"]').fill(NAME);
      await page.locator('button[title="确认保存为自定义门"]').click(); await sleep(900);
      console.log(`\n[③] 已保存部件 ${NAME}，toast=`, await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('div')).filter((d) => getComputedStyle(d).position === 'fixed' && /部件/.test(String(d.textContent || '')));
        return t.slice(0, 1).map((d) => String(d.textContent || '').slice(0, 60));
      }));
      console.log('  左栏部件行 =', await page.evaluate((n) =>
        Array.from(document.querySelectorAll('button')).filter((b) => String(b.title || '').startsWith('放置部件')).map((b) => b.title + '=>' + String(b.textContent || '').trim()).filter((s) => s.includes(n)), NAME));
      console.log('  沙盒文件里 =', await page.evaluate((n) => {
        try { return JSON.stringify(window.__sandboxStoreDbg && window.__sandboxStoreDbg.list && window.__sandboxStoreDbg.list().filter((f) => String(f.name).includes(n))); } catch { return 'n/a'; }
      }, NAME));

      // 画布右键 → 放置部件 → 逐层进（深度≤2），把每一层的标签都打出来
      const host2 = await page.evaluate(() => { const p = window.__sandboxPaper; const r = p.el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width - 40), y: Math.round(r.top + r.height - 40) }; });
      await page.mouse.click(host2.x, host2.y, { button: 'right' }); await sleep(500);
      await page.locator('[data-context-menu] button:has-text("放置部件")').first().click(); await sleep(450);
      const lvl1 = await menuLabels(page);
      console.log('  画布「放置部件」第 1 层 =', J(lvl1), '含名字=', lvl1.some((l) => l.includes(NAME)));
      // 菜单项一律用 el.click()：locator.click 会等"稳定"，菜单是动画渲染的，等不到（实测超时）
      const clickItem = (label) => page.evaluate((t) => {
        const b = Array.from(document.querySelectorAll('[data-context-menu] button'))
          .find((x) => String(x.textContent || '').trim() === t);
        if (!b) return false; b.click(); return true;
      }, label);
      let found = lvl1.some((l) => l.includes(NAME));
      for (const l of lvl1.filter((x) => x.endsWith('▶')).slice(0, 12)) {
        if (!await clickItem(l)) continue;
        await sleep(400);
        const lvl2 = await menuLabels(page);
        if (lvl2.some((x) => x.includes(NAME)) || lvl2.length > 1) {
          console.log(`    └ 进「${l}」=`, J(lvl2).slice(0, 260), '含名字=', lvl2.some((x) => x.includes(NAME)));
        }
        if (lvl2.some((x) => x.includes(NAME))) {
          found = true;
          const cells0 = await page.evaluate(() => window.__sandboxPaper.model.getCells().length);
          console.log('    └ 直接点部件名:', await clickItem(lvl2.find((x) => x.includes(NAME))), '器件数', cells0, '→',
            await page.evaluate(() => window.__sandboxPaper.model.getCells().length));
          console.log('    └ 新器件形状 =', J(await page.evaluate((n) => {
            const cs = window.__sandboxPaper.model.getCells();
            const last = cs[cs.length - 1];
            return { type: String(last.get('type')), celltype: last.get('celltype') ?? null, label: String(last.get('label') || ''), name: n };
          }, NAME)));
          break;
        }
        if (!await clickItem('← 返回分类')) { await page.keyboard.press('Escape'); await sleep(250);
          await page.mouse.click(host2.x, host2.y, { button: 'right' }); await sleep(400);
          await clickItem('放置部件▶'); await sleep(400); }
      }
      console.log('  ⇒ 部件在两处菜单的可见性：左栏=', true, ' 画布=', found);
      await page.keyboard.press('Escape'); await sleep(250);
    }

    console.log('\n页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); }
})();
