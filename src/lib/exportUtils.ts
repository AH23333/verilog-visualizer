// Export utilities for circuit diagrams and Verilog code

import { invoke } from '@tauri-apps/api/core';

// Tauri 运行时探测：生产窗口里有 __TAURI_INTERNALS__，浏览器（dev / 无头 QC）没有。
// 每次调用现读（不是模块加载期求值），测试可在点击前注入桩来验证走的是原生保存路径。
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 统一导出落盘 —— 单一真源（消除编译模式「Tauri 原生对话框」与沙盒「<a download>」双轨）：
 *  - Tauri：`invoke('save_export_file')`，弹系统保存对话框；用户取消返回 false。
 *  - 浏览器（dev / 无头 QC）：回退 `<a download>`，让 r12/audit3/r26/r37 等下载类闸门仍可判。
 */
export async function saveExport(
  bytes: Uint8Array,
  defaultName: string,
  mime = 'application/octet-stream',
): Promise<boolean> {
  if (isTauri()) {
    try {
      const path = await invoke<string | null>('save_export_file', {
        content: Array.from(bytes),
        defaultName,
      });
      return path != null;
    } catch {
      return false;
    }
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// 编译模式 SVG 导出要做「深度重绘」，不能只是克隆 DOM 的 <svg>：
// digitaljs 用 CSS class（如 `.joint-element .body` 的 fill 等）着色，克隆后没有样式表，
// 导出的 SVG 打开就是一片纯黑矩形。逐元素把计算样式内联进 clone，再加白底 + 按内容取景。
const INLINE_STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit',
  'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'text-anchor', 'text-decoration', 'letter-spacing', 'word-spacing', 'paint-order',
];

/**
 * Export the DigitalJS circuit as SVG（深度重绘：内联样式 + 白底 + 内容自适应取景）。
 * 样式内联是逐元素对齐复制的：原 SVG 的第 n 个元素 ↔ 克隆的第 n 个元素（querySelectorAll 同为文档序）。
 */
export async function exportSVG(canvasContainer: HTMLElement | null, fileName: string): Promise<boolean> {
  if (!canvasContainer) return false;
  const svg = canvasContainer.querySelector('svg');
  if (!svg) return false;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // 逐元素内联计算样式（黑矩形根因：CSS class 不起效）
  const srcEls = svg.querySelectorAll('*');
  const dstEls = clone.querySelectorAll('*');
  for (let i = 0; i < srcEls.length && i < dstEls.length; i++) {
    const s = getComputedStyle(srcEls[i]);
    const d = dstEls[i] as SVGElement;
    for (const p of INLINE_STYLE_PROPS) {
      const v = (s as unknown as Record<string, string>)[p];
      if (v) { try { d.style.setProperty(p, v); } catch { /* 个别属性不接受则跳过 */ } }
    }
  }

  // 移除 foreignObject（交互控件不属于导出图形，且会让 PNG 栅格化 taint 画布）
  clone.querySelectorAll('foreignObject').forEach((f) => f.remove());
  // 移除「视口层」(svg 直接 <g> 子节点) 的变换，模型坐标直接对应 SVG 用户坐标
  clone.querySelectorAll(':scope > g').forEach((g) => g.removeAttribute('transform'));

  // 白底矩形（放在最底层，导出为非透明、可直接粘贴进白底文档）
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  // 按内容包围盒取景
  try {
    const bb = svg.getBBox();
    const pad = 20;
    const x = bb.x - pad, y = bb.y - pad;
    const w = Math.max(1, bb.width + 2 * pad), h = Math.max(1, bb.height + 2 * pad);
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    clone.setAttribute('width', String(Math.round(w)));
    clone.setAttribute('height', String(Math.round(h)));
  } catch {
    clone.setAttribute('width', '800');
    clone.setAttribute('height', '600');
  }

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  return saveExport(new TextEncoder().encode(svgStr), `${fileName}_circuit.svg`, 'image/svg+xml;charset=utf-8');
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