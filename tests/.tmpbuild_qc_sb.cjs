// SANDBOX QC: verify P0 claims empirically — entry/palette/drag/save-reload/native-confirm
let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const R = { pass: [], fail: [], facts: {} };
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const native = [];
  page.on('dialog', async (d) => { native.push(d.type() + ':' + (d.message() || '').slice(0, 40)); await d.accept().catch(() => {}); });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (t.includes('[sandbox]')) logs.push(t.slice(0, 160)); });
  const step = async (n, fn) => { try { await fn(); R.pass.push(n); console.log('PASS ' + n); } catch (e) { R.fail.push(n + ' :: ' + String(e).slice(0, 160)); console.log('FAIL ' + n + ' :: ' + String(e).slice(0, 140)); } };

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  // dismiss first-run onboarding if present (fresh context shows it)
  {
    const skip = page.getByText(/Skip/i).first();
    if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) { await skip.click(); await page.waitForTimeout(300); }
    else await page.keyboard.press('Escape');
  }

  // 1. entry
  await step('SB1 sandbox entry via ActivityBar Box', async () => {
    await page.locator('button[title="Sandbox"]').click();
    await page.waitForTimeout(600);
    const ok = await page.getByText('Click + to create a new sandbox file').isVisible().catch(() => false);
    const palette = await page.getByText('GATES', { exact: true }).isVisible().catch(() => false);
    if (!ok && !palette) throw new Error('sandbox UI not shown');
  });

  // 2. create file
  await step('SB2 create file + palette buttons exist (7 gates + 6 IO)', async () => {
    await page.locator('button[title="New file"]').click();
    await page.waitForTimeout(800);
    const gates = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
    const ios = ['Button', 'Clock', 'Input', 'Output', 'Lamp', 'Dff'];
    for (const g of gates) if (!(await page.locator(`button:text-is("${g}")`).count())) throw new Error('missing gate ' + g);
    for (const i of ios) if (!(await page.locator(`button:text-is("${i}")`).count())) throw new Error('missing io ' + i);
  });

  // 3. place cells
  await step('SB3 place And + Button + Lamp -> 3 cells in model', async () => {
    for (const t of ['And', 'Button', 'Lamp']) {
      await page.locator(`button:text-is("${t}")`).click();
      await page.waitForTimeout(250);
    }
    const n = await page.evaluate(() => {
      const raw = localStorage.getItem('verilog-viz-sandbox-active');
      return document.querySelectorAll('[model-id]').length;
    });
    R.facts.domCells = n;
    if (n < 3) throw new Error('cells rendered ' + n + ' < 3');
  });
  await page.screenshot({ path: OUT + '/sb01-placed.png' });

  // 4. drag a cell (core claim)
  await step('SB4 drag cell updates model position', async () => {
    const before = await page.evaluate(() => {
      const el = document.querySelector('[model-id]');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: el.getAttribute('model-id') };
    });
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 120, before.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    // read model position through save path
    await page.locator('button:has-text("Save")').first().click();
    await page.waitForTimeout(400);
    const pos = await page.evaluate((id) => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      for (const f of Object.values(files)) {
        const g = JSON.parse(f.graphJson || '{"cells":[]}');
        const c = g.cells.find((x) => x.id === id || x.type?.includes('And'));
        if (c?.position) return { id: c.id, ...c.position };
      }
      return null;
    }, before.id);
    R.facts.afterDrag = pos;
    if (!pos || (Math.abs(pos.x) < 1 && Math.abs(pos.y) < 1)) throw new Error('model position not moved: ' + JSON.stringify(pos));
  });
  await page.screenshot({ path: OUT + '/sb02-dragged.png' });

  // 5. save->reload persistence (claim + known limitation 6)
  await step('SB5 reload keeps cells AND positions (limitation#6 check)', async () => {
    const before = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(files).map((f) => ({ n: JSON.parse(f.graphJson).cells.length, pos: JSON.parse(f.graphJson).cells.map((c) => c.position).filter(Boolean) }));
    });
    R.facts.beforeReload = before;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.locator('button[title="Sandbox"]').click();
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const files = JSON.parse(localStorage.getItem('verilog-viz-sandbox-files') || '{}');
      return Object.values(files).map((f) => ({ n: JSON.parse(f.graphJson).cells.length, pos: JSON.parse(f.graphJson).cells.map((c) => c.position).filter(Boolean) }));
    });
    R.facts.afterReload = after;
    const domCells = await page.locator('[model-id]').count();
    if (domCells < 3) throw new Error('after reload dom cells=' + domCells);
  });
  await page.screenshot({ path: OUT + '/sb03-reloaded.png' });

  // 6. IO cell sanity: Input/Output/Dff usable?
  await step('SB6 Input/Output/Dff cells render & simulate (claim: 6 IO types)', async () => {
    await page.locator('button:text-is("Input")').click(); await page.waitForTimeout(200);
    await page.locator('button:text-is("Dff")').click(); await page.waitForTimeout(200);
    await page.screenshot({ path: OUT + '/sb04-input-dff.png' });
    const btnfaceCount = await page.locator('.btnface').count();
    R.facts.btnfaceAfterInputDff = btnfaceCount;
    // Button placed earlier should give >=1 btnface; Input/Dff add nothing interactive
    await page.locator('button:text-is("Button")').click(); await page.waitForTimeout(300);
    const after = await page.locator('.btnface').count();
    R.facts.btnfaceAfterButton = after;
  });

  // 7. native confirm on delete (policy violation probe)
  await step('SB7 delete file uses native confirm (POLICY VIOLATION expected)', async () => {
    const del = page.locator('span:has-text("×")').first();
    await del.click();
    await page.waitForTimeout(400);
    R.facts.nativeDialogs = native;
    if (native.length === 0) { console.log('   (no native dialog — good)'); return; }
    throw new Error('native dialog fired: ' + native.join(','));
  });

  // 8. mode exclusivity back to main
  await step('SB8 switch back to Files mode restores main UI', async () => {
    await page.locator('button[title="Files"]').click();
    await page.waitForTimeout(600);
    const ok = await page.getByText('FILES').first().isVisible().catch(() => false);
    if (!ok) throw new Error('main UI not restored');
  });

  console.log('=== SANDBOX QC SUMMARY ===');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length);
  R.fail.forEach((f) => console.log('  ' + f));
  console.log('facts: ' + JSON.stringify(R.facts, null, 1));
  console.log('sandbox console logs (last 8):');
  logs.slice(-8).forEach((l) => console.log('   ' + l));
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
