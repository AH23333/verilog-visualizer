// 全量闸门跑批：顺序跑维护中的 verify/probe 脚本，每格留完整原始输出 + 三态判定。
//
// 判定三态（照台架纪律：跳过≠通过，没计数≠咬住）：
//   RED      —— 有 FAIL 断言行、或 FATAL、或进程非 0 退出、或超时
//   GREEN    —— 至少一条 PASS 行，且上面一条都没中
//   NOVERDICT—— 一条 PASS 都没打（脚本自己没断言、或断言全被跳过）。这种格子
//              不许读成"绿"，汇总里单列。
//   ENVRED   —— 只在"机器自己撑不住"的签名上出现（浏览器起不来 / 资源耗尽 / vite 没起来 /
//              进程被系统 abort）。它**既不是通过也不是产品缺陷**，单列一格，收口时必须重跑。
//              ⚠ 故意不含 TimeoutError：那是老闸门锚点过期的样子，属于要修的 RED。
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const UI = require('./_ui.cjs');
const ROOT = path.resolve(__dirname, '..');
const LOGDIR = path.join(ROOT, '.tmpbuild', 'gates');
const ENV_RE = /ERR_INSUFFICIENT_RESOURCES|browser has been closed|browserType\.launch|服务没起来|服务未起来|OutOfMemoryException|ECONNREFUSED|ERR_CONNECTION_REFUSED|3221226505|0xC0000409|page\.goto: Timeout/i;

/** 每颗闸门自己 spawn 的 vite 是 `npx` 的孙进程，gate 里 server.kill() 只杀了 shell 包装 ⇒ 服务器会漏。
 *  跑完一格就按它自己的端口把监听者收掉，否则 30 格跑下来机器先进 OOM，后面的 RED 全是环境红。
 *  实现的唯一主人在 tests/_ui.cjs（单跑的闸门也用同一份兜底）。
 *  ⚠ ENV_RE 里的 `page.goto: Timeout` 只认**导航**超时——browser 起来之前有 fetch 就绪断言，
 *  超时＝机器慢而不是断言失败；⛔ 不许放宽成任何 Timeout（locator 断言超时是真失败，必须保持 RED）。 */
function gatePort(file) {
  try { const m = /PORT\s*=\s*(\d{4})/.exec(fs.readFileSync(file, 'utf8')); return m ? m[1] : null; } catch { return null; }
}
const reap = (port) => UI.reapViteByPort(port);

// 清单来源：tests/ 里**会打 PASS/FAIL 断言**的脚本（从生产文件 grep 出断言标记后人工核对）。
// 纯读数探针（r41/r43/r47/r48sweep/r49b/r50b/r51/r52…）不在跑批里 —— 它们没有判定，
// 混进来只会污染汇总（r47 曾以 NOVERDICT 白占一格，现移出）。
const GATES = ['r7-p1a-wire', 'r11-sim-control', 'r12-export', 'r13-custom-gate', 'r14-coords', 'r17-verify',
  'r18-verify', 'r19-verify', 'r20-verify', 'r21-verify', 'r22-verify', 'r23-verify', 'r24-verify', 'r25-verify',
  'r26-verify', 'r27-verify', 'r30-verify', 'r31-verify', 'r32-verify', 'r33-verify', 'r34-verify', 'r35-verify',
  'r37-verify', 'r40-verify', 'r42-verify', 'r43e-verify', 'r44-verify', 'r46-menu-parity',
  'r48-verify', 'r49-parity', 'r50-ui-sim', 'r53-fsm-gate', 'r55-memports-gate', 'r56-conflict-gate',
  'r57-zoom-anchor-gate', 'r60-part-binding-gate', 'r61-dark-label-gate', 'r62-sandbox-speed-gate', 'r65-numbase-gate', 'r68-fanin-gate', 'r71-abort-port-gate', 'r76-sparse-mux-gate', 'r81-line-gate', 'r82-move-def-gate', 'r83-errorcopy-gate', 'r84-binding-gate', 'r85-posfidelity-gate', 'r87-esc-shape-gate', 'r90-single-owner-gate', 'r91-palette-coverage-gate', 'r92-routing-gate', 'r94-dff-polarity-gate', 'r95-signed-toggle-gate', 'r99-ui-unify-gate', 'r113-mirror-rotate-gate', 'r114-const-fold-gate', 'selfaudit2-sandbox',
  'qc-audit', 'qc-audit2', 'qc-paused', 'qc-preview', 'qc-realuser'];
const only = process.argv.slice(2);
const list = only.length ? only : GATES;
fs.mkdirSync(LOGDIR, { recursive: true });
const results = [];
for (const g of list) {
  const file = path.join(ROOT, 'tests', g + '.cjs');
  if (!fs.existsSync(file)) {
    results.push([g, 'NOVERDICT', '脚本不存在']);
    console.log(`## ${g}: NOVERDICT 脚本不存在`);
    continue;
  }
  const port = gatePort(file);
  const r = spawnSync('node', [file], { cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const reaped = reap(port);
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  fs.writeFileSync(path.join(LOGDIR, g + '.log'), out, 'utf8');
  const lines = out.split('\n');
  const npass = lines.filter((l) => /^\s*PASS\b/.test(l)).length;
  const assertionFails = lines.filter((l) => /^\s*FAIL\b/.test(l));
  const fatals = lines.filter((l) => /^\s*FATAL\b/.test(l));
  const envFatals = fatals.filter((l) => ENV_RE.test(l));
  const timedOut = r.error != null;
  const code = timedOut ? String(r.error.code || 'TIMEOUT') : String(r.status);
  let status = 'GREEN';
  if (npass === 0) status = 'NOVERDICT';
  const envish = timedOut || envFatals.length > 0 || (r.status !== 0 && ENV_RE.test(out));
  if (assertionFails.length > 0) status = 'RED';
  else if (fatals.length > 0 || r.status !== 0) status = envish ? 'ENVRED' : 'RED';
  results.push([g, status, `pass=${npass} fail=${assertionFails.length} fatal=${fatals.length} exit=${code} 收掉遗留服务=${reaped}`]);
  console.log(`## ${g}: ${status} pass=${npass} fail=${assertionFails.length} exit=${code}`);
  for (const l of [...assertionFails, ...fatals].slice(0, 6)) console.log('    ' + l.trim().slice(0, 220));
}
const count = (s) => results.filter((x) => x[1] === s).length;
console.log('\n===== 汇总 =====');
for (const [g, s, d] of results) console.log(`${g.padEnd(18)} ${s.padEnd(10)} ${d}`);
console.log(`\nRED=${count('RED')} ENVRED=${count('ENVRED')} GREEN=${count('GREEN')} NOVERDICT=${count('NOVERDICT')} 共 ${results.length} 格`);
console.log('⚠ ENVRED ＝ 机器撑不住导致这格今天没判成：不是通过，也不算产品缺陷，必须单独重跑。');
console.log(`原始输出在 ${LOGDIR}`);
