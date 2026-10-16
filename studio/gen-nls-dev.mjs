/**
 * dev 语言包通道（本仓库 fork 的 vs/nls.ts keymap 机制）的数据合成脚本：
 *   out/nls.keys.json（bundle --nls 产物：[[moduleId, [key...]], ...]）
 *   + 语言包扩展的 translations/main.<lang>.i18n.json（{contents: {moduleId: {key: 译文}}})
 *   ⇒ out/vscode-nls-dev-zh.json（key → 译文 扁平表，bootstrap-esm 注入 main，窗口配置带给渲染层）。
 *
 * 为什么在构建期合成：main 进程运行时只该读一张现成的表（⛔ 每次启动遍历 2019 个模块）。
 * 重跑时机：内核源码增删了 localize 调用（重跑 `npx tsx build/next/index.ts bundle --nls`）或换语言包。
 *
 * 用法：node studio/gen-nls-dev.mjs [--fork=D:/vv-studio/vscode]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const fork = process.argv.find((a) => a.startsWith('--fork='))?.slice(7) || process.env.VERILOG_STUDIO_FORK || 'D:/vv-studio/vscode';
const packPath = path.join(fork, 'extensions', 'ms-ceintl.vscode-language-pack-zh-hans', 'translations', 'main.i18n.json');
const keysPath = path.join(fork, 'out-vscode', 'nls.keys.json');
// ⚠ 落点 = fork 根 `.nls-dev/`（⛔ out/——build-fast 增量重建会清整个 out/，真机实测被吞过）。
//   resolveNLSConfiguration（vs/base/node/nls.ts）与 bootstrap-esm 都认这个目录。
const devDir = path.join(fork, '.nls-dev');
const outPath = path.join(devDir, 'vscode-nls-dev-zh.json');

if (!fs.existsSync(packPath)) {
  console.error(`找不到语言包翻译表：${packPath}\n先装 zh-hans 语言包进基座 extensions/。`);
  process.exit(2);
}
if (!fs.existsSync(keysPath)) {
  console.error(`找不到内核 NLS key 清单：${keysPath}\n先跑：npx tsx build/next/index.ts bundle --nls --out out-vscode`);
  process.exit(3);
}

const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const keyTables = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
if (!pack?.contents) { console.error('语言包 main.i18n.json 缺 contents 字段'); process.exit(4); }

const keymap = Object.create(null);
let hits = 0, misses = 0;
for (const [moduleId, keys] of keyTables) {
  const translations = pack.contents[moduleId];
  if (!translations) { misses += keys.length; continue; }
  for (const key of keys) {
    const value = translations[key];
    if (typeof value === 'string' && value.length > 0) { keymap[key] = value; hits++; }
    else misses++;
  }
}

fs.mkdirSync(devDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(keymap), 'utf8');
// resolveNLSConfiguration 生成语言包缓存还需要 keys（对序）+ messages（英文兜底）——一并放 .nls-dev/
fs.copyFileSync(path.join(fork, 'out-vscode', 'nls.keys.json'), path.join(devDir, 'nls.keys.json'));
fs.copyFileSync(path.join(fork, 'out-vscode', 'nls.messages.json'), path.join(devDir, 'nls.messages.json'));
console.log(`keymap 已生成 → ${outPath}`);
console.log(`命中 ${hits} 条，无译文回落英文 ${misses} 条（内核新增消息或语言包未跟上属正常）`);
