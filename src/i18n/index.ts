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

/** 启动时读一次：**只认宿主注入的 meta**（I18N_DESIGN §一修订）。
 *  深度测试实却（账本第十一节）：无头 Edge 闸门环境下 navigator.language=en-US，若回落 navigator
 *  会把验收套件底下的 UI 整体翻面——语言⛔ 依赖「跑测试的那台机器」。无 meta＝未宿主化环境
 *  （pnpm dev 预览/闸门）→ zh-CN＝作者语缺省，闸门选择器（placeholder=自定义门名称 等）保持原语义。 */
export function initLocale(): Locale {
  const injected = typeof document !== 'undefined'
    ? document.querySelector('meta[name="vv-locale"]')?.getAttribute('content') : undefined;
  current = injected ? normalizeLocale(injected) : 'zh-CN';
  return current;
}

/** 翻译：zh-CN 回原文；en 查表，缺译回落原文（产品永不空串）。vars 用 {name} 插值。 */
export function t(msg: string, vars?: Record<string, string | number>): string {
  let out = current === 'en' ? (EN[msg] ?? msg) : msg;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}
