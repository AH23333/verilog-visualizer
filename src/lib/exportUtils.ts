// Export utilities for circuit diagrams and Verilog code

import { invoke } from '@tauri-apps/api/core';

/**
 * Export the DigitalJS circuit as SVG
 */
export async function exportSVG(canvasContainer: HTMLElement | null, fileName: string): Promise<boolean> {
  if (!canvasContainer) return false;
  const svg = canvasContainer.querySelector('svg');
  if (!svg) return false;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const width = svg.getAttribute('width') || '800';
  const height = svg.getAttribute('height') || '600';
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const path = await invoke<string | null>('save_export_file', {
    content: Array.from(new TextEncoder().encode(svgStr)),
    defaultName: `${fileName}_circuit.svg`,
  });
  return path !== null;
}

/**
 * Export the DigitalJS circuit as PNG
 */
export async function exportPNG(canvasContainer: HTMLElement | null, fileName: string): Promise<boolean> {
  if (!canvasContainer) return false;
  const svg = canvasContainer.querySelector('svg');
  if (!svg) return false;

  const svgRect = svg.getBoundingClientRect();
  const width = svgRect.width || 800;
  const height = svgRect.height || 600;

  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.scale(2, 2);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const arrayBuf = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        const path = await invoke<string | null>('save_export_file', {
          content: Array.from(bytes),
          defaultName: `${fileName}_circuit.png`,
        });
        resolve(path !== null);
      } else {
        resolve(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

/**
 * Export circuit JSON data
 */
export async function exportCircuitJSON(circuitJson: Record<string, unknown> | null, fileName: string): Promise<boolean> {
  if (!circuitJson) return false;
  const jsonStr = JSON.stringify(circuitJson, null, 2);
  const path = await invoke<string | null>('save_export_file', {
    content: Array.from(new TextEncoder().encode(jsonStr)),
    defaultName: `${fileName}_circuit.json`,
  });
  return path !== null;
}

/**
 * Export Verilog source code
 */
export async function exportVerilogCode(code: string, fileName: string): Promise<boolean> {
  if (!code) return false;
  const baseName = fileName.replace(/\.(v|sv|vh)$/, '');
  const path = await invoke<string | null>('save_export_file', {
    content: Array.from(new TextEncoder().encode(code)),
    defaultName: `${baseName}.v`,
  });
  return path !== null;
}