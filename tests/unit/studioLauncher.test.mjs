// `pnpm studio:run`（scripts/run-studio.mjs）的判据——"起我们自己的二进制"这条一条命令的路。
// 为什么这批值得无头钉：这颗脚本的价值全在**它替人记住了四步**（前端产物 / 扩展 bundle / 装进基座 / 起 code.bat），
// 而这四步里最容易错的两件是：① 把用户数据目录落到他日常 VS Code 的配置上（那就是污染别人的 App），
// ② 基座⛔ 就绪时**还是把窗口起起来**（那时起的是上一份⛔ 含本次改动的产物，症状是"我改的没生效"，
//    比直接报错贵得多）。两件都能在纯函数里判，⛔ 留给"跑一遍看看"。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forkPaths, forkStage, nextStep, runArgs, buildSteps, plan, main } from '../../scripts/run-studio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FORK = 'D:/vv-studio/vscode';

/** 一份"哪几颗存在"的开关，喂给 forkStage / plan（⛔ 碰真磁盘：那会让这格判据在别的机器上跟着抖） */
const existsSet = (set) => (p) => set.has(p);
const READY = (fp) => existsSet(new Set([fp.fork, fp.nodeModules, fp.outDir, fp.script]));

describe('基座路径的推导（⛔ 污染别人 App 的那一格）', () => {
  it('profile 与 fork **同级**：既⛔ 落进仓库，也⛔ 落进他日常 VS Code 的用户目录', () => {
    const fp = forkPaths(FORK);
    expect(fp.profile.replace(/\\/g, '/')).toBe('D:/vv-studio/profile');
    expect(fp.profile).not.toContain('AppData');
    expect(fp.profile).not.toContain('.vscode');
  });

  it('启动脚本按平台选（Windows 是 .bat ⇒ 后面必须走 shell；posix 是 .sh）', () => {
    expect(forkPaths(FORK, 'win32').script.replace(/\\/g, '/')).toBe('D:/vv-studio/vscode/scripts/code.bat');
    expect(forkPaths(FORK, 'linux').script.replace(/\\/g, '/')).toBe('D:/vv-studio/vscode/scripts/code.sh');
  });

  it('环境变量能改指路（换机器⛔ 改代码）', () => {
    const saved = { fork: process.env.VERILOG_STUDIO_FORK, prof: process.env.VERILOG_STUDIO_PROFILE };
    // ⚠ 还原要按"原来有没有"分两路：把 undefined 赋回去＝写成字符串 "undefined"，
    //   后面每一格读到的 profile 都是那颗 undefined（上一版就是被这一行污染的，症状是 main 全部报"基座还⛔ 就绪"）。
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    process.env.VERILOG_STUDIO_FORK = 'E:/work/vscode';
    process.env.VERILOG_STUDIO_PROFILE = 'E:/work/prof';
    try {
      const fp = forkPaths();
      expect(fp.fork).toBe('E:/work/vscode');
      expect(fp.profile).toBe('E:/work/prof');
    } finally {
      restore('VERILOG_STUDIO_FORK', saved.fork);
      restore('VERILOG_STUDIO_PROFILE', saved.prof);
      expect(process.env.VERILOG_STUDIO_PROFILE).toBeUndefined();   // 这颗自证：污染当场就红
    }
  });
});

describe('基座处在哪一格：按代价从低到高，第一个缺的就是该说的那步', () => {
  const fp = forkPaths(FORK);

  it('四颗都齐才算 ready', () => {
    expect(forkStage(fp, READY(fp))).toBe('ready');
  });

  it('缺 checkout ⇒ no-checkout（⛔ 报"没找到 node_modules"那种让人去找错的东西）', () => {
    expect(forkStage(fp, existsSet(new Set([fp.nodeModules, fp.outDir, fp.script])))).toBe('no-checkout');
  });

  it('装了源码⛔ 装依赖 ⇒ no-deps；装了依赖⛔ 编 ⇒ not-compiled（**顺序**是这一族的重点）', () => {
    expect(forkStage(fp, existsSet(new Set([fp.fork, fp.outDir, fp.script])))).toBe('no-deps');
    expect(forkStage(fp, existsSet(new Set([fp.fork, fp.nodeModules, fp.script])))).toBe('not-compiled');
  });

  it('每一格的下一步都是一条**能直接粘**的命令（⛔ "请先自行安装基座"）', () => {
    const co = nextStep('no-checkout', fp);
    expect(co).toContain('git clone');
    expect(co).toContain(FORK);                       // 实测的那个路径写进去，⛔ 留 `<你的路径>`
    expect(co).toMatch(/⛔ 含空格/);                    // 上游 preinstall 不加引号那条实测坑
    expect(nextStep('no-deps', fp)).toContain('npm install');
    expect(nextStep('not-compiled', fp)).toContain('npm run compile-client');
    expect(nextStep('not-compiled', fp)).toContain('npm run electron');
  });
});

describe('起窗口那串参数', () => {
  const fp = forkPaths(FORK);

  it('⛔ 不给 --user-data-dir（那等于用他日常 VS Code 的配置跑我们的代码）', () => {
    expect(runArgs(fp)).toEqual([`--user-data-dir=${fp.profile}`]);
  });

  it('要打开的工程文件夹排在最后（宿主按位置参数认工作区）', () => {
    expect(runArgs(fp, 'D:/projects/计数器')).toEqual([`--user-data-dir=${fp.profile}`, 'D:/projects/计数器']);
  });

  it('Windows 上每个含空格的参数**各自**带引号（裸拼会在第一颗空格处断，那是本仓自己踩过的形状）', () => {
    const fp = forkPaths(FORK);
    const p = plan({ fork: FORK, exists: READY(fp), needWeb: false, extMissing: false, folder: 'D:/my proj' });
    expect(p.spawn.file).toContain('"D:/my proj"');            // 工作区那颗要自己成一段
    expect(p.spawn.file).toContain('--user-data-dir=');
    expect(p.spawn.file.startsWith(fp.script)).toBe(true);   // ⚠ 反斜杠形状：path.join 出来的，⛔ 手打正斜杠比它
    // 变异证人：把 buildSpawn 的引号去掉时这一臂会红——⛔ 让"拼一条串"这件事没人守
    expect(p.spawn.file.split(' ').length).toBeGreaterThan(1);
  });
});

