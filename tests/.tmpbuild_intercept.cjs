let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
async function main() {
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {} });
  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.locator('button[title="沙盒"]').click(); await page.waitForTimeout(800);
  // find the interceptor at the sandbox button center
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('button[data-activity="sandbox"]');
    const r = btn.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const el = document.elementFromPoint(x, y);
    const chain = [];
    let cur = el;
    while (cur && cur !== document.body && chain.length < 8) {
      const cs = getComputedStyle(cur);
      chain.push({ tag: cur.tagName, cls: (cur.className || '').toString().slice(0, 50), pos: cs.position, z: cs.zIndex, rect: { x: Math.round(cur.getBoundingClientRect().x), y: Math.round(cur.getBoundingClientRect().y), w: Math.round(cur.getBoundingClientRect().width), h: Math.round(cur.getBoundingClientRect().height) } });
      cur = cur.parentElement;
    }
    return { point: { x: Math.round(x), y: Math.round(y) }, hitTag: el?.tagName, hitCls: (el?.className || '').toString().slice(0, 60), chain };
  });
  console.log(JSON.stringify(hit, null, 1));
  await page.screenshot({ path: 'D:/Visual Studio Code/Something/.tmpbuild/qc3/interceptor.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
