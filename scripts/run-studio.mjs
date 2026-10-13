/**
 * `pnpm studio:run` —— **一条命令起我们自己的二进制**（产品形态＝自带 Code - OSS 分支，见 `studio/README.md` §0b）。
 *
 * 为什么要有这颗脚本（而⛔ 让人记四条命令）：本仓自己的判据写死了——"多一步手工动作"就算缺陷。
 * 起来一次要干的是：① 前端产物新不新；② Extension Host 编没编；③ 品牌与内置扩展装没装进基座；
 * ④ 基座那条 `code.bat` 起不起得来（Windows 上它是 `.bat` ⇒ 必须 shell，参数还得各自带引号）。
 * 这四步人肉做就会漏，漏的结果是"打开的是⛔ 含我最新改动的那份"——比报错更贵（本仓为这类事红过多次）。
 *
 * ⚠ 一颗**一次性的**例外：基座那份 checkout 如果还⛔ `npm install` / ⛔ 编过，这里⛔ 自动跑
 * （那是 6 分钟 + 1590 颗包 + 几 GB，替用户默默发起一次这种动作⛔ 是"尽力而为"，是鲁莽）。
 * 这一格的处理是**把下一步的整条命令打印出来**（⛔ 一句"请先自行安装基座"）。
 *
 * 只报现场、⛔ 真起窗口：`pnpm studio:run --check`（"路径对不对 / 该不该重编 / 打算跑什么命令"本来无头就能判）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpawn, needsBuild, ROOT } from './run-in-vscode.mjs';
import { DEFAULT_FORK, main as brandMain } from '../studio/apply-brand.mjs';

/** 基座里我们要用到的四颗路径。⚠ `profile` 与 fork **同级**（⛔ 落进他的用户目录，也⛔ 混进他日常 VS Code 的配置） */
export function forkPaths(fork = process.env.VERILOG_STUDIO_FORK || DEFAULT_FORK, platform = process.platform) {
  const script = platform === 'win32'
    ? path.join(fork, 'scripts', 'code.bat')
    : path.join(fork, 'scripts', 'code.sh');
  return {
    fork,
    script,
    outDir: path.join(fork, 'out'),
    nodeModules: path.join(fork, 'node_modules'),
    profile: process.env.VERILOG_STUDIO_PROFILE || path.join(path.dirname(fork), 'profile'),
  };
}

/**
 * 基座处在哪一格——**按代价从低到高**排，第一个缺的东西就是该告诉用户的那一步。
 * （⛔ 一句"基座没准备好"：那等于让人自己去猜是缺 clone、缺 npm install，还是缺 compile。）
 */
export function forkStage(fp, exists = fs.existsSync) {
  if (!exists(fp.fork)) return 'no-checkout';
  if (!exists(fp.nodeModules)) return 'no-deps';
  if (!exists(fp.outDir)) return 'not-compiled';
  if (!exists(fp.script)) return 'no-script';
  return 'ready';
}

/** 每一格的下一步：整条命令可直接粘贴（路径用实测的那个，⛔ 写成 `<你的路径>`） */
export function nextStep(stage, fp) {
  const p = (s) => s.replace(/\\/g, '/');
  switch (stage) {
    case 'no-checkout':
      return `git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git ${p(fp.fork)}`
        + `\n⚠ 路径⛔ 含空格：上游 preinstall spawn 时⛔ 给路径加引号，带空格会在第一个空格处炸（实测跑满四分钟才报错）`;
    case 'no-deps':
      // ⚠ 这两条要十几到几十分钟、几 GB；⛔ 我们替你默默发起
      return `cd ${p(fp.fork)} && npm install`;
    case 'not-compiled':
      return `cd ${p(fp.fork)} && npm run compile-client && npm run electron`;
    case 'no-script':
      return `基座里找⛔ 到启动脚本 ${p(fp.script)}（那份 checkout 完整吗？）`;
    default:
      return '';
  }
}

/** 起窗口那串参数：⛔ 动他日常 VS Code 的配置，所以 profile 一律显式给 */
export function runArgs(fp, folder, extra = []) {
  const args = [`--user-data-dir=${fp.profile}`, ...extra];
  if (folder) args.push(folder);
  return args;
}

/** 把"该重编"的三条命令按需要排好（前端产物新不新、扩展 bundle 在⛔ 在） */
export function buildSteps({ needWeb = needsBuild().needed, extMissing = !fs.existsSync(path.join(ROOT, 'extension', 'dist', 'extension.cjs')) } = {}) {
  const steps = [];
  if (needWeb) steps.push(['pnpm', ['build']]);
  if (extMissing) steps.push(['pnpm', ['-C', 'extension', 'build']]);
  return steps;
}

