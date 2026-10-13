/**
 * 一条命令把 VS Code 壳跑起来：`pnpm app`。
 *
 * 为什么要有这颗文件：之前文档里写的启动方式是「按 F5 → 再按 Ctrl+Shift+P → 再找那条命令」，
 * 那是把三步手工动作留给用户。本项目的一贯判据是多出来的每一步都算缺陷，所以这里补齐：
 * 缺产物就编、找得到 CLI 就直接开一个挂好本扩展的开发窗口、面板由扩展自己弹（见 extension/src/extension.ts）。
 *
 * 纯逻辑（候选路径表、新旧判定、参数拼法）都导出，`tests/unit/launcher.test.ts` 能直接判，
 * ⛔ 装完必须开一次 GUI 才知道对不对。
 */
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 各平台上 VS Code CLI 的常见落点（顺序＝先用户级再系统级，先稳定版再 Insiders/Codium） */
export function cliCandidates(platform = process.platform, env = process.env) {
  const home = env.HOME || env.USERPROFILE || '';
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
      path.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(pf, 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(pf86, 'Microsoft VS Code', 'bin', 'code.cmd'),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      path.join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
    ];
  }
  return ['/usr/share/code/bin/code', '/usr/bin/code', path.join(home, '.local', 'bin', 'code'), '/var/lib/flatpak/exports/bin/com.visualstudio.code'];
}

