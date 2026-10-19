// i18n 闸门（设计正本＝docs/I18N_DESIGN.md §三）：
//  ① locale 归一 ② 插值与缺译回落 ③ 字典完备性（扫源码 t('…') 字面量 ↔ 英文表，双向无孤儿）
//  ④ manifest %key% ↔ package.nls.json/zh-cn 三向对账 ⑤ html.ts locale 注入 ⑥ 英文面无 CJK。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLocale, t, setLocaleForTest, initLocale, getLocale, SHARED_VOCAB } from '../../src/i18n';
import { EN as WEB_EN } from '../../src/i18n/en';
import { normalizeLocale as extNormalize, t as extT, setLocaleForTest as extSetLocale } from '../../extension/src/i18n';
import { EN as EXT_EN } from '../../extension/src/i18n.en';
import { rewriteWebviewHtml } from '../../extension/src/html';

const REPO = join(__dirname, '..', '..');
const CJK = /[\u4e00-\u9fa5\u3400-\u4dbf]/;

/** 剥注释（行注释/块注释；字符串体原样保留——字符串里的 // 不当注释，刀口与 vv-i18n 清点器同一把）。 */
function stripComments(s: string): string {
  let out = '', i = 0, st = 0, q = '';
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (st === 0) {
      if (c === '/' && n === '/') { st = 1; i += 2; continue; }
      if (c === '/' && n === '*') { st = 2; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; st = 3; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 1) { if (c === '\n') { st = 0; out += c; } i++; continue; }
    if (st === 2) { if (c === '*' && n === '/') { st = 0; i += 2; } else i++; continue; }
    if (st === 3) { if (c === '\\') { out += c + (n ?? ''); i += 2; continue; } out += c; if (c === q) st = 0; i++; continue; }
  }
  return out;
}

function* walkTs(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|dist|\.tmpbuild/.test(p)) yield* walkTs(p); }
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

