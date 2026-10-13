// 沙盒电路导出：把 JointJS paper 序列化为**自包含 SVG**。
// 构建逻辑的唯一主人在 `lib/exportUtils.buildStandaloneSvg`（编译模式共用同一份：
// 内联计算样式、去交互层、底色跟随主题、按模型包围盒取景）——⛔ 在这里再拼一套。
// 供 SandboxCanvas 的「导出 SVG」按钮复用，并暴露给 QC 验收（window.__sandboxExport）做非空校验。
//
// 落盘走 exportUtils.saveExport（宿主"另存为"对话框 / 浏览器回退 <a download>），
// 与编译模式共用同一条导出通道（B4：消除双轨）。

import { saveExport, buildStandaloneSvg } from '../lib/exportUtils';

function getSvgEl(paper: any): SVGElement | null {
  if (!paper) return null;
  const maybe = (paper as any).svg;
  const el = typeof maybe === 'function' ? maybe.call(paper) : maybe;
  return (el as SVGElement) ?? null;
}

// 沙盒取景用 paper 的**模型包围盒**（模型坐标系，与构建器摘掉视口层变换后的内容同一空间）。
export function buildSvgString(paper: any, fit = true): string {
  const svgEl = getSvgEl(paper);
  if (!svgEl) return '';
  let box: { x: number, y: number, w: number, h: number } | null = null;
  if (fit) {
    try {
      const bb = paper?.model?.getBBox?.();
      if (bb && bb.width && bb.height) box = { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    } catch { /* 取不到就让构建器按视口层自己量 */ }
  }
  return buildStandaloneSvg(svgEl as SVGSVGElement, box);
}

export async function exportSvg(paper: any, filename = 'circuit.svg'): Promise<boolean> {
  const svgString = buildSvgString(paper, true);
  if (!svgString) return false;
  return saveExport(new TextEncoder().encode(svgString), filename, 'image/svg+xml;charset=utf-8');
}

export function exportSvgString(paper: any): string {
  return buildSvgString(paper, true);
}
