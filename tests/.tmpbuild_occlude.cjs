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
  const probe = async (tag) => {
    const r = await page.evaluate((tag) => {
      const btn = document.querySelector('button[data-activity="modules"], button[title="模块"]');
      if (!btn) return { tag, btn: 'NOT-FOUND' };
      const rect = btn.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const el = document.elementFromPoint(x, y);
      const chain = [];
      let cur = el;
      while (cur && cur !== document.body && chain.length < 6) {
        const cs = getComputedStyle(cur);
        chain.push({ tag: cur.tagName, cls: (cur.className || '').toString().slice(0, 44), pos: cs.position, pe: cs.pointerEvents, z: cs.zIndex });
        cur = cur.parentElement;
      }
      const clickable = el === btn || btn.contains(el) || (el && el.contains(btn));
      return { tag, btnCenter: { x: Math.round(x), y: Math.round(y) }, hitTag: el?.tagName, hitCls: (el?.className || '').toString().slice(0, 44), clickable, chain };
    }, tag);
    console.log(JSON.stringify(r, null, 1));
  };
  await probe('before-place');
  const palDump = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim().slice(0, 16), vis: !!b.getBoundingClientRect().width })).filter(x => /时钟|与门|指示灯|Clock|Lamp|And/i.test(x.t)));
  console.log('palette-before-clock:', JSON.stringify(palDump));
  await page.locator('button:has-text("时钟")').click(); await page.waitForTimeout(500);
  await probe('after-place-1');
  await page.locator('button:has-text("指示灯")').click(); await page.waitForTimeout(500);
  await probe('after-place-2');
  await page.locator('button:has-text("合线器")').click(); await page.waitForTimeout(500);
  await probe('after-place-3');
  await page.screenshot({ path: 'D:/Visual Studio Code/Something/.tmpbuild/qc3/occlude-seq.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
