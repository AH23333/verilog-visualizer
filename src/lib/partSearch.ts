// 部件搜索共享总线（用户裁决：Ctrl+F 按焦点分流 —— 画布聚焦时打开「部件搜索」，编辑器聚焦时仍走查找）
//
// 编译模式与沙盒共用同一颗「部件搜索」弹窗（App 层的 PartSearchDialog）：
// 谁在台上，谁就把自己的 paper 的搜素/定位能力注册进这个总线；弹窗只跟总线讲话，
// 不关心当前是哪个模式。画布卸载时必须同源注销（identity 比对），
// 否则弹窗会去搜一颗已经销毁的 paper（r87 那一族"挂着旧引用"的教训）。

export interface PartHit {
  /** joint cell id（joint 的 UUID，不是 digitaljs 的 id 属性） */
  id: string;
  /** 显示名：label（没有 label 时回落 celltype / type） */
  label: string;
  /** cell 的 joint type（如 Subcircuit / And / Input / Mux…） */
  type: string;
  /** Subcircuit 的 celltype（绑定的部件名）；其它器件无 */
  celltype?: string;
  /** 实例所在 net（走线 cell 之外可能有 net 属性） */
  net?: string;
}

export interface PartSearchSource {
  /** 搜画布上全部非走线 cell：label / type / celltype / net 任一子串命中即算；空串返回全部（截前 100） */
  list(query: string): PartHit[];
  /** 定位（居中）并高亮；返回 false 表示那颗已经不在了 */
  locate(id: string): boolean;
}

let current: PartSearchSource | null = null;

export const partSearchRegistry = {
  register(s: PartSearchSource) { current = s; },
  unregister(s: PartSearchSource) { if (current === s) current = null; },
  get() { return current as PartSearchSource | null; },
};

/** 把 paper 非走线 cell 转成 PartHit，并只保留命中查询的（空查询返回全部，截前 100） */
export function collectPartHits(cells: any[], query: string): PartHit[] {
  const t = query.trim().toLowerCase();
  const out: PartHit[] = [];
  for (const c of cells || []) {
    if (typeof c.isLink === 'function' && c.isLink()) continue;
    const label = String(c.get?.('label') ?? '').trim();
    const type = String(c.get?.('type') ?? '');
    const celltype = String(c.get?.('celltype') ?? '') || undefined;
    const net = String(c.get?.('net') ?? '') || undefined;
    if (!label && !celltype && !type) continue; // 没有任何可呈现身份的 cell 不出现
    if (t && !label.toLowerCase().includes(t) && !type.toLowerCase().includes(t)
      && !(celltype || '').toLowerCase().includes(t) && !(net || '').toLowerCase().includes(t)) continue;
    out.push({ id: String(c.id), label: label || celltype || type, type, celltype, net });
    if (out.length >= 100) break;
  }
  return out;
}