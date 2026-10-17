// ============================================================================
// 真宿主集成测试启动器（node scripts，⛔ 依赖 @vscode/test-electron——用本地源码构建的
// 真机 exe `D:/vv-studio/vscode/.build/electron/*.exe` 直接跑 --extensionTestsPath 通道）。
// 流程：esbuild 打 test-real.cjs（external:vscode）→ 临时工作区真盘播种 → 拉真机 →
//       读 results JSON（真值）→ 摘要 + 退出码。窗口会短暂弹出——属真机测试本体。
// ============================================================================
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));      // extension/
const repo = path.resolve(here, '..');
const APP = 'D:/vv-studio/vscode';
const exe = path.join(APP, '.build', 'electron', 'Verilog Visualizer.exe');
const TIMEOUT_MS = 150_000;

const sh = (cmd, opts = {}) => require('node:child_process').execSync(cmd, { stdio: 'inherit', ...opts });

// 1) 打包测试入口（external:vscode ⇒ 吃真宿主的 vscode）
esbuild.buildSync({
  entryPoints: [path.join(here, 'src', 'test-real', 'realSuite.ts')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: path.join(here, 'dist', 'test-real.cjs'),
  external: ['vscode'],
  logLevel: 'silent',
});

// 2) 临时工作区真盘播种
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-real-e2e-'));
const seed = {
  'main.djs': '{"cells":[]}',
  'fsm.djs': '{"cells":[]}',
  'parts/counter.djs': '{"cells":[]}',
  'gates/.keep': '',
  '.verilogviz.json': JSON.stringify({ circuits: ['parts/counter.djs'], bindings: { main: 'main.djs', fsm: 'fsm.djs' } }),
  '.vv/project.json': '{"kind":"project"}',
};
for (const [rel, text] of Object.entries(seed)) {
  const p = path.join(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
const resultsPath = path.join(os.tmpdir(), `vv-real-results-${Date.now()}.json`);
const profile = path.join(os.tmpdir(), `vv-real-profile-${Date.now()}`);

// 3) 拉真机（⚠ 源码构建形状：**第一个位置参数必须 app 目录 `.`**（code.bat 同款 %CODE% . %*）；
//    cwd=源码仓根；env 复刻 code.bat；`--disable-extension=<id>` 精确压掉内置旧副本防双载）
// ⚠ 那两颗 dev 旗标**必须写驼峰**：studio 基座 `src/vs/platform/environment/node/argv.ts:167/169`
//   登记的是 `extensionDevelopmentPath` / `extensionTestsPath`，而 kebab 别名（`--extension-tests-path`
//   那种）在这份 argv 里⛔ 存在 ⇒ 传 kebab 的结果是"扩展与测试模块都⛔ 被加载"：
//   真机窗口正常开（window1/exthost.log 只激活 vscode.git/github/emmet 那批内置扩展），
//   150 秒后 `exit=2`「结果文件不存在」——症状长得像"我们的测试挂了"，其实是旗标被静默丢弃。
const args = [
  '.',
  ws,
  '--extensionDevelopmentPath', path.join(repo, 'extension'),
  '--extensionTestsPath', path.join(repo, 'extension', 'dist', 'test-real.cjs'),
  '--user-data-dir', profile,
  '--disable-extension', 'local.verilog-visualizer-vscode',
  '--disable-workspace-trust',
  '--disable-gpu',              // 无头/沙箱会话 GPU 进程崩（GPU process isn't usable）——CI 标准解法
  '--no-sandbox',               // 沙箱代理在受限会话派生子进程即 0xC0000005（renderer 连环崩同根）
];
console.log(`[real-e2e] 拉真机：${exe}`);
console.log(`[real-e2e] 工作区：${ws}`);
// ⚠ 环境消毒（自检实测）：宿主 App 派生的 shell 带 ELECTRON_RUN_AS_NODE=1——继承它会把真机
//   exe 降级成纯 node（症状：out/main.js 报 "electron 不提供 Menu 导出"+底部裸 Node 版本行）。
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;
delete cleanEnv.NODE_OPTIONS;
const child = spawn(exe, args, {
  cwd: APP,
  env: { ...cleanEnv, NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1', VV_REAL_RESULTS: resultsPath, VV_REAL_WORKSPACE: ws },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { out += String(d); });

const done = new Promise((resolve) => {
  const killer = setTimeout(() => {
    console.error(`[real-e2e] 超时 ${TIMEOUT_MS}ms——taskkill 进程树`);
    try { sh(`taskkill /pid ${child.pid} /T /F`); } catch { /* 已退 */ }
    resolve(-1);
  }, TIMEOUT_MS);
  // 完成哨兵：results 旁的 .done 落地 = 测试模块跑完（成功或失败）——提前收兵 ⛔ 等宿主自退
  const poll = setInterval(() => {
    if (fs.existsSync(resultsPath + '.done')) {
      clearInterval(poll);
      clearTimeout(killer);
      setTimeout(() => { try { sh(`taskkill /pid ${child.pid} /T /F`); } catch { /* 已退 */ } resolve(0); }, 500);
    }
  }, 1000);
  child.on('exit', (code) => { clearTimeout(killer); clearInterval(poll); resolve(code ?? -1); });
});

const code = await done;
fs.writeFileSync(path.join(os.tmpdir(), `vv-real-host-out-${Date.now()}.log`), out);
console.log(`[real-e2e] 宿主退出码：${code}`);

// 4) 真值 = results JSON（宿主退出码只作参考）
if (!fs.existsSync(resultsPath)) {
  console.error('[real-e2e] ⛔ 结果文件不存在——测试模块没跑到（见 host out 日志）');
  console.error(out.slice(-3000));
  process.exit(2);
}
const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
for (const s of r.results) {
  console.log(`${s.ok ? '✅' : '❌'} ${s.step}  (${s.ms}ms)${s.error ? `\n   └ ${s.error}` : ''}`);
}
console.log(`[real-e2e] ${r.ok ? '✅ 真机全绿' : '❌ 真机有红'} — 工作区保留：${ws}`);
process.exit(r.ok ? 0 : 1);
