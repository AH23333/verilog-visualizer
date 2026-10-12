// 编译画布的 Subcircuit 命中探测 —— 从 Canvas.tsx 抽出（卷三十六 瘦身浅刀 1b）。
//
// 为什么不靠 elementFromPoint：连线（link）常与器件重叠且会赢下命中测试，
// 于是改为扫描**已渲染的 Subcircuit cell** 的包围盒取最小包含者（原注释随迁）。
//
// ⚠ W2 修复（卷一/卷四在册）：查询域从 document 级收窄到 **paper.el 内**——
// 主画布 + 展开模态 + 沙盒同 DOM 树时，document.querySelectorAll('[model-id]')
// 会命中别的 paper 的元素，钻取判定指错靶。
export interface SubcircuitProbeHit { celltype: string; label: string; drillable: boolean }

export function probeSubcircuitAt(paper: any, subs: Record<string, any>, clientX: number, clientY: number): SubcircuitProbeHit | null {
  if (!paper) return null;
  const scope: ParentNode = paper.el || paper.$el?.[0] || null;
  if (!scope) return null;
  const nodes = Array.from(scope.querySelectorAll('[model-id]'));
  let best: { celltype: string; label: string; drillable: boolean; area: number } | null = null;
  for (const el of nodes) {
    const id = el.getAttribute('model-id');
    if (!id) continue;
    const model = paper.model?.getCell?.(id);
    if (!model || model.get('type') !== 'Subcircuit') continue;
    const celltype = String(model.get('celltype') || '');
    const label = String(model.get('label') || '');
    const drillable = !!celltype && !!subs[celltype];
    if (!drillable) continue;
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const area = r.width * r.height;
      if (!best || area < best.area) best = { celltype, label, drillable, area };
    }
  }
  return best ? { celltype: best.celltype, label: best.label, drillable: best.drillable } : null;
}
