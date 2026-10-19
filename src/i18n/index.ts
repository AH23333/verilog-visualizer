// 前端 i18n 内核（设计正本＝docs/I18N_DESIGN.md §一/§二）：中文原文即键，英文表在 ./en.ts。
// 语言来源优先级：宿主注入的 <meta name="vv-locale">（html.ts 写入 vscode.env.language）→ navigator.language。
import { EN } from './en';

export type Locale = 'zh-CN' | 'en';

/** 归一（I18N_DESIGN §一）：zh 系 → zh-CN；其余（en 系、ja、空、未知）→ en（英文是国际缺省）。 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const s = String(raw ?? '').trim().toLowerCase();
  return s.startsWith('zh') ? 'zh-CN' : 'en';
}

let current: Locale = 'zh-CN';

export function getLocale(): Locale { return current; }

/** 台架/测试用：直接置位（⛔ 生产路径不调——语言由 initLocale 按宿主定，无应用内切换）。 */
export function setLocaleForTest(raw: string | null | undefined): Locale { current = normalizeLocale(raw); return current; }

/** 启动时读一次：宿主注入的 meta 优先，浏览器预览回落 navigator.language；两界都没有（测试环境）→ zh-CN＝存量行为。 */
export function initLocale(): Locale {
  const injected = typeof document !== 'undefined'
    ? document.querySelector('meta[name="vv-locale"]')?.getAttribute('content') : undefined;
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  const raw = injected ?? nav;
  current = raw === undefined || raw === null || String(raw).trim() === '' ? 'zh-CN' : normalizeLocale(raw);
  return current;
}

/** 翻译：zh-CN 回原文；en 查表，缺译回落原文（产品永不空串）。vars 用 {name} 插值。 */
export function t(msg: string, vars?: Record<string, string | number>): string {
  let out = current === 'en' ? (EN[msg] ?? msg) : msg;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}
