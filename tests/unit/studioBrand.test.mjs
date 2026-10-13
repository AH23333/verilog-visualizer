// studio/apply-brand.mjs 的无头判据（R139 框架迁移第一片）。
// 判的是"合进基座"这件事的形状，⛔ 依赖真跑一次 gulp 打包：
//   ① 覆盖层只改我们声明的键，基座其余键**一颗都⛔ 丢**（那是最坏的下落——上游必需字段被抹掉，
//      症状出现在打包阶段而不是这里）；
//   ② 嵌套对象深合（extensionsGallery 只换 serviceUrl/itemUrl，⛔ 连基座其余字段一起盖掉）；
//   ③ 数组按**整体替换**（拼接会让同名清单变成两条，读的人分不清哪条生效）；
//   ④ `_comment` ⛔ 进产物；
//   ⑤ 合并后自检真能抓到"没落到位置"那种情况（⛔ 只看脚本退出码 0）。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeProduct, verifyProduct, builtinExtFiles, detectIndent, renderProduct, pathLooksBuildable, DEFAULT_FORK, VERIFY_KEYS } from '../../studio/apply-brand.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = path.resolve(HERE, '../../studio/product.overrides.json');

// 直接读基座那份 checkout（在仓库外，⛔ 进 git）——读不到就用一份小样本，并在断言标题里说明走的哪条
import * as fsSync from 'node:fs';
// 基座位置**跟模块里的 DEFAULT_FORK 走**：⛔ 在测试里另钉一份绝对路径。
// 这次就是被硬钉坑的：基座搬过一次家，那份路径查不到 ⇒ 这颗判据静默退回小样本，
// 把十个合法键全报成"我发明的字段"（红是红了，但红的⛔ 它想问的事）。
const FORK_PRODUCT = path.join(DEFAULT_FORK, 'product.json');
const BASE_SAMPLE = {
  nameShort: 'Code - OSS', nameLong: 'Code - OSS', applicationName: 'code-oss',
  dataFolderName: '.vscode-oss', urlProtocol: 'code-oss', enableTelemetry: false,
  extensionEnabledApiProposals: { 'ms-vscode.js-debug': ['foo'] },
  commit: 'abcdef', version: '1.96.0',
};
const base = fsSync.existsSync(FORK_PRODUCT) ? JSON.parse(fsSync.readFileSync(FORK_PRODUCT, 'utf8')) : BASE_SAMPLE;
const baseSource = fsSync.existsSync(FORK_PRODUCT) ? '基座 checkout 现读' : '小样本（基座⛔ 在本地）';
const overrides = JSON.parse(fsSync.readFileSync(OVERRIDES_PATH, 'utf8'));


