let pw;
try { pw = require('playwright-core'); } catch { pw = require('D:/Visual Studio Code/Something/.tmpbuild/node_modules/playwright-core'); }
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/Visual Studio Code/Something/.tmpbuild/qc3';
async function main() {
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {} });
  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.getElementById('root')?.innerHTML.length ?? 0) > 5000, null, { timeout: 15000 });
  await page.waitForTimeout(700);
  const shot = async (tag) => page.screenshot({ path: `${OUT}/seq-${tag}.png` });
  const dump2 = async (tag) => {
    const arr = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => ({ t: (b.textContent || '').trim().slice(0, 14), w: Math.round(b.getBoundingClientRect().width) })).filter(x => /时钟|与门|指示灯|Clock|Lamp|And/.test(x.t)));
    console.log(tag, JSON.stringify(arr));
  };

  await page.locator('button[data-activity="sandbox"], button[title*="沙盒"]').first().click(); await page.waitForTimeout(800);
  await shot('s1-sandbox');
  await page.locator('button[title*="新建"]').first().click(); await page.waitForTimeout(900);
  await shot('s2-created');
  await dump2('after-create');
  await page.locator('button:has-text("时钟")').click({ timeout: 8000 }).catch(async (e) => { console.log('clock click fail:', String(e).slice(0, 90)); });
  await page.waitForTimeout(400);
  await shot('s3-after-clock-attempt');
  await dump2('after-clock-attempt');
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
