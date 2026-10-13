// Export utilities for circuit diagrams and Verilog code

import { getHost, hostId } from './host/host';

// Tauri 运行时探测挪到 `lib/host/host.ts`（⛔ 让探测长回某个具体文件里，换宿主又得挨处找）。
// 每次调用现读（不是模块加载期求值），测试可在点击前注入桩来验证走的是原生保存路径。
export const isTauri = (): boolean => hostId() === 'tauri';

/**
 * 统一导出落盘 —— 单一真源（消除编译模式「Tauri 原生对话框」与沙盒「<a download>」双轨）：
 *  - Tauri：`invoke('save_export_file')`，弹系统保存对话框；用户取消返回 false。
 *  - VS Code Webview：经 Extension Host 的"另存为"（`lib/host/vscodeHost.ts`）。
 *  - 浏览器（dev / 无头 QC）：回退 `<a download>`，让 r12/audit3/r26/r37 等下载类闸门仍可判。
 */
export async function saveExport(
  bytes: Uint8Array,
  defaultName: string,
  mime = 'application/octet-stream',
): Promise<boolean> {
  try {
    return await (await getHost()).saveExportFile(bytes, defaultName, mime);
  } catch {
    return false;
  }
}

// 编译模式与沙盒共用这一份「自包含 SVG」构建器（唯一主人，⛔ 两处各写一套）。
// digitaljs/joint 的颜色与字号大量来自 CSS（`[data-theme=dark] .joint-paper [class*="body"]{fill:#232830!important}`
// 那族），克隆出来的 <svg> 脱离本仓样式表打开就一片默认黑 ⇒ 逐元素把**计算样式**内联进 clone。
// 另两条与"打开就能看"直接相关的形状：
//  · 底色跟随主题（⛔ 写死 #ffffff）：深色主题下器件填充本就是近黑的 #232830，
//    再配白底就成了用户报的"部件全为纯黑色矩形"，而且浅色文字（#e4e4ec）压在白底上根本看不见。
//  · 取景坐标系与变换一致：构建时会摘掉「视口层」(<svg> 的直接 <g>) 的 translate/scale，
//    所以包围盒必须取**同一层自己的** getBBox()（不含它自身变换＝模型坐标）。
//    早先编译模式拿 `svg.getBBox()`（含视口平移）去框摘掉平移的内容 ⇒ 整张图被挪出画面。
const INLINE_STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'text-anchor', 'text-decoration', 'letter-spacing', 'word-spacing', 'paint-order',
  // 箭头（marker-*）与可见性：漏了它们导出就"少画东西"——连线端点的箭头是 marker 画的，
  // 隐藏态（如 joint 的工具层）也必须按屏幕上的"不显示"带走，否则文件里冒出编辑手柄。
  'marker-start', 'marker-mid', 'marker-end', 'visibility', 'display', 'color',
  'dominant-baseline', 'baseline-shift',
];

const isTransparent = (c: string) => !c || c === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c);

/** 导出底色＝屏幕上那张画布的颜色（容器链上第一颗不透明的背景色，退回主题令牌 --canvas-bg）。 */
function exportBackground(svgEl: Element): string {
  for (let el: Element | null = svgEl.parentElement; el; el = el.parentElement) {
    try {
      const c = getComputedStyle(el as HTMLElement).backgroundColor;
      if (!isTransparent(c)) return c;
    } catch { /* 脱离文档的节点读不到，继续往上 */ }
  }
  try {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
    if (token) return token;
  } catch { /* ignore */ }
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#0d0d13' : '#ffffff';
}

/**
 * 找容器里「电路图那棵 svg」。
 * ⚠ ⛔ `querySelector('svg')`：编译模式的容器在 <Canvas> **之前**还挂着输入面板浮层与
 *   面包屑（App.tsx:1422/1438 的 `<ArrowLeft size={14}/>` 等 lucide 图标）——第一颗 svg 是
 *   一枚 24×19 的图标，导出的"电路图"就是它（用户报的"部件全为纯黑色矩形"其中一种下落）。
 */
export function pickPaperSvg(root: Element | null): SVGSVGElement | null {
  if (!root) return null;
  const inPaper = root.querySelector('.joint-paper svg') || root.querySelector('svg.joint-js-sv') || root.querySelector('[joint-selector="svg"]');
  if (inPaper) return inPaper as SVGSVGElement;
  // 退化路径：取面积最大的一颗（图标恒十几~几十 px，电路图必然远大于它）
  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  for (const s of Array.from(root.querySelectorAll('svg'))) {
    const b = (s as SVGSVGElement).getBoundingClientRect();
    const area = b.width * b.height;
    if (area > bestArea) { bestArea = area; best = s as SVGSVGElement; }
  }
  return best;
}

/**
 * 摘掉视口层变换后的内容包围盒＝**视口层自己的 getBBox()**（规范上不含它自身的 transform，
 * 也就是模型坐标）。多个直接 <g> 子层（cells/tools/defs 派生层）取并集。
 */