describe('plan / main：⛔ 就绪就⛔ spawn（这一族最贵的错是"看起来跑了，其实跑的是上一份"）', () => {
  const fp = forkPaths(FORK);

  it('未就绪 ⇒ ready=false、spawn=null、next 给得出下一步', () => {
    const p = plan({ fork: FORK, exists: existsSet(new Set([fp.fork, fp.nodeModules])) });
    expect(p.stage).toBe('not-compiled');
    expect(p.ready).toBe(false);
    expect(p.spawn).toBe(null);
    expect(p.next).toContain('compile-client');
  });

  it('就绪 ⇒ spawn 指向那份 code.bat，参数里带着我们自己的 profile', () => {
    const p = plan({ fork: FORK, exists: READY(fp), needWeb: false, extMissing: false, folder: 'D:/p' });
    expect(p.ready).toBe(true);
    expect(p.steps).toEqual([]);                      // 产物是新的 ⇒ 一条构建都⛔ 跑
    expect(p.spawn.file).toContain('code.bat');
    expect(p.spawn.file).toContain(`--user-data-dir=${fp.profile}`.replace(/\//g, '\\'));
    expect(p.spawn.options.shell).toBe(true);         // .bat⛔ shell 起不来
  });

  it('main 在未就绪时返回 3 且**一颗进程都⛔ spawn**（那条 6 分钟 / 几 GB 的一次性安装⛔ 替用户默默发起）', () => {
    const calls = [];
    const code = main([], {
      exists: existsSet(new Set([fp.fork])),
      spawn: (file, args) => { calls.push([file, args]); return { status: 0 }; },
      brand: () => { calls.push(['brand', []]); return 0; },
    });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
  });

  it('main 就绪时的顺序＝构建 → 装进基座 → 起窗口；构建失败要**当场停**（⛔ 起一颗跑旧产物的窗口）', () => {
    const calls = [];
    const ok = { status: 0 };
    const code = main(['D:/p'], {
      exists: READY(forkPaths(FORK)),
      needWeb: true, extMissing: true,
      spawn: (file, args, options, cwd) => { calls.push([[file, args].flat().join(' '), cwd].join(' @ ')); return ok; },
      brand: (a) => { calls.push('brand ' + a.join(' ') + ' @ nowhere'); return 0; },
    });
    expect(code).toBe(0);
    // 顺序本身是判据：⛔ 装进基座之前就起窗口（那起的是上一份产物），也⛔ 跳过装那一步
    expect(calls.length).toBe(4);
    expect(calls[0]).toContain('pnpm build');
    expect(calls[1]).toContain('-C extension build');
    expect(calls[2]).toContain('brand --fork');
    expect(calls[3]).toContain('code.bat');
    // ⚠ 这一族是本轮**真跑一条命令**才炸出来的：构建步骤⛔ 在仓库根跑。
    //   跑错到基座目录时报的是 `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "build" not found`
    //   （那份 checkout 里⛔ 这颗 script），症状看着像"本仓的 build 脚本坏了"。判据⛔ 记 cwd 就测不到这一族。
    expect(calls[0].split(' @ ')[1]).toBe(ROOT);
    expect(calls[1].split(' @ ')[1]).toBe(ROOT);
    expect(calls[3].split(' @ ')[1]).toBe(FORK);      // 而起窗口那一颗在基座那边跑
  });

  it('构建那一颗失败 ⇒ ⛔ 走到装基座与起窗口', () => {
    const calls = [];
    const code = main([], {
      exists: READY(forkPaths(FORK)),
      needWeb: true, extMissing: false,
      spawn: (file, args) => { calls.push([file, args].flat().join(' ')); return { status: 2 }; },
      brand: () => { calls.push('brand'); return 0; },
    });
    expect(code).toBe(2);
    expect(calls.length).toBe(1);
  });

  it('brand 那一步非 0（比如基座路径含空格）⇒ ⛔ 起窗口', () => {
    const calls = [];
    const code = main([], {
      exists: READY(forkPaths(FORK)),
      needWeb: false, extMissing: false,
      spawn: (file, args) => { calls.push([file, args].flat().join(' ')); return { status: 0 }; },
      brand: () => 4,
    });
    expect(code).toBe(4);
    expect(calls.length).toBe(0);
  });
});

describe('构建清单与两条入口共存', () => {
  it('buildSteps 只缺一样就只排一条（⛔ 白编一次前端）', () => {
    expect(buildSteps({ needWeb: true, extMissing: false })).toEqual([['pnpm', ['build']]]);
    expect(buildSteps({ needWeb: false, extMissing: true })).toEqual([['pnpm', ['-C', 'extension', 'build']]]);
    expect(buildSteps({ needWeb: false, extMissing: false })).toEqual([]);
  });

  it('`pnpm app`（开发宿主）与 `pnpm studio:run`（我们自己的二进制）两条都在：一条是调试路，一条是产品路', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['studio:run']).toBe('node scripts/run-studio.mjs');
    expect(pkg.scripts['studio:run:check']).toBe('node scripts/run-studio.mjs --check');
    expect(pkg.scripts.app).toBe('node scripts/run-in-vscode.mjs');
  });
});