/** 收集一个目录树里全部 t('…') 字面量键（\b 边界保证 split(/parseInt 等 ⛔ 误命中）。 */
function collectTLiterals(rootDir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of walkTs(rootDir)) {
    if (/[/\\]i18n[/\\]/.test(f) || /i18n\.en\.ts$/.test(f)) continue;   // 内核与表自身不算使用点
    const code = stripComments(readFileSync(f, 'utf8'));
    const re = /\bt\(\s*('(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*")/g;
    for (const m of code.matchAll(re)) {
      // 字面量按 JS 简单转义还原到运行时形状（\\n→换行、\\\\→\、\\"→"），与 EN 表的 TS 解析键同尺
      const key = m[1].slice(1, -1).replace(/\\(.)/g, (_, c: string) => (({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[c] ?? c));
      if (!found.has(key)) found.set(key, []);
      found.get(key)!.push(f.replace(REPO + '\\', ''));
    }
  }
  return found;
}

describe('i18n 内核：locale 归一（I18N_DESIGN §一）', () => {
  it('zh 系归 zh-CN；en*/ja/未知归 en；两侧同一把尺', () => {
    for (const norm of [normalizeLocale, extNormalize]) {
      expect(norm('zh-cn')).toBe('zh-CN');
      expect(norm('zh-CN')).toBe('zh-CN');
      expect(norm('zh-tw')).toBe('zh-CN');
      expect(norm('ZH')).toBe('zh-CN');
      expect(norm('en')).toBe('en');
      expect(norm('en-US')).toBe('en');
      expect(norm('ja')).toBe('en');
      expect(norm('')).toBe('en');
      expect(norm(undefined)).toBe('en');
      expect(norm(null)).toBe('en');
    }
  });
  it('webview initLocale：只认宿主 meta；无 meta（node 测试环境/dev 预览/闸门）→ zh-CN（I18N_DESIGN §一修订）', () => {
    setLocaleForTest('en');
    expect(getLocale()).toBe('en');
    // node 环境无 document → zh-CN。修订缘由（账本第十一节）：无头 Edge 闸门 navigator=en-US，
    // 回落 navigator 会把验收套件底下的 UI 整体翻面——语言⛔ 依赖跑测试的那台机器。
    expect(initLocale()).toBe('zh-CN');
  });

  it('三入口都挂了 initLocale（漏挂＝那颗入口永远读不到宿主语言，meta 注入形同虚设）', () => {
    for (const rel of ['src/canvas/main.tsx', 'src/doc/main.tsx', 'src/gates/main.tsx']) {
      expect(readFileSync(join(REPO, rel), 'utf8')).toContain('initLocale()');
    }
  });

  it('marker 复用串的两语一致性：en 译句必须包含 marker 译文（CanvasApp 检查 n.text.includes(t(未启动仿真))）', () => {
    expect(WEB_EN['未启动仿真']).toBeTruthy();
    expect(WEB_EN['电路存在悬空/成环的连线——未启动仿真。']).toContain(WEB_EN['未启动仿真']);
    expect('电路存在悬空/成环的连线——未启动仿真。').toContain('未启动仿真');   // zh 原文侧天然成立（对偶说明）
  });
});

describe('i18n 内核：t() 插值与缺译回落', () => {
  it('en 查表；{name} 插值；缺参保留占位；zh 回原文；缺译回落原文（产品永不空串）', () => {
    setLocaleForTest('en');
    expect(t('运行')).toBe('Run');
    expect(t('已把 {count} 个旧档落成工作区文件（重名的自动加了编号）。', { count: 3 }))
      .toBe('Migrated 3 legacy files into workspace files (duplicates got numbered suffixes).');
    expect(t('已复制到沙盒文件夹「{folder}/」：主电路 + {count} 个子部件，双击即可编辑。', { folder: 'top', count: 2 }))
      .toBe('Copied to sandbox folder "top/": main circuit + 2 subparts. Double-click to edit.');
    expect(t('已把 {count} 个', {})).toContain('{count}');                 // 缺参保留占位（如实，⛔ 静默吞）
    expect(t('这个键没进英文表^^')).toBe('这个键没进英文表^^');             // 缺译回落原文
    setLocaleForTest('zh-CN');
    expect(t('运行')).toBe('运行');                                        // zh 回原文
    expect(t('已把 {count} 个', { count: 7 })).toBe('已把 7 个');
  });
  it('扩展侧同内核同语义（独立字典）', () => {
    extSetLocale('en');
    expect(extT('扩展侧缺译回落^^')).toBe('扩展侧缺译回落^^');
    extSetLocale('zh-CN');
  });
});

describe('i18n 完备性闸：源码 t(…) 字面量 ↔ 英文表双向对齐', () => {
  it('前端：每个使用点都有英文项；英文表无孤儿键', () => {
    const used = collectTLiterals(join(REPO, 'src'));
    const missing = [...used.keys()].filter((k) => !(k in WEB_EN));
    expect(missing, `缺英文项（按 I18N_DESIGN §二必须补进 src/i18n/en.ts）：\n${missing.map((k) => `  ${k}  ← ${used.get(k)!.join(', ')}`).join('\n')}`).toEqual([]);
    const vocabMissing = [...SHARED_VOCAB].filter((k) => !(k in WEB_EN));
    expect(vocabMissing, '共享词表缺英文项：' + vocabMissing.join('；')).toEqual([]);
    const orphans = Object.keys(WEB_EN).filter((k) => !used.has(k) && !SHARED_VOCAB.has(k));   // 动态键（SHARED_VOCAB 登记制）免孤儿
    expect(orphans, `英文表孤儿键（表里有、代码没人用＝漂移，删掉或补使用点）：\n${orphans.join('\n')}`).toEqual([]);
  });
  it('扩展侧：使用点 ↔ 英文表双向对齐（当前 S1 尚未迁移扩展运行时串，两侧都应为空集）', () => {
    const used = collectTLiterals(join(REPO, 'extension', 'src'));
    const missing = [...used.keys()].filter((k) => !(k in EXT_EN));
    expect(missing, `缺英文项：\n${missing.map((k) => `  ${k}  ← ${used.get(k)!.join(', ')}`).join('\n')}`).toEqual([]);
    const orphans = Object.keys(EXT_EN).filter((k) => !used.has(k));
    expect(orphans, `英文表孤儿键：\n${orphans.join('\n')}`).toEqual([]);
  });
  it('英文面无 CJK（翻译表里漏翻的半成品当场红）', () => {
    const webBad = Object.entries(WEB_EN).filter(([, v]) => CJK.test(v)).map(([k]) => k);
    expect(webBad, `前端英文表含 CJK：\n${webBad.join('\n')}`).toEqual([]);
    const extBad = Object.entries(EXT_EN).filter(([, v]) => CJK.test(v)).map(([k]) => k);
    expect(extBad, `扩展英文表含 CJK：\n${extBad.join('\n')}`).toEqual([]);
  });
});

describe('manifest %key% ↔ nls 双语三向对账（漏 key＝真机裸 %key%，台架先红）', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'extension', 'package.json'), 'utf8')) as { [k: string]: unknown };
  const en = JSON.parse(readFileSync(join(REPO, 'extension', 'package.nls.json'), 'utf8')) as Record<string, string>;
  const zh = JSON.parse(readFileSync(join(REPO, 'extension', 'package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;
  const used = new Set<string>();
  (function walk(o: unknown) {
    if (typeof o === 'string') { for (const m of o.matchAll(/%([A-Za-z0-9_.]+)%/g)) used.add(m[1]); return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
  })(pkg);
  it('package.json 引用的 key 在两份 nls 里都在场', () => {
    const missEn = [...used].filter((k) => !(k in en));
    const missZh = [...used].filter((k) => !(k in zh));
    expect(missEn, 'package.nls.json 缺 key：' + missEn.join(', ')).toEqual([]);
    expect(missZh, 'package.nls.zh-cn.json 缺 key：' + missZh.join(', ')).toEqual([]);
  });
  it('nls 无孤儿 key（表里有、manifest 没引用＝漂移）', () => {
    const orphanEn = Object.keys(en).filter((k) => !used.has(k));
    const orphanZh = Object.keys(zh).filter((k) => !used.has(k));
    expect(orphanEn, 'package.nls.json 孤儿：' + orphanEn.join(', ')).toEqual([]);
    expect(orphanZh, 'package.nls.zh-cn.json 孤儿：' + orphanZh.join(', ')).toEqual([]);
  });
  it('en/zh 键集一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});

describe('html.ts locale 注入（I18N_DESIGN §一：CSP 下用 meta，⛔ 内联脚本）', () => {
  const raw = '<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <title>t</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';
  const run = (locale?: string) => rewriteWebviewHtml({
    rawHtml: raw, assetUri: (r) => 'u:' + r, cspSource: 'https://csp', nonce: 'NN', locale,
  });
  it('传 locale → <meta name="vv-locale"> 进 head 且 <html lang> 同步', () => {
    const out = run('en');
    expect(out).toContain('<meta name="vv-locale" content="en">');
    expect(/<html[^>]*lang="en"/.test(out)).toBe(true);
  });
  it('不传 locale → 不注 meta，lang 保持原文（存量行为不迁移也绿）', () => {
    const out = run();
    expect(out).not.toContain('vv-locale');
    expect(/<html[^>]*lang="zh-CN"/.test(out)).toBe(true);
  });
});