describe('product.json 覆盖层合并', () => {
  it(`基座来源＝${baseSource}：除我们声明的键外，基座其余键一颗都⛔ 丢`, () => {
    const merged = mergeProduct(base, overrides);
    const dropped = Object.keys(base).filter((k) => !(k in merged));
    expect(dropped).toEqual([]);
    const changed = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(merged[k]));
    for (const k of changed) expect(Object.keys(overrides)).toContain(k);
  });

  it('嵌套对象深合：extensionsGallery 只换我声明的两颗，基座同名的其余字段留着', () => {
    const b = { extensionsGallery: { serviceUrl: 'OLD', itemUrl: 'OLD2', resourceVersionQueryParams: 'keepme' } };
    const merged = mergeProduct(b, { extensionsGallery: { serviceUrl: 'NEW' } });
    expect(merged.extensionsGallery).toEqual({ serviceUrl: 'NEW', itemUrl: 'OLD2', resourceVersionQueryParams: 'keepme' });
  });

  it('数组整体替换（⛔ 拼接）：拼出来的同名清单没人看得出哪条生效', () => {
    const b = { 'ms-a': ['x'] };
    const merged = mergeProduct(b, { 'ms-a': ['y'] });
    expect(merged['ms-a']).toEqual(['y']);
  });

  it('_comment ⛔ 进产物（那是给我们读的注释，落进 product.json 就是脏数据）', () => {
    const merged = mergeProduct({}, overrides);
    expect('_comment' in merged).toBe(false);
  });

  it('覆盖层里⛔ 出现基座读不到的键：每颗都要么基座本来有，要么是构建脚本确认读过的', () => {
    const buildReads = ['extensionsGallery', 'desktopName'];   // 现读：build/lib/builtInExtensions.ts·build/hygiene.ts·build/gulpfile.vscode.ts
    const invented = Object.keys(overrides).filter((k) => k !== '_comment' && !(k in base) && !buildReads.includes(k));
    expect(invented).toEqual([]);
  });

  it('自检真能红：把某颗关心键从覆盖层里拿掉，verifyProduct 要报出来（⛔ 只看退出码 0 就当合上了）', () => {
    const weak = { ...overrides, nameShort: 'NOT MERGED' };
    const merged = mergeProduct(base, weak);
    expect(verifyProduct(merged, overrides)).toContain('nameShort');
    expect(verifyProduct(merged, weak)).toEqual([]);   // 自己跟自己当然过——这颗防的是"漏合"⛔ 防自洽
  });

  it('关心键清单⛔ 是空的（VERIFY_KEYS 一旦退化成空数组，verifyProduct 就永远返回 []＝永远过）', () => {
    expect(VERIFY_KEYS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('内置扩展要落的那几颗文件', () => {
  const fakeFs = (have) => ({
    existsSync: (p) => have.some((h) => p.endsWith(h)),
  });

  it('缺 dist/extension.cjs 时要报出来（先编再装，⛔ 把源码目录整个塞进基座）', () => {
    const r = builtinExtFiles('/ext', fakeFs(['package.json']));
    expect(r.missing).toEqual([path.join('dist', 'extension.cjs')]);
  });

  it('webview/index.html 缺时给警告字段（装载⛔ 找到产物时扩展自己会显示那句话）', () => {
    const r = builtinExtFiles('/ext', fakeFs(['package.json', path.join('dist', 'extension.cjs')]));
    expect(r.missing).toEqual([]);
    expect(r.hasWebview).toBe(false);
    expect(r.outDirName).toBe('verilog-visualizer');
  });
});

describe('写回基座文件时保住它自己的排版', () => {
  // 这一组是被真实代价逼出来的：第一版按 2 空格重写 product.json，"只改 17 颗键"的覆盖
  // 在 git diff 里变成 253 增 / 248 删（全是缩进噪声，评审看不出到底改了哪颗）。修完是 21 增 / 16 删。
  const TAB = '{\n\t"nameShort": "Code - OSS",\n\t"commit": "abc"\n}\n';
  const SPACE2 = '{\n  "nameShort": "Code - OSS",\n  "commit": "abc"\n}\n';

  it('基座用制表符就还它制表符；用两空格就还两空格', () => {
    expect(detectIndent(TAB)).toBe('\t');
    expect(detectIndent(SPACE2)).toBe('  ');
  });

  it('渲染后除我们改的那颗键，行数与缩进都⛔ 动（成对判据：改前改后各数一遍）', () => {
    const out = renderProduct(TAB, mergeProduct(JSON.parse(TAB), { nameShort: 'Verilog Visualizer' }));
    expect(out.split('\n').length).toBe(TAB.split('\n').length);
    expect(out).toContain('\t"nameShort": "Verilog Visualizer",');
    expect(out).toContain('\t"commit": "abc"');       // 没被我们碰的键原样在原位
    expect(out.endsWith('\n')).toBe(true);            // 行尾跟着原文走（写成 CRLF 会整档漂）
  });

  it('原文不以换行结尾时⛔ 无端补一颗（那会多出一行"末尾换行"变更）', () => {
    expect(renderProduct('{\n\t"a": 1\n}', { a: 2 }).endsWith('\n')).toBe(false);
  });
});

describe('基座路径必须无空格（上游 preinstall 不加引号）', () => {
  // 实测：checkout 落在 "D:\Visual Studio Code\..." 下时，build/npm/preinstall.ts 的 installHeaders
  // spawn 出 `'D:\Visual' is not recognized as an internal or external command`，跑满四分钟才炸。
  it('含空格的路径判为不可编（宁可三秒内说清楚，⛔ 让人等一次长安装再失败）', () => {
    // ⚠ 一律用正斜杠：写成 'C:\\work' 会让 JS 把 \\w / \\v 当转义（\\v 真是一颗**垂直制表符**＝空白），
    // 那判的就不是"路径里有⛔ 有空格"了——这一版我就是这样先红了一次才发现。
    expect(pathLooksBuildable('D:/Visual Studio Code/Something/vv-studio/vscode')).toBe(false);
    expect(pathLooksBuildable('C:/work/vscode')).toBe(true);
  });

  it('默认值自己就得通过这道检查（⛔ 默认值把用户带进那个坑）', () => {
    expect(pathLooksBuildable(DEFAULT_FORK)).toBe(true);
  });
});
