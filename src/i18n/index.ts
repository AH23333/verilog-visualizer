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

/**
 * 共享词表（动态键白名单，I18N_DESIGN §二）：这些键经 `t(变量)` 动态使用（如器件中文名
 * `CN_NAME[type]`），完备性闸扫不到字面量——显式登记后免孤儿检查，但闸照查「英文表必须有、译文无 CJK」。
 * ⛔ 借口动态使用绕闸：新动态键必须进这份名单，一份声明一处真相。
 */
export const SHARED_VOCAB: ReadonlySet<string> = new Set([
  // 器件中文名（CN_NAME 值；cellMenu toast 的 sgnName、侧栏/画布/放置菜单的显示点动态插值）
  '加法器', '减法器', '乘法器', '除法器', '取模', '幂运算', '取负', '正号器',
  '相等比较', '不等比较', '小于比较', '小于等于', '大于比较', '大于等于', '左移', '右移',
  '与门', '或门', '非门', '异或门', '与非门', '或非门', '同或门',
  '按钮', '时钟', '指示灯', '输入引脚', '输出引脚', '自定义门', 'D 触发器', '常量',
  '七段数码管', '数值显示', '数值输入', '多路选择器', '独热选择器', '稀疏选择器', '缓冲器',
  '合线器', '总线切片', '分线器', '零扩展', '符号扩展',
  '与归约', '或归约', '异或归约', '与非归约', '或非归约', '同或归约', '存储器 (RAM)', '状态机',
  // 调色板分组名（PALETTE.group）与沙盒侧栏面板标题（SANDBOX_PANEL_TITLE 值）
  '逻辑门', '输入 / 输出', '时序', '运算', '比较', '选择 / 移位', '总线', '存储', '显示',
  '文件', '部件', '层次结构', '侧栏', '寄存器 EN/RST',
  // 内置示例名（SandboxCanvas 插入示例 toast 动态插值）
  '半加器', '4 位二进制计数器', '数字钟（计数器 + 译码 + 数码管）',
  // 下拉选项标签（MemPorts/DffPorts 渲染点 t(动态)）与 CONTROLS name/desc
    '无时钟（组合读）', '时钟 ↑', '时钟 ↓', '无使能', '使能 高有效', '使能 低有效', '无', '高有效', '低有效',
    '置位 S', '清零 R', '异步装载',
    '边沿采样（不勾＝没有时钟，每次求值都把 D 直接送到 Q）', '不满足电平时保持原值', '立即生效，不等边沿',
    '只在有效边沿生效', '与数据同宽的逐位置位', '与数据同宽的逐位清零', '有效时把 AD 端口的值直接送到 Q',
]);
