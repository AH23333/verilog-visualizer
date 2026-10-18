// 真宿主集成测试的父脚本（R159）：spawn fork 基座（scripts/code.bat + --extensionTestsPath），
// 等进程退出、读结果 JSON、逐条打印。**命令驱动**——窗口自己闪退，⛔ 屏幕控制。
// 用法：node tests/integration/run.cjs            （退出码＝失败颗数；2＝没拿到结果账）
// 环境变量：VERILOG_STUDIO_FORK（基座位置，默认 D:/vv-studio/vscode）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORK = process.env.VERILOG_STUDIO_FORK || 'D:/vv-studio/vscode';
const REPO = path.resolve(__dirname, '..', '..');
const suite = path.join(REPO, 'tests', 'integration', 'suite.cjs');
const bat = path.join(FORK, 'scripts', 'code.bat');
if (!fs.existsSync(bat)) { console.error('找不到基座启动脚本：' + bat); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-it-'));
const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws);
const udd = path.join(tmp, 'udd');
// 结果账走**固定路径**（每跑覆盖）——父脚本被工具层转后台时，轮询侧只认这一颗，⛔ 猜 mkdtemp 名
const outFile = path.join(os.tmpdir(), 'vv-it-result.json');
try { fs.rmSync(outFile, { force: true }); } catch { }

const args = [
  // ⚠ 上游 CI 惯例：--extensionTestsPath 必须与 --extensionDevelopmentPath **成对**——
  //   测试模块的 bootstrap 挂在开发扩展宿主上（第一跑只有 testsPath，宿主日志里测试根本没被加载）。
  '--extensionDevelopmentPath=' + path.join(FORK, 'extensions', 'verilog-visualizer'),
  '--extensionTestsPath=' + suite,
  '--user-data-dir=' + udd,
  '--disable-workspace-trust',
  '--disable-extension=vscode.git',
  '--logsFolder=' + path.join(tmp, 'logs'),
  ws,
];
console.log('[vv-it] 起真宿主：' + bat + ' ' + args.join(' '));
const child = spawn('cmd.exe', ['/c', bat, ...args], {
  cwd: FORK,
  env: { ...process.env, VSCODE_SKIP_PRELAUNCH: '1', VV_IT_OUT: outFile },
  windowsHide: true,
});
child.stdout.on('data', (d) => { const s = String(d); if (s.includes('[vv-it]')) process.stdout.write(s); });
let errbuf = '';
child.stderr.on('data', (d) => { errbuf += String(d); process.stderr.write(d); });

// **console 哨兵**：这些病灶都曾真机咬人（各自有账），回潮即判红——⛔ 让"满屏 console 错"再隐身
// ⚠ 基座 webview 预文档（out/.../webview/browser/pre/index.html）的内联脚本哈希**写死**在 workbench CSP 里——
//   改那个文件一个字符＝所有扩展 webview 的 postMessage 通道被 CSP 掐死（R159 亲历：守卫补丁⇒webview 全哑）。
//   所以 classList 那颗轮询噪音（self-recover，2 拍）只能⛔ 进哨兵清单，等上游修。
const FORBIDDEN = [
  [/An instance of the VS Code API has already been acquired/, 'acquireVsCodeApi 双拿回潮（DocApp/vscodeHost 必须同一出口）'],
  [/contribution\.value is not iterable/, 'manifest 贡献点形状病回潮（viewsWelcome 之类不是数组）'],
  [/violates the following Content Security Policy/, 'webview 内联脚本被 CSP 拦（多半是基座 pre/index.html 被动过——哈希写死在 workbench，⛔ 改）'],
  [/菜单项引用未在.命令.部分进行定义的命令/, 'manifest 菜单引了未声明命令（核对 contributes.commands）'],
];

const killer = setTimeout(() => { console.error('[vv-it] 150s 超时——强杀'); try { child.kill(true); } catch { } }, 150000);

/** 收掉残留的基座进程（品牌名从 product.json 的 nameShort 来；closeWindow 在测试宿主里不可靠，父侧兜底） */
function killFork() {
  try {
    const exe = path.join(FORK, '.build', 'electron');
    for (const f of fs.readdirSync(exe)) {
      if (!f.endsWith('.exe')) continue;
      const name = path.basename(f, '.exe');
      require('child_process').execSync(`taskkill /IM "${name}.exe" /F /T`, { stdio: 'ignore' });
    }
  } catch { /* 没进程可杀＝正常 */ }
}

child.on('exit', (code) => {
  clearTimeout(killer);
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { }
  killFork();
  if (!parsed) {
    console.error('\n[vv-it] 没拿到结果账（基座退出码 ' + code + '）——看基座日志：' + path.join(tmp, 'logs'));
    process.exit(2);
  }
  if (parsed.started && !parsed.results) { console.error('[vv-it] 测试模块起了但没跑完：' + JSON.stringify(parsed)); process.exit(2); }
  for (const r of parsed.results) console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.note ? '  [' + r.note + ']' : ''));
  let sentinelFail = 0;
  for (const [re, why] of FORBIDDEN) {
    if (re.test(errbuf)) { console.log('FAIL  console-sentinel  [' + why + ']'); sentinelFail++; }
  }
  console.log('[vv-it] failed=' + (parsed.failed + sentinelFail) + '（工作台账：' + tmp + '）');
  process.exit(parsed.failed + sentinelFail > 0 ? 1 : 0);
});
