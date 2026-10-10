// 沙盒电路导出工具：把 JointJS paper 序列化为自包含 SVG（含白底、按内容自适应取景）。
// 供 SandboxCanvas 的「导出 SVG」按钮复用，并暴露给 QC 验收（window.__sandboxExport）
// 做非空校验。
//
// 落盘走 exportUtils.saveExport（Tauri 原生保存对话框 / 浏览器回退 <a download>），
// 与编译模式共用同一条导出通道（B4：消除双轨）。

import { saveExport } from '../lib/exportUtils';

function getSvgEl(paper: any): SVGElement | null {
  if (!paper) return null;
  const maybe = (paper as any).svg;
  const el = typeof maybe === 'function' ? maybe.call(paper) : maybe;
  return (el as SVGElement) ?? null;
}

// 构建自包含 SVG 字符串：白底 + 按模型包围盒取景（去掉视口平移/缩放变换，
// 使模型坐标直接映射到 SVG 用户坐标，viewBox 框住全部 cell）。
export function buildSvgString(paper: any, fit = true): string {
  const svgEl = getSvgEl(paper);
  if (!svgEl) return '';
  const clone = svgEl.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // 移除 foreignObject（多位 Input 的 valinput 等 HTML 交互控件）：含 foreignObject 的
  // SVG 绘入 canvas 会把画布标记为 tainted，后续 toBlob/toDataURL 直接抛 SecurityError，
  // PNG 导出静默失败。交互控件本就不属于导出图形，移除即可。
  clone.querySelectorAll('foreignObject').forEach((f) => f.remove());

  // 白底矩形（放在最底层，保证导出为非透明、可在白底文档中直接粘贴）
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  if (fit) {
    try {
      const bbox = (paper as any).model.getBBox();
      const pad = 20;
      const x = bbox.x - pad;
      const y = bbox.y - pad;
      const w = Math.max(1, bbox.width + 2 * pad);
      const h = Math.max(1, bbox.height + 2 * pad);
      // 仅移除「视口层」(svg 的直接 <g> 子节点，由 paper.translate/scale 施加) 的变换，
      // 不影响各 cell 自身的 translate（cell <g> 是视口层的后代，非 svg 直接子节点）。
      clone.querySelectorAll(':scope > g').forEach((g) => g.removeAttribute('transform'));
      clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      clone.setAttribute('width', String(Math.round(w)));
      clone.setAttribute('height', String(Math.round(h)));
    } catch {
      /* getBBox 失败则退回当前视口 */
    }
  }

  // 序列化时展开 xlink 命名空间，避免箭头 marker 等引用失效
  return new XMLSerializer().serializeToString(clone);
}

export async function exportSvg(paper: any, filename = 'circuit.svg'): Promise<boolean> {
  const svgString = buildSvgString(paper, true);
  if (!svgString) return false;
  return saveExport(new TextEncoder().encode(svgString), filename, 'image/svg+xml;charset=utf-8');
}

export function exportSvgString(paper: any): string {
  return buildSvgString(paper, true);
}
