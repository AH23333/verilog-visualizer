// 启动器 `scripts/run-in-vscode.mjs` 的判据（R138）。
// 为什么这颗文件值得单独判：它替用户做的前三件事（要不要重编、VS Code 在哪、命令怎么拼）
// 全是**不需要开 GUI 也能算**的，而它拼错的样子恰好是"双击没反应"那一族——
// 特别是本仓库路径自带空格（`D:\Visual Studio Code\...`），Windows 上少引号就会断在第一个空格处。
// ⛔ .ts：tsc 的 include 里有 tests/unit 而 tsconfig ⛔ allowJs，写 .ts 会让根 `tsc --noEmit` 报"找不到模块"。
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  buildSpawn, cliCandidates, findVscodeCli, launchArgs, needsBuild,
} from '../../scripts/run-in-vscode.mjs';

describe('拼给操作系统的命令（含空格路径）', () => {
  const BIN = 'code';
  const ARGS = ['--extensionDevelopmentPath=D:\\Visual Studio Code\\Repo\\extension', '--new-window', 'D:\\Visual Studio Code\\Repo'];

  it('Windows：含空格的整段参数各自带引号，且必须走 shell（code 其实是 code.cmd）', () => {
    const spec = buildSpawn(BIN, ARGS, 'win32');
    expect(spec.options.shell).toBe(true);
    // 整段（`--flag=路径`）一起包，⛔ 只包路径那半——cmd.exe 认的是"一个 token 一对引号"
    expect(spec.file).toContain('"--extensionDevelopmentPath=D:\\Visual Studio Code\\Repo\\extension"');
    expect(spec.file).toContain('"D:\\Visual Studio Code\\Repo"');
    expect(spec.args).toEqual([]);
  });

  it('这颗判据自己也要有牙：把参数裸拼（不加引号）的写法必须判得出来', () => {
    const spec = buildSpawn(BIN, ARGS, 'win32');
    // 裸拼＝旧写法，它会让 cmd 在第一个空格切开 ⇒ `--extensionDevelopmentPath` 指到 `D:\Visual`
    const naive = [BIN, ...ARGS].join(' ');
    expect(spec.file).not.toBe(naive);
    expect(naive).not.toContain('"');
  });

  it('非 Windows：不套 shell，参数原样数组交给 execve（⛔ 拼成一条串丢给 /bin/sh）', () => {
    const spec = buildSpawn('/usr/bin/code', ['--new-window', '/tmp/a b'], 'linux');
    expect(spec.file).toBe('/usr/bin/code');
    expect(spec.args).toEqual(['--new-window', '/tmp/a b']);
    expect(spec.options.shell).toBe(false);
  });
});

describe('VS Code 命令行在哪', () => {
  it('launchArgs 给的是绝对扩展目录（相对路径在 VS Code 那头解析点⛔ 是我们这个 cwd）', () => {
    const a = launchArgs('D:\\Repo\\extension', 'D:\\Repo');
    expect(a[0]).toBe('--extensionDevelopmentPath=D:\\Repo\\extension');
    expect(a[1]).toBe('--new-window');
    expect(a[2]).toBe('D:\\Repo');
  });

  it('VSCODE_BIN 优先；PATH 命中就用 PATH；两处都空才回落常见安装路径', () => {
    const fakeRun = (name, args) => ({ status: name === 'code' ? 0 : 1, stdout: '1.105.1\n' });
    expect(findVscodeCli({ platform: 'win32', env: { VSCODE_BIN: 'D:\\x\\code.cmd' }, run: fakeRun, exists: () => true }).bin)
      .toBe('D:\\x\\code.cmd');
    const viaPath = findVscodeCli({ platform: 'win32', env: {}, run: fakeRun, exists: () => false });
    expect(viaPath.bin).toBe('code');
    const none = findVscodeCli({ platform: 'win32', env: {}, run: () => ({ status: 1, stdout: '' }), exists: () => false });
    expect(none.ok).toBe(false);
  });

  it('候选路径表按平台给（win32 认 LOCALAPPDATA／Program Files，darwin 认 /Applications）', () => {
    // 比较前统一成 `/`：候选表是给**本机**用的（`findVscodeCli` 只传 process.platform），
    // 而 `path.join` 的分隔符跟着跑测试的这台机器走 ⇒ 在 Windows 上判 darwin 那一支，
    // 拿原始字符串比会红在分隔符上，⛔ 是判据想问的事。
    const norm = (a) => a.map((p) => p.replace(/\\/g, '/'));
    const win = norm(cliCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }));
    expect(win.some((p) => p.includes('Programs/Microsoft VS Code/bin'))).toBe(true);
    expect(win[0]).toBe('C:/Users/u/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd');
    const mac = norm(cliCandidates('darwin', { HOME: '/Users/u' }));
    expect(mac[0]).toBe('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
    expect(mac[1]).toBe('/Users/u/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
  });
});

describe('要不要重编前端', () => {
  // ⚠ 夹具里的路径**一律用 path.join 现拼**：`path.join('/r','src')` 在 Windows 上给的是 `\r\src`，
  // 手打正斜杠会让走目录那一段静默落空——于是"src 比 dist 新 ⇒ 要编"那一臂永远拿到 needed=false，
  // 红的是夹具⛔ 是判据（换到 CI 的 linux 上它又会绿，两头都骗人）。
  const P = (...seg) => path.join(...seg);
  const mk = ({ files, srcFiles = ['App.tsx'], hasDist = true }) => ({
    root: '/r',
    exists: (p) => (p === P('/r/dist', 'index.html') ? hasDist : true),
    stat: (p) => ({ mtimeMs: files[p] ?? 0 }),
    readDir: (d) => (d === P('/r/src') ? srcFiles : []).map((name) => ({ name, isDirectory: () => false })),
  });

  it('dist/index.html 不存在 ⇒ 一定编', () => {
    const r = needsBuild({ root: '/r', exists: () => false, stat: () => ({ mtimeMs: 0 }), readDir: () => [] });
    expect(r.needed).toBe(true);
    expect(r.why).toContain('不存在');
  });

  it('src 里任何一颗比 dist 新 ⇒ 编，并把那颗报出来（读旧产物＝把已修好的东西判成没修）', () => {
    const r = needsBuild(mk({ files: { [P('/r/dist', 'index.html')]: 1000, [P('/r/src', 'App.tsx')]: 2000 } }));
    expect(r.needed).toBe(true);
    expect(r.why).toContain('App.tsx');
  });

  it('dist 不比 src 旧 ⇒ ⛔ 白编一次（这条存在是因为启动器每次 pnpm app 都会问一遍）', () => {
    const r = needsBuild(mk({ files: { [P('/r/dist', 'index.html')]: 5000, [P('/r/src', 'App.tsx')]: 4000 } }));
    expect(r.needed).toBe(false);
  });
});
