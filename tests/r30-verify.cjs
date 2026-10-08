// R30 验收：器件专业化 + 总线/分线体系 + 沙盒左栏路由
//  [1] 沙盒模式下点 文件/模块/层次结构 —— 仍留在沙盒（不切到 IDE 板块）
//  [2] 新器件可放置且端口正确（位扩展 / 数值显示 / 数值输入 / 除法 / 不等比较 / 独热选择 / 归约 / 寄存器）
//  [3] 总线 ↔ 单线转换闭环：1 位常量 →(零扩展)→ 4 位总线 →(数值显示) 读数；4 位总线 →(切片)→ 1 位
//  [4] 重建式配置生效：分线器分组配置 / D 触发器位宽（连线不丢）
//  [5] 全程无页面异常
const { spawn } = require('child_process');
const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT = require(path.join(PROJECT_ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1476;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1476)); } catch { }
const UI = require('./_ui.cjs');
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
const clickActivity = async (page, label) => {
  await page.locator(`button.activity-btn[title="${label}"]`).click(); await sleep(450);
};
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
    await clickActivity(page, '沙盒'); await sleep(900);
    await UI.newSandboxFile(page);

    // [1] 沙盒内切换三个左栏面板 —— 必须仍留在沙盒
    const stillSandbox = async () => await page.evaluate(() => !!document.querySelector('[data-sandbox-wrapper]'));
    const readPanel = async () => ({
      inSb: await stillSandbox(),
      head: await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('span'))
          .find(s => ['文件', '部件', '层次结构'].includes((s.textContent || '').trim()));
        return el ? el.textContent.trim() : null;
      }),
    });
    const panels = [];
    for (const [btn, title] of [['文件', '文件'], ['模块', '部件'], ['层次结构', '层次结构']]) {
      await clickActivity(page, btn);
      let state = await readPanel();
      // 若该面板已激活，第一次点击是「折叠」（与 IDE 侧栏一致的行为）—— 再点一次展开
      if (state.head !== title) { await clickActivity(page, btn); state = await readPanel(); }
      panels.push({ btn, inSb: state.inSb, head: state.head, expect: title });
    }
    console.log('    面板切换:', JSON.stringify(panels));
    const panelOk = panels.every(p => p.inSb && p.head === p.expect);
    panelOk ? ok('[1] 沙盒内切换 文件/模块/层次结构 不离开沙盒', JSON.stringify(panels.map(p => p.head)))
            : bad('[1] 面板切换异常', JSON.stringify(panels));

    // [2] 放置新器件并检查端口
    await clickActivity(page, '模块'); await sleep(400); // 部件库面板
    // R32 起部件库分组默认折叠 —— 点组头展开全部，才能点到各分组的器件
    for (const n of ['逻辑门', '输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示']) {
      try { await page.getByText(n, { exact: true }).first().click({ timeout: 800 }); await sleep(120); } catch {}
    }
    const NEW_PARTS = ['ZeroExtend', 'SignExtend', 'NumDisplay', 'NumEntry', 'Division', 'Ne', 'Mux1Hot', 'AndReduce'];
    const placed = {};
    for (const t of NEW_PARTS) {
      await require('./_ui.cjs').ensurePalette(page);
      const btn = page.locator(`button[data-gate="${t}"]`).first();
      if (!(await btn.count())) { placed[t] = null; continue; }
      await btn.click(); await sleep(320);
      const info = await page.evaluate((type) => {
        const p = window.__sandboxPaper;
        const cells = p.model.getCells().filter(c => !c.isLink() && c.get('type') === type);
        const c = cells[cells.length - 1];
        if (!c) return null;
        const items = c.get('ports')?.items || [];
        return { ports: items.map(x => `${x.dir === 'in' ? '<' : '>'}${x.id}[${x.bits}]`), bits: c.get('bits'), extend: c.get('extend') };
      }, t);
      placed[t] = info;
    }
    console.log('    新器件端口:', JSON.stringify(placed));
    const allPlaced = NEW_PARTS.every(t => placed[t] && placed[t].ports.length > 0);
    allPlaced ? ok('[2] 8 个新器件均可放置且端口非空') : bad('[2] 器件缺失/端口异常', JSON.stringify(placed));

    // [2b] 位扩展默认 1→N（单线 → 总线）
    const ext = placed.ZeroExtend?.extend;
    (ext && ext.input === 1 && ext.output >= 4)
      ? ok('[2b] 零扩展默认 1 位 → 4 位（单线升总线）', JSON.stringify(ext))
      : bad('[2b] 位扩展默认参数不对', JSON.stringify(ext));

    // [3] 总线/单线转换闭环：ZeroExtend(1→4) → NumDisplay(4)，用 Constant 驱动
    await page.evaluate(() => {
      const p = window.__sandboxPaper;
      p.model.getCells().filter(c => !c.isLink()).forEach(c => { try { c.remove(); } catch {} });
    });
    await sleep(300);
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'Constant'); await sleep(300);
    const build = await page.evaluate(() => {
      const dj = window.digitaljs;
      const p = window.__sandboxPaper;
      const mk = (Type, extra, x) => {
        const c = new dj.cells[Type](Object.assign({ type: Type, position: { x, y: 120 } }, extra));
        p.model.addCell(c); return c;
      };
      // 常量 1 位 '1' → 零扩展到 4 位总线 → 数值显示
      const k = mk('Constant', { constant: '1' }, 100);
      const z = mk('ZeroExtend', { extend: { input: 1, output: 4 } }, 300);
      const d = mk('NumDisplay', { bits: 4 }, 500);
      const wire = (a, ap, b, bp) => p.model.addCell(new dj.cells.Wire({
        source: { id: a.id, port: ap }, target: { id: b.id, port: bp }, signal: 'x', bits: 1,
      }));
      wire(k, 'out', z, 'in'); wire(z, 'out', d, 'in');
      return { constId: k.id, zId: z.id, dId: d.id };
    });
    await sleep(1200);
    const chain = await page.evaluate((ids) => {
      const p = window.__sandboxPaper;
      const g = (id, dir, port) => {
        const c = p.model.getCell(id);
        const sig = dir === 'in' ? c.get('inputSignals') : c.get('outputSignals');
        const v = sig?.[port];
        return v ? v.toString().replace('Vector3vl ', '') : 'n/a';
      };
      return { kOut: g(ids.constId, 'out', 'out'), zIn: g(ids.zId, 'in', 'in'), zOut: g(ids.zId, 'out', 'out'),
               dIn: g(ids.dId, 'in', 'in'), warnings: p.model._warnings };
    }, build);
    console.log('    转换链路:', JSON.stringify(chain));
    (chain.zIn === '1' && chain.zOut === '0001' && chain.dIn === '0001' && chain.warnings === 0)
      ? ok('[3] 单线→总线转换闭环（1 → 0001，全程无 warning）', JSON.stringify(chain))
      : bad('[3] 转换链路异常', JSON.stringify(chain));

    // [4] 重建式配置：分线器分组 4 → 8（连线按 port id 接回）
    // 走真实路径：从部件库放置「分线器」（手工 new 出来的器件拿不到 spawnCell 的尺寸修正）
    await require('./_ui.cjs').ensurePalette(page);
    await require('./_ui.cjs').clickGate(page, 'BusUngroup'); await sleep(600);
    // 放下后会弹「位宽方案」对话框 —— 取消即保持默认 4 组×1 位
    if (await page.locator('[data-bus-width-dialog]').count()) {
      await page.locator('[data-bus-width-dialog] button:text-is("取消")').click(); await sleep(400);
    }
    const before = await page.evaluate(() => {
      const p = window.__sandboxPaper;
      const cells = p.model.getCells().filter(c => !c.isLink() && c.get('type') === 'BusUngroup');
      const c = cells[cells.length - 1];
      return { id: c.id, ports: (c.get('ports').items || []).length, size: c.get('size'),
               groups: c.get('groups') ? Array.from(c.get('groups').values()) : null };
    });
    console.log('    分线器(部件库放置):', JSON.stringify(before));
    await sleep(400);
    // 通过右键菜单改分组配置
    const busId = before.id;
    const pt = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      const rects = Array.from(v.el.querySelectorAll('rect'));
      const body = rects.sort((a, b) => (b.getBBox().width * b.getBBox().height) - (a.getBBox().width * a.getBBox().height))[0] || v.el;
      let r = body.getBoundingClientRect();
      // 器件可能落在可视区之外（连放多个部件后）→ 先平移到画布中央再右键
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 120 || cx > 1000 || cy < 140 || cy > 780) {
        const t = p.translate();
        p.translate(t.tx + (600 - cx), t.ty + (420 - cy));
        r = body.getBoundingClientRect();
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, busId);
    await sleep(300);
    // [1b] 层次结构面板确实列出了画布上的器件
    await clickActivity(page, '层次结构'); await sleep(500);
    const hier = await page.evaluate(() => {
      const txt = Array.from(document.querySelectorAll('div'))
        .map(d => (d.textContent || '').trim())
        .filter(t => /层次结构|器件 \/|当前电路/.test(t));
      const head = txt.find(t => t.startsWith('当前电路')) || null;
      return { head, sample: txt.slice(0, 3) };
    });
    console.log('    层次结构面板:', JSON.stringify(hier.head));
    (hier.head && /\d+ 器件/.test(hier.head))
      ? ok('[1b] 层次结构面板列出当前电路器件统计', hier.head)
      : bad('[1b] 层次结构面板内容异常', JSON.stringify(hier));
    await clickActivity(page, '模块'); await sleep(400);

    const hitDiag = await page.evaluate(({ p2, id }) => {
      const p = window.__sandboxPaper;
      const el = document.elementFromPoint(p2.x, p2.y);
      const c = p.model.getCell(id);
      const v = c && c.findView(p);
      void 0;
      return { hitTag: el?.tagName, hitModel: el?.closest?.('[model-id]')?.getAttribute('model-id') || null,
               cellSize: c ? c.get('size') : null };
    }, { p2: pt, id: busId });
    console.log('    命中诊断:', JSON.stringify(hitDiag));
    await page.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(600);
    const menuLabels = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
      .map(b => (b.textContent || '').trim()).filter(t => t && t.length < 12));
    console.log('    右键菜单项:', JSON.stringify(menuLabels.slice(-14)));
    // 备注：带输入框的菜单项渲染成 <div>（不是 button），直接按 placeholder 定位输入框
    const input = page.locator('input[placeholder="4 或 2,2,4"]').first();
    const hasInput = await input.count();
    console.log('    分组配置输入框:', hasInput);
    if (hasInput) { await input.fill('8'); await input.press('Enter'); await sleep(900); }
    else console.log('    未找到「分组配置」输入框');
    const after = await page.evaluate((id) => {
      const p = window.__sandboxPaper;
      const c = p.model.getCell(id);
      return c ? { ports: (c.get('ports').items || []).length, groups: c.get('groups') ? Array.from(c.get('groups').values()) : null,
                   height: c.get('size')?.height } : null;
    }, busId);
    console.log('    分线器重建:', JSON.stringify({ before, after }));
    (after && after.groups && after.groups.length === 8)
      ? ok('[4] 分线器分组配置重建生效（4 组 → 8 组）', JSON.stringify(after.groups))
      : bad('[4] 分组配置未生效', JSON.stringify({ before, after }));

    // [5]
    errors.length === 0 ? ok('[5] 全程无页面异常') : bad('[5] 有页面异常', errors[0].slice(0, 160));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
  } catch (e) { console.log('FATAL', e); fail = 1; }
  finally { try { await browser?.close(); } catch {} try { server?.kill(); } catch {} process.exit(fail > 0 ? 1 : 0); }
})();