function modelContentBox(svgEl: SVGSVGElement): { x: number, y: number, w: number, h: number } | null {
  const layers = Array.from(svgEl.children).filter((el) => el.tagName.toLowerCase() === 'g');
  let box: { x: number, y: number, w: number, h: number } | null = null;
  for (const g of layers) {
    let b: DOMRect;
    try { b = (g as unknown as SVGGraphicsElement).getBBox(); } catch { continue; }
    if (!b.width || !b.height) continue;
    if (!box) box = { x: b.x, y: b.y, w: b.width, h: b.height };
    else {
      const x2 = Math.max(box.x + box.w, b.x + b.width), y2 = Math.max(box.y + box.h, b.y + b.height);
      box.x = Math.min(box.x, b.x); box.y = Math.min(box.y, b.y);
      box.w = x2 - box.x; box.h = y2 - box.y;
    }
  }
  return box;
}

/** 构建自包含 SVG 字符串（两个模式唯一主人）：内联样式 → 去交互层 → 摘视口变换 → 主题底色 → 取景。 */
export function buildStandaloneSvg(svgEl: SVGSVGElement, box?: { x: number, y: number, w: number, h: number } | null): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // 屏幕上的位置来自容器的 CSS（position:absolute/inset 等），文件里这些是噪声
  clone.removeAttribute('style');
  clone.removeAttribute('id');

  // 逐元素内联计算样式：原 SVG 的第 n 个元素 ↔ 克隆的第 n 个（querySelectorAll 同为文档序）
  const srcEls = svgEl.querySelectorAll('*');
  const dstEls = clone.querySelectorAll('*');
  for (let i = 0; i < srcEls.length && i < dstEls.length; i++) {
    const s = getComputedStyle(srcEls[i]);
    const d = dstEls[i] as SVGElement;
    for (const p of INLINE_STYLE_PROPS) {
      const v = (s as unknown as Record<string, string>)[p];
      // ⛔ 别把 <style> 元素自己也刷上一层样式（第一版这么干过，文件里冒出 style[style=...]）
      if (v && d.tagName.toLowerCase() !== 'style') { try { d.style.setProperty(p, v); } catch { /* 个别属性不接受则跳过 */ } }
    }
  }

  // 交互 HTML 层不属于导出图形（含 foreignObject 的 SVG 也不能喂给 <img> 栅格化）
  clone.querySelectorAll('foreignObject').forEach((f) => f.remove());
  // joint 的编辑工具/手柄层在导出里是杂物（屏幕上靠 CSS 隐藏，内联后照样带过来）
  clone.querySelectorAll('.joint-tools, .joint-fork, [joint-selector="tools"]').forEach((el) => el.remove());
  // 摘掉视口层平移/缩放 ⇒ 模型坐标直接对应 SVG 用户坐标（与 modelContentBox 同一坐标系）
  Array.from(clone.children).filter((el) => el.tagName.toLowerCase() === 'g')
    .forEach((g) => g.removeAttribute('transform'));

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
  bg.setAttribute('fill', exportBackground(svgEl));   // ⛔ 写死 #ffffff：深色主题下＝黑块压白底
  clone.insertBefore(bg, clone.firstChild);

  const pad = 20;
  const b = box && box.w > 0 && box.h > 0 ? box : modelContentBox(svgEl);
  if (b && b.w > 0 && b.h > 0) {
    const x = b.x - pad, y = b.y - pad;
    const w = Math.max(1, b.w + 2 * pad), h = Math.max(1, b.h + 2 * pad);
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    clone.setAttribute('width', String(Math.round(w)));
    clone.setAttribute('height', String(Math.round(h)));
  }
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Export the DigitalJS circuit as SVG（走 buildStandaloneSvg；⛔ 自己再拼一份）。
 * 找不到电路图那棵 svg 时返回 false，由调用方给"画布上没有电路"的反馈（不静默产出废文件）。
 */
export async function exportSVG(canvasContainer: HTMLElement | null, fileName: string): Promise<boolean> {
  if (!canvasContainer) return false;
  const svg = pickPaperSvg(canvasContainer);
  if (!svg) return false;
  return saveExport(new TextEncoder().encode(buildStandaloneSvg(svg)), `${fileName}_circuit.svg`, 'image/svg+xml;charset=utf-8');
}

/**
 * Export circuit JSON data
 */
export async function exportCircuitJSON(circuitJson: Record<string, unknown> | null, fileName: string): Promise<boolean> {
  if (!circuitJson) return false;
  const jsonStr = JSON.stringify(circuitJson, null, 2);
  return saveExport(new TextEncoder().encode(jsonStr), `${fileName}_circuit.json`, 'application/json');
}

/**
 * Export Verilog source code
 */
export async function exportVerilogCode(code: string, fileName: string): Promise<boolean> {
  if (!code) return false;
  const baseName = fileName.replace(/\.(v|sv|vh)$/, '');
  return saveExport(new TextEncoder().encode(code), `${baseName}.v`, 'text/plain;charset=utf-8');
}

/**
 * Export the synthesized gate-level netlist produced by Yosys `write_verilog`
 */
export async function exportNetlistVerilog(netlist: string | null | undefined, fileName: string): Promise<boolean> {
  if (!netlist) return false;
  const baseName = fileName.replace(/\.(v|sv|vh)$/, '');
  return saveExport(new TextEncoder().encode(netlist), `${baseName}_netlist.v`, 'text/plain;charset=utf-8');
}