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
  await page.locator('button[data-activity="sandbox"], button[title*="沙盒"]').first().click(); await page.waitForTimeout(800);
  await page.locator('button[title*="新建"]').first().click(); await page.waitForTimeout(900);
  const dump = await page.evaluate(() => ({
    activityBtns: [...document.querySelectorAll('button[data-activity], .activity-btn')].map(b => ({ t: b.title, dk: b.getAttribute('data-activity') })),
    paletteBtns: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => t && t.length < 16 && !/^(文件|编辑|导出|视图|设置|帮助|主题|Examples|Save|Compile|\+|−|×|单步|复位|暂停|撤销|重做|旋转|适应|1:1)$/.test(t)).slice(0, 40),
  }));
  console.log(JSON.stringify(dump, null, 1));
  // context menu dump
  const wrap = await page.locator('[data-sandbox-wrapper]').boundingBox();
  await page.mouse.click(wrap.x + 600, wrap.y + 300, { button: 'right' });
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => [...document.querySelectorAll('.animate-scale-in button, [role=menuitem]')].map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 14));
  console.log('context menu:', JSON.stringify(menu));
  await page.screenshot({ path: 'D:/Visual Studio Code/Something/.tmpbuild/qc3/ui-dump.png' });
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