/**
 * 一次运行要干什么，**纯函数**版（`check()` 与 `main()` 都读它）。
 * 之所以要抽出来：`⛔ 就绪就⛔ spawn`（那条 6 分钟、几 GB 的一次性安装/编译）这条安全决定
 * 只能靠真判据钉住，⛔ 靠"我看了一眼 main() 里是这么写的"。
 */
export function plan({ fork = process.env.VERILOG_STUDIO_FORK || DEFAULT_FORK, platform = process.platform, exists = fs.existsSync, folder, needWeb, extMissing } = {}) {
  const fp = forkPaths(fork, platform);
  const stage = forkStage(fp, exists);
  return {
    paths: fp,
    stage,
    ready: stage === 'ready',
    next: stage === 'ready' ? '' : nextStep(stage, fp),
    steps: stage === 'ready' ? buildSteps({ needWeb, extMissing }) : [],
    spawn: stage === 'ready' ? buildSpawn(fp.script, runArgs(fp, folder), platform) : null,
    cwd: fp.fork,
  };
}

function say(s) { process.stdout.write(s + '\n'); }

/** 只报现场：⛔ 构建、⛔ spawn——这四件本来无头就能判 */
export function check(argv = process.argv.slice(2)) {
  const p = plan({ folder: argv.find((a) => !a.startsWith('-')) });
  say(`基座位置 : ${p.paths.fork}`);
  say(`状态     : ${p.stage}`);
  say(`启动脚本 : ${p.paths.script}${fs.existsSync(p.paths.script) ? '' : '（⛔ 存在）'}`);
  say(`用户数据 : ${p.paths.profile}（与 fork 同级，⛔ 是他日常 VS Code 的配置目录）`);
  if (!p.ready) say(`下一步   : ${p.next}`);
  say(`本轮要先编: ${p.steps.length ? p.steps.map((s) => [s[0], ...s[1]].join(' ')).join(' ｜ ') : '⛔（产物是新的）'}`);
  say(`打算执行 : ${JSON.stringify(p.spawn)}`);
  return p.ready ? 0 : 3;
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const exists = deps.exists ?? fs.existsSync;
  // ⚠ 这颗 spawn 收四参、第第四参是 cwd：构建步骤⛔ 在仓库根跑，起窗口那颗才在基座那边跑。
  //   上一版共用一个 deps.cwd（＝基座目录），于是 `pnpm build` 落进 Code - OSS 那份 checkout 里执行，
  //   报的是 `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "build" not found`——真跑一条命令才炸出来的 bug（判据⛔ 记 cwd 就测不到）。
  const spawn = deps.spawn ?? ((file, args, options, cwd) => spawnSync(file, args, { cwd, stdio: 'inherit', ...options }));
  const brand = deps.brand ?? ((a) => brandMain(a));
  const p = plan({ folder: argv.find((a) => !a.startsWith('-')), exists, needWeb: deps.needWeb, extMissing: deps.extMissing });

  if (!p.ready) {
    process.stderr.write([
      `基座还⛔ 就绪（当前那一格＝${p.stage}）：${p.paths.fork}`,
      `下一步跑这一条：`,
      p.next,
      '',
      '（这一格⛔ 我们代跑：那是几分钟到几十分钟、几 GB 的一次性安装/编译。跑完再回来敲 `pnpm studio:run` 就是一条命令的事。）',
      '',
    ].join('\n'));
    return 3;
  }

  for (const [bin, args] of p.steps) {
    say(`› ${bin} ${args.join(' ')}`);
    const r = spawn(bin, args, { shell: process.platform === 'win32' }, ROOT);
    if (r.status !== 0) { say(`✗ ${bin} ${args.join(' ')} 退出码 ${r.status}`); return r.status ?? 1; }
  }

  say('› 装进基座（品牌 + 内置扩展）');
  const code = brand([`--fork=${p.paths.fork}`]);
  if (code !== 0) return code;

  say(`› 起我们自己的二进制：${p.spawn.file}${p.spawn.args.length ? ' ' + p.spawn.args.join(' ') : ''}`);
  const r = spawn(p.spawn.file, p.spawn.args, p.spawn.options, p.cwd);
  return r.status ?? 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = process.argv.includes('--check') ? check() : main(process.argv.slice(2));
}
