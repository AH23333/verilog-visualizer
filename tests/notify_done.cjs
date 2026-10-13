/* 批完成信号器：轮询日志 → 汇总出现即弹 Windows toast 通知（可复用）
 * 用法: node notify_done.cjs <logPath> <批名>
 * 用户裁决（R131）：跑批必须有完成信号，否则不知道何时叫 agent 继续。 */
const fs = require('fs');
const cp = require('child_process');
const [logPath, batchName] = [process.argv[2], process.argv[3] || '测试批'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function toast(title, body) {
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null
$xml.GetElementsByTagName('text').Item(1).AppendChild($xml.CreateTextNode('${body.replace(/'/g, "''")}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)`;
  try { cp.execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { windowsHide: true, timeout: 30000, encoding: 'utf8' }); }
  catch (e) { console.log('toast 失败（不影响结果）:', String(e.message).slice(0, 80)); }
}
(async () => {
  const d = Date.now() + 40 * 60 * 1000;
  let summary = null, redGates = [];
  while (Date.now() < d) {
    try {
      const t = fs.readFileSync(logPath, 'utf8');
      const m = t.match(/RED=\d+ ENVRED=\d+ GREEN=\d+ NOVERDICT=\d+ 共 \d+ 格/);
      if (m) {
        summary = m[0];
        for (const line of t.split('\n')) if (/^## .*RED(?!D)/.test(line)) redGates.push(line.split(' ')[1]);
        break;
      }
    } catch {}
    await sleep(15000);
  }
  const green = summary && /RED=0 ENVRED=0 GREEN=\d+ NOVERDICT=0/.test(summary);
  const title = green ? `✅ ${batchName} 全绿完成` : `⚠️ ${batchName} 完成（有红/中断）`;
  const body = (summary || '超时未出汇总') + (redGates.length ? ` 红:${redGates.join(',')}` : '');
  toast(title, body);
  console.log('NOTIFY:', title, '|', body);
  fs.appendFileSync(logPath, `\n[notify] ${title} | ${body}\n`);
})().catch(e => { console.log('FATAL', String(e).slice(0, 200)); process.exit(1); });