/** PATH 上的 `code`（`--version` 真跑得通才算数：⛔ 拿一个同名不同物的二进制当编辑器） */
export function whichOnPath(names = ['code', 'code-insiders', 'codium'], run = spawnSync) {
  for (const n of names) {
    try {
      const r = run(n, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
      if (r && r.status === 0 && /\d/.test(String(r.stdout))) return n;
    } catch { /* 换下一个候选名 */ }
  }
  return null;
}

/** 找 CLI：`VSCODE_BIN`（显式指路）→ PATH → 平台常见落点。全落空＝返回 null，由调用方给可执行的下一步 */
export function findVscodeCli({ platform = process.platform, env = process.env, run = spawnSync, exists = fs.existsSync } = {}) {
  const explicit = (env.VSCODE_BIN || '').trim();
  if (explicit) return { bin: explicit, ok: exists(explicit) || Boolean(whichOnPath([explicit], run)), how: 'VSCODE_BIN' };
  const onPath = whichOnPath(undefined, run);
  if (onPath) return { bin: onPath, ok: true, how: 'PATH' };
  for (const c of cliCandidates(platform, env)) {
    if (exists(c)) return { bin: c, ok: true, how: '常见安装路径' };
  }
  return { bin: null, ok: false, how: '没找到' };
}

/**
 * dist 该不该重编：dist/index.html ⛔ 存在，或 src / public / index.html / vite.config / package.json
 * 里任何一颗比它新 ⇒ 要编。（同一族纪律见 tests/_ui.cjs 的 ensureFreshDist：读旧产物会把已修好的东西判成没修。）
 */
export function needsBuild({ root = ROOT, exists = fs.existsSync, stat = fs.statSync, readDir = fs.readdirSync } = {}) {
  const distIdx = path.join(root, 'dist', 'index.html');
  if (!exists(distIdx)) return { needed: true, why: 'dist/index.html 不存在' };
  const distM = stat(distIdx).mtimeMs;
  let newest = distM, who = distIdx;
  const walk = (dir) => {
    if (!exists(dir)) return;
    for (const e of readDir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const m = stat(p).mtimeMs;
      if (m > newest) { newest = m; who = p; }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'public'));
  for (const f of ['index.html', 'vite.config.ts', 'package.json']) {
    const p = path.join(root, f);
    if (exists(p)) { const m = stat(p).mtimeMs; if (m > newest) { newest = m; who = p; } }
  }
  return newest > distM ? { needed: true, why: `${who} 比 dist 新` } : { needed: false, why: 'dist 不旧于 src' };
}

/** 起开发窗口要传给 CLI 的参数（导出是为了能逐字判——尤其 `--extensionDevelopmentPath` 必须是绝对路径） */
export function launchArgs(extDir, workspaceRoot) {
  return ['--extensionDevelopmentPath=' + extDir, '--new-window', workspaceRoot];
}

/**
 * Windows 上 `code` 其实是 `code.cmd` ⇒ ⛔ shell 直接 spawn 会 EINVAL；
 * 可一旦 `shell: true`，Node 是把参数**用空格拼成一条串**交给 cmd.exe 的，它不替含空格的那一段加引号
 * ——本仓库路径就带空格（`Visual Studio Code`），拼出来的命令会在第一个空格处切开，
 * `--extensionDevelopmentPath=` 会指到 `D:\Visual`（这正是 StarMark 那边 #261 那一族：
 * `Start-Process -ArgumentList` 不引含空格元素，安装器去建 `D:\Visual`）。
 * 所以这里自己引：整段（含 `=` 前缀）一起包进双引号，cmd.exe 认这个写法。
 */
export function buildSpawn(bin, args, platform = process.platform) {
  if (platform !== 'win32') return { file: bin, args, options: { shell: false } };
  const quote = (s) => (/["\s]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s));
  const line = [bin, ...args].map(quote).join(' ');
  return { file: line, args: [], options: { shell: true } };
}

function runStep(cmd, args, label) {
  process.stdout.write(`\n> ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${label} 失败（退出码 ${r.status}）`);
}

/**
 * `--check`＝只报现场、⛔ 不动构建、⛔ 不开窗口。
 * 留这颗是因为"能不能找到 VS Code"这件事本来可以无头判，没它就只能真开一个 GUI 窗口才知道
 * （那既打扰用户，也把一颗纯逻辑的判据变成必须真机项）。
 */
export function check() {
  const found = findVscodeCli();
  const nb = needsBuild();
  const extBundle = path.join(ROOT, 'extension', 'dist', 'extension.cjs');
  const distIdx = path.join(ROOT, 'dist', 'index.html');
  const lines = [
    `VS Code CLI  : ${found.ok ? found.bin : '⛔ 没找到'}（来源 ${found.how}）`,
    `前端产物      : ${fs.existsSync(distIdx) ? '在' : '缺'}；${nb.needed ? '要重编（' + nb.why + '）' : '不旧于 src'}`,
    `扩展 bundle   : ${fs.existsSync(extBundle) ? '在' : '缺（跑 pnpm -C extension build）'}`,
    `实际要跑的     : ${JSON.stringify(buildSpawn(found.bin || '<code>', launchArgs(path.join(ROOT, 'extension'), ROOT)).file)}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
  return found.ok ? 0 : 3;
}

export function main() {
  const extDir = path.join(ROOT, 'extension');
  const nb = needsBuild();
  if (nb.needed) runStep('pnpm', ['build'], `前端构建（${nb.why}）`);
  else process.stdout.write(`产物是新的：${nb.why}\n`);
  runStep('pnpm', ['-C', 'extension', 'build'], 'Extension Host 打包');

  const found = findVscodeCli();
  if (!found.ok) {
    process.stderr.write([
      '',
      '找不到 VS Code 命令行。已经试过：PATH 上的 code / code-insiders / codium，以及这些常见安装位置：',
      ...cliCandidates().map((c) => '  ' + c),
      '',
      '任选一条（⛔ 装新编辑器才算，指个路就行）：',
      `  1) 在 VS Code 里 Ctrl+Shift+P →「Shell Command: Install 'code' command in PATH」后重跑 pnpm app`,
      `  2) 直接指给它：VSCODE_BIN="<VS Code 的 code 可执行文件路径>" pnpm app`,
      `  3) 已在 VS Code 里的话：仓库根按 F5「运行 扩展开发宿主」——面板现在会自己弹，⛔ 再去命令面板找命令`,
      '',
    ].join('\n'));
    return 3;
  }
  const args = launchArgs(extDir, ROOT);
  process.stdout.write(`\n用 ${found.bin}（来自 ${found.how}）开开发窗口…\n`);
  const spec = buildSpawn(found.bin, args);
  // detached + stdio ignore：VS Code 关掉后这颗脚本⛔ 挂着；pnpm app 也就此返回
  const child = spawn(spec.file, spec.args, { detached: true, stdio: 'ignore', ...spec.options });
  child.on('error', (e) => process.stderr.write(`启动失败：${e.message}\n`));
  child.unref();
  process.stdout.write('窗口正在打开。画布若空白，先确认跑过 pnpm build（扩展会读 dist/index.html）。\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = process.argv.includes('--check') ? check() : main(); }
  catch (e) { process.stderr.write(`\n${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; }
}
