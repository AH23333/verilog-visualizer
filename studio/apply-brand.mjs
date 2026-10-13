/**
 * 把我们自己的品牌与配置**合进** Code - OSS 那份 checkout，并把本项目的扩展装成它的**内置扩展**。
 * 这是"自带 VS Code 源码分支出独立二进制"这条路的落地脚本（用户 2026-10-13 裁定，Cursor/Windsurf 同族做法）。
 *
 * 为什么写成"覆盖层 + 合并"⛔ 直接改基座的 product.json：
 *   基座会随上游更新（我们用的是 `main` 那份 checkout），整份覆盖＝每次都要手工重做全部字段，
 *   而且会把上游新加的必需字段一起抹掉。覆盖层只声明"我们改哪几颗"，剩下的跟着上游走。
 *
 * 纯逻辑（mergeProduct / 该装哪几颗文件）都导出，`tests/unit/studioBrand.test.mjs` 直接判，
 * ⛔ 只能靠"真跑一次 gulp 打包"才知道合对没合对。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const STUDIO_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(STUDIO_DIR, '..');
/**
 * 基座默认位置：**必须⛔ 含空格**（见 pathLooksBuildable 的说明）。
 * 放在仓库同级目录之外——那份 checkout 是上游 1 GB 源码，⛔ 进我们自己的 git。
 * 换机器时用 `--fork=<路径>` 或环境变量 `VERILOG_STUDIO_FORK` 指路。
 */
export const DEFAULT_FORK = 'D:/vv-studio/vscode';

/**
 * 上游的 `build/npm/preinstall.ts:143`（installHeaders）spawn 时**⛔ 给路径加引号**，
 * 所以 checkout 只要落在带空格的路径上，cmd 就会在第一个空格处切开：
 * 实测报 `'D:\Visual' is not recognized as an internal or external command`（npm error code 1，四分钟后才炸）。
 * 我们仓库本身就住在 `D:\Visual Studio Code\...` 下面 ⇒ 默认值⛔ 从仓库相对位置推，
 * 且这里**提前拒**带空格的路径：让它在三秒内说清"换个无空格位置"，⛔ 让人等一次长安装再失败。
 */
export function pathLooksBuildable(p) {
  return !/\s/.test(p);
}

/** 我们扩展装进基座后的目录名＝扩展 id（VS Code 按这个认内置扩展） */
export const BUILTIN_EXT_ID = 'verilog-visualizer';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 覆盖层合进基座：标量覆盖、对象递归深合、数组**整体替换**（⛔ 拼接）。
 * 数组按替换处理是刻意的：product.json 里像 `extensionEnabledApiProposals` 这类是"某扩展允许哪些提案"的
 * 清单，拼接会把上游那条清单和我们这条混成两条同名键，读的人⛔ 看得出哪条生效。
 * `_comment` 只给我们自己看，⛔ 进产物。
 */
