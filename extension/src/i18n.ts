// 扩展侧 i18n 内核（设计正本＝docs/I18N_DESIGN.md §二）：
// 中文原文即键（message-as-key），英文表在 ./i18n.en.ts；语言跟随宿主 vscode.env.language。
// ⛔ 应用内语言切换 UI——跟随 VS Code 显示语言是唯一口径（宿主自带切换入口）。
import * as vscode from 'vscode';
import { EN } from './i18n.en';

export type Locale = 'zh-CN' | 'en';

/** 归一（I18N_DESIGN §一）：zh 系 → zh-CN；其余（en 系、ja、空、未知）→ en（英文是国际缺省）。 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const s = String(raw ?? '').trim().toLowerCase();
  return s.startsWith('zh') ? 'zh-CN' : 'en';
}

let cached: Locale | undefined;

/** 宿主语言（懒读一次并缓存；VS Code 会话内显示语言不变）。
 *  宿主语言未知（测试桩无 env、异常宿主）→ 回落 zh-CN＝存量行为，真宿主恒有 env.language。 */
export function getLocale(): Locale {
  if (!cached) {
    const raw = (vscode as { env?: { language?: string } }).env?.language;
    cached = raw === undefined || raw === null || String(raw).trim() === '' ? 'zh-CN' : normalizeLocale(raw);
  }
  return cached;
}

/** 台架/测试用：清缓存并置位（⛔ 生产路径不调——语言跟随宿主，无运行时切换）。 */
export function setLocaleForTest(raw: string | null | undefined): Locale {
  cached = normalizeLocale(raw);
  return cached;
}

/** 翻译：zh-CN 回原文；en 查表，缺译回落原文（产品永不空串，完备性由 i18n.test.ts 钉）。vars 用 {name} 插值。 */
export function t(msg: string, vars?: Record<string, string | number>): string {
  let out = getLocale() === 'en' ? (EN[msg] ?? msg) : msg;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** 固定语种渲染（I18N_DESIGN §二/§四 B 方案）：API_REFERENCE 文档生成器锁 en——生成物不随宿主语言漂移。 */
export function tIn(locale: Locale, msg: string, vars?: Record<string, string | number>): string {
  let out = locale === 'en' ? (EN[msg] ?? msg) : msg;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** schema 深走查：嵌套 description 字段逐个按语种翻译（注册表数据存中文，渲染层翻译）。
 *  ⛔ 只动 description——schema 其余部分是契约形状，动了就是另一个 API。 */
export function tSchemaIn<T>(locale: Locale, schema: T): T {
  const walk = (o: unknown): unknown => {
    if (typeof o === 'string') return o;
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      const r: Record<string, unknown> = {};
      for (const k of Object.keys(o as Record<string, unknown>)) {
        r[k] = k === 'description' && typeof (o as Record<string, unknown>)[k] === 'string'
          ? tIn(locale, (o as Record<string, string>)[k])
          : walk((o as Record<string, unknown>)[k]);
      }
      return r;
    }
    return o;
  };
  return walk(schema) as T;
}

/** 运行时语种的 schema 翻译（sys.listTools/describeTool 渲染用）。 */
export function tSchema<T>(schema: T): T { return tSchemaIn(getLocale(), schema); }
