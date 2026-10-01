// 沙盒电路导出工具：把 JointJS paper 序列化为自包含 SVG（含白底、按内容自适应取景），
// 再栅格化为 PNG（可配置分辨率）。供 SandboxCanvas 的「导出 PNG / 导出 SVG」按钮复用，
// 并暴露给 QC 验收（window.__sandboxExport）做像素级非空校验。

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

async function rasterize(
  svgString: string,
  width: number,
  height: number,
  scale = 2,
): Promise<{ blob: Blob; dataUrl: string }> {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('SVG 载入 Image 失败'));
      img.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 画布上下文');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b as Blob), 'image/png'));
    const dataUrl = canvas.toDataURL('image/png');
    return { blob, dataUrl };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readDims(svgString: string): { width: number; height: number } {
  const wm = svgString.match(/width="(\d+)"/);
  const hm = svgString.match(/height="(\d+)"/);
  const w = wm ? parseInt(wm[1], 10) : 800;
  const h = hm ? parseInt(hm[1], 10) : 600;
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

export async function exportSvg(paper: any, filename = 'circuit.svg') {
  const svgString = buildSvgString(paper, true);
  if (!svgString) return;
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

export async function exportPng(
  paper: any,
  filename = 'circuit.png',
  scale = 2,
): Promise<{ blob: Blob; dataUrl: string; width: number; height: number }> {
  const svgString = buildSvgString(paper, true);
  if (!svgString) throw new Error('无法构建 SVG');
  const { width, height } = readDims(svgString);
  const { blob, dataUrl } = await rasterize(svgString, width, height, scale);
  downloadBlob(blob, filename);
  return { blob, dataUrl, width, height };
}

// 供 QC 验收直接调用（不触发下载），返回 dataUrl 以便像素级校验
export async function exportPngDataUrl(paper: any, scale = 2): Promise<string> {
  const svgString = buildSvgString(paper, true);
  if (!svgString) return '';
  const { width, height } = readDims(svgString);
  const { dataUrl } = await rasterize(svgString, width, height, scale);
  return dataUrl;
}

export function exportSvgString(paper: any): string {
  return buildSvgString(paper, true);
}