export function mergeProduct(base, overrides) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (k === '_comment') continue;
    if (isObj(v) && isObj(out[k])) out[k] = mergeProduct(out[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * 内置扩展要落哪几颗文件：`package.json` + `extension.cjs` + `webview/**`。
 * 抽成纯函数是为了能判"⛔ 把 dist 之外的东西（src/、node_modules/、.vsix）一起塞进去"。
 */
export function builtinExtFiles(extSrcDir, fsImpl = fs) {
  const need = ['package.json', path.join('dist', 'extension.cjs')];
  const missing = need.filter((f) => !fsImpl.existsSync(path.join(extSrcDir, f)));
  const hasWebview = fsImpl.existsSync(path.join(extSrcDir, 'webview', 'index.html'));
  return { missing, hasWebview, outDirName: BUILTIN_EXT_ID };
}

/** 幂等检查用的指纹：合并结果里我们关心的那几颗键必须真在（⛔ 只看"脚本跑成功了"） */
export const VERIFY_KEYS = ['nameShort', 'applicationName', 'dataFolderName', 'urlProtocol'];

export function verifyProduct(product, overrides) {
  return VERIFY_KEYS.filter((k) => String(product[k]) !== String(overrides[k]));
}

/**
 * 从原文里**认出缩进**：基座那份 product.json 用制表符，我第一版按 2 空格重写，
 * 结果"只改 17 颗键"的覆盖在 diff 里变成 253 增 / 248 删，全是缩进噪声（评审时看不出到底改了哪颗）。
 * 认不出来退回制表符（基座风格）。行尾固定 LF：基座那份是 LF，写成 CRLF 同样整档漂。
 */
export function detectIndent(text) {
  const m = /^[ \t]+[^:]/m.exec(text);
  if (!m) return '\t';
  return text.slice(m.index, m.index + m[0].length - 1);
}

/** 合并后按基座原风格渲染（导出给单测判"缩进⛔ 跟着我们改"） */
export function renderProduct(baseText, merged) {
  return JSON.stringify(merged, null, detectIndent(baseText)) + (baseText.endsWith('\n') ? '\n' : '');
}

function copyTree(src, dst, fsImpl = fs) {
  fsImpl.mkdirSync(dst, { recursive: true });
  for (const e of fsImpl.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d, fsImpl); else fsImpl.copyFileSync(s, d);
  }
}

export function main(argv = process.argv.slice(2)) {
  const fork = argv.find((a) => a.startsWith('--fork='))?.slice(7)
    || process.env.VERILOG_STUDIO_FORK || DEFAULT_FORK;
  if (!pathLooksBuildable(fork)) {
    process.stderr.write([
      `基座路径含空格，上游的 preinstall 会死在第一颗空格上（实测：'D:\Visual' is not recognized as ...）：`,
      `  ${fork}`,
      '换一份无空格的位置，例如：',
      `  git clone --depth 1 --filter=blob:none https://github.com/microsoft/vscode.git D:\\vv-studio\\vscode`,
      `  pnpm studio:brand --fork=D:\\vv-studio\\vscode`,
      '',
    ].join('\n'));
    return 4;
  }
  const productPath = path.join(fork, 'product.json');
  if (!fs.existsSync(productPath)) {
    process.stderr.write([
      `找不到基座 product.json：${productPath}`,
      '先把 Code - OSS 的 checkout 放到那个位置（默认在仓库外面）：',
      `  git clone --depth 1 https://github.com/microsoft/vscode.git "${DEFAULT_FORK}"`,
      '或者指给我：pnpm studio:brand --fork=<基座路径>',
      '',
    ].join('\n'));
    return 2;
  }
  const base = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(STUDIO_DIR, 'product.overrides.json'), 'utf8'));
  const merged = mergeProduct(base, overrides);
  const bad = verifyProduct(merged, overrides);
  if (bad.length) { process.stderr.write(`合并后这几颗键没落到位置：${bad.join(', ')}\n`); return 1; }
  // 先读回原文只为拿它的缩进：⛔ 把我们自己的排版盖到上游文件上（那样一次改 17 颗键的 diff 会胖成整档重排）
  fs.writeFileSync(productPath, renderProduct(fs.readFileSync(productPath, 'utf8'), merged));
  process.stdout.write(`product.json 已覆盖 ${Object.keys(overrides).filter((k) => k !== '_comment').length} 颗键 → ${productPath}\n`);

  const extSrc = path.join(REPO_ROOT, 'extension');
  const info = builtinExtFiles(extSrc);
  if (info.missing.length) {
    process.stderr.write([
      `扩展侧缺这些产物，先编再装：${info.missing.join(', ')}`,
      '  pnpm -C extension build && pnpm build && pnpm -C extension webview:sync',
      '',
    ].join('\n'));
    return 3;
  }
  const dst = path.join(fork, 'extensions', BUILTIN_EXT_ID);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.join(dst, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(extSrc, 'package.json'), path.join(dst, 'package.json'));
  fs.copyFileSync(path.join(extSrc, 'dist', 'extension.cjs'), path.join(dst, 'dist', 'extension.cjs'));
  copyTree(path.join(extSrc, 'webview'), path.join(dst, 'webview'));
  // 内置扩展⛔ 有 devDependencies，也⛔ 走 vsce：基座的 gulp 会把 extensions/** 直接打进产物
  process.stdout.write(`内置扩展已装到 ${dst}（webview 产物 ${info.hasWebview ? '在' : '⚠ 缺 index.html'}）\n`);
  process.stdout.write('下一步见 studio/README.md §3 片 2（基座安装与编译，要先装 node 24.18.0）\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
