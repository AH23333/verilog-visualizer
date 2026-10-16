// `.djs`（沙盒电路 `{cells:[...]}` 序列化快照）→ 结构化 Verilog 的**纯函数**转换器。
//
// 用途（R152 / M2）：编译闭包里某实例绑定到 `.djs` 部件时，把该部件电路转成一个 Verilog
// module 并注入闭包交给 yosys —— 使「部件（画布搭的电路）」能作为子模块参与 `.v` 编译。
//
// 设计要点：
//  · 纯字符串/数组处理，⛔ 依赖 joint/digitaljs/DOM（宿主 Node 侧跑）。
//  · 端口 = Input/Output 器件；端口名取器件 `net`（数字电学语义里 Subcircuit 端口 id 就是它）。
//  · net 合并用并查集：一条连线把 source/target 两个端口并入同一 net；IO 端口钉名、连线
//    netname 次之、兜底 net_N —— 与 src/utils/sandboxVerilog.ts 的电气语义同源（那边是
//    面向单画布 paper 的导出；这里是面向闭包的多部件转换，且**不支持＝硬报错**）。
//  · Subcircuit 器件 → 例化 `celltype`（其内部图给出端口名）；该子部件须在**它自己所在目录**
//    的绑定表里另录（closureOf 递归解析）。
//  · 不支持的器件（Memory/BusGroup/Splitter/Mux/...）⇒ 计入 errors（用户裁决：硬报错阻断）。

const GATE_MAP: Record<string, string> = {
  And: 'and', Or: 'or', Not: 'not', Xor: 'xor', Nand: 'nand', Nor: 'nor', Xnor: 'xnor',
};
const GATE_ARITY = (t: string): number => (t === 'Not' ? 1 : 2);

/** 有电气语义、转换器能处理的器件类型；Annotation 是纯注释盒（跳过，⛔ 算错）。 */
const SUPPORTED = new Set<string>([
  'Input', 'Output', 'Lamp',
  ...Object.keys(GATE_MAP),
  'Constant', 'Dff', 'Clock', 'Subcircuit',
]);
const IGNORED = new Set<string>(['Annotation']);

interface DjsCell {
  id?: string;
  type?: string;
  celltype?: string;
  net?: string;
  bits?: number;
  order?: number;
  label?: string;
  position?: { x?: number; y?: number };
  constant?: string;
  initial?: string;
  propagation?: number;
  isLink?: boolean;
  source?: { id?: string; port?: string };
  target?: { id?: string; port?: string };
  netname?: string;
  subcircuitGraph?: { cells?: DjsCell[] };
}

export interface DjsConvertResult {
  /** 转换出的 Verilog 源（无致命错误时可用） */
  verilog: string;
  /** 转换错误（非空＝该部件不能参与编译；closureOf 据此硬阻断） */
  errors: string[];
}

const ident = (raw: string | undefined): string => {
  let s = String(raw ?? '').trim().replace(/[^A-Za-z0-9_$]/g, '_');
  if (!s) s = 'net';
  if (/^[0-9]/.test(s)) s = `n_${s}`;
  return s;
};
const range = (bits: number): string => (bits > 1 ? `[${bits - 1}:0] ` : '');
const bitsOf = (c: DjsCell): number => (Number(c.bits) > 0 ? Number(c.bits) : 1);

/** 并查集：端口键 `id::port` → 组的代表键 */
class Union {
  private parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) { this.parent.set(k, k); return k; }
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = k;
    while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * 把一个 `.djs` 电路快照转成 Verilog module。
 * @param cells 已 JSON.parse 的 `cells` 数组
 * @param moduleName 目标模块名（＝实例的模块名 / celltype，yosys 按它链接）
 */
export function djsToVerilog(cells: DjsCell[] | undefined, moduleName: string): DjsConvertResult {
  const all = Array.isArray(cells) ? cells : [];
  const devices = all.filter((c) => c && !c.isLink && !IGNORED.has(String(c.type)));
  const links = all.filter((c) => c && c.isLink);
  const errors: string[] = [];

  for (const c of devices) {
    const t = String(c.type || '');
    if (!SUPPORTED.has(t)) errors.push(`部件「${moduleName}」含不支持参与编译的器件 ${t || '?'}（id=${String(c.id).slice(0, 8)}），请先在画布里替换或手工补全`);
  }

  const u = new Union();
  const keyOf = (id: string, port: string) => `${id}::${port}`;
  const netBitsByKey = new Map<string, number>();

  // IO 端口始终登记（未连线也要声明成端口）；其余器件端口仅在连线出现时登记。
  for (const c of devices) {
    if (!c.id) continue;
    if (c.type === 'Input') netBitsByKey.set(keyOf(String(c.id), 'out'), bitsOf(c));
    else if (c.type === 'Output') netBitsByKey.set(keyOf(String(c.id), 'in'), bitsOf(c));
  }
  for (const lk of links) {
    const s = lk.source, t = lk.target;
    if (s?.id && t?.id && s.port && t.port) u.union(keyOf(s.id, s.port), keyOf(t.id, t.port));
    const b = Number(lk.bits) > 0 ? Number(lk.bits) : 1;
    const bump = (id?: string, port?: string) => {
      if (!id || !port) return;
      const k = keyOf(id, port);
      netBitsByKey.set(k, Math.max(netBitsByKey.get(k) || 1, b));
    };
    bump(s?.id, s?.port); bump(t?.id, t?.port);
  }

  // 组名：IO 输入/输出优先钉名；连线 netname 次之；兜底 net_N
  const rootName = new Map<string, string>();
  const rootBits = new Map<string, number>();
  for (const [k, b] of netBitsByKey) {
    const r = u.find(k);
    rootBits.set(r, Math.max(rootBits.get(r) || 1, b));
  }
  const sortedIO = (arr: DjsCell[]) => [...arr].sort((a, b) =>
    ((Number(a.order) || 0) - (Number(b.order) || 0)) ||
    ((a.position?.y || 0) - (b.position?.y || 0)) ||
    ((a.position?.x || 0) - (b.position?.x || 0)));
  const orderedInputs = sortedIO(devices.filter((c) => c.type === 'Input'));
  const orderedOutputs = sortedIO(devices.filter((c) => c.type === 'Output'));
  const pinName = (c: DjsCell, fallback: string) => String(c.net || '').trim() || fallback;
  let autoIn = 0, autoOut = 0, autoNet = 0;
  const nameGroup = (c: DjsCell, port: string, nm: string) => {
    if (!c.id) return;
    const r = u.find(keyOf(String(c.id), port));
    if (!rootName.has(r)) rootName.set(r, ident(nm));
  };
  for (const c of orderedInputs) nameGroup(c, 'out', pinName(c, `in${++autoIn}`));
  for (const c of orderedOutputs) nameGroup(c, 'in', pinName(c, `out${++autoOut}`));
  for (const lk of links) {
    if (!lk.netname || !lk.source?.id || !lk.source.port) continue;
    const r = u.find(keyOf(lk.source.id, lk.source.port));
    if (!rootName.has(r)) rootName.set(r, ident(String(lk.netname)));
  }
  for (const r of rootBits.keys()) if (!rootName.has(r)) rootName.set(r, `net_${++autoNet}`);

  const netNameOfPort = (id: string | undefined, port: string): string | null => {
    if (!id) return null;
    const k = keyOf(id, port);
    if (!netBitsByKey.has(k)) return null;         // 该端口没有任何连线／未被识别
    return rootName.get(u.find(k)) || null;
  };

  // ---- 端口声明（ANSI）----
  const portDecls: string[] = [];
  const ioPortNames = new Set<string>();
  for (const c of orderedInputs) {
    const nm = netNameOfPort(c.id, 'out');
    if (!nm) continue;
    ioPortNames.add(nm);
    portDecls.push(`  input  ${range(bitsOf(c))}${nm}`);
  }
  for (const c of orderedOutputs) {
    const nm = netNameOfPort(c.id, 'in');
    if (!nm) continue;
    ioPortNames.add(nm);
    portDecls.push(`  output ${range(bitsOf(c))}${nm}`);
  }

  // ---- 内部 net 声明 ----
  const wireDecls: string[] = [];
  const declared = new Set<string>(ioPortNames);
  for (const [r, nm] of rootName) {
    if (declared.has(nm)) continue;
    declared.add(nm);
    wireDecls.push(`  wire ${range(rootBits.get(r) || 1)}${nm};`);
  }

  // ---- 器件体 ----
  const body: string[] = [];
  const inPortsOfGate = (id: string): string[] => {
    const ps = [...new Set(links.filter((l) => l.target?.id === id).map((l) => String(l.target!.port)))]
      .filter((p) => /^in\d*$/.test(p));
    ps.sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));
    return ps;
  };
  let gi = 0;
  for (const c of devices) {
    const t = String(c.type);
    const id = c.id;
    if (!id || t === 'Input' || t === 'Output' || t === 'Lamp') continue;

    const vOp = GATE_MAP[t];
    if (vOp) {
      const out = netNameOfPort(id, 'out');
      if (!out) continue;                                  // 无输出连线＝不驱动任何 net
      const ins = inPortsOfGate(id).map((p) => netNameOfPort(id, p) || "1'bx");
      while (ins.length < GATE_ARITY(t)) ins.push("1'bx");
      body.push(`  ${vOp} g${++gi} (${[out, ...ins].join(', ')});`);
      continue;
    }
    if (t === 'Constant') {
      const out = netNameOfPort(id, 'out');
      if (!out) continue;
      const cv = String(c.constant ?? '0').replace(/[^01xXzZ]/g, '') || '0';
      body.push(`  assign ${out} = ${cv.length}'b${cv};`);
      continue;
    }
    if (t === 'Dff') {
      const out = netNameOfPort(id, 'out');
      if (!out) continue;
      const d = netNameOfPort(id, 'in') || "1'bx";
      const clk = netNameOfPort(id, 'clk') || "1'bx";
      const init = String(c.initial ?? 'x');
      if (/^[01]$/.test(init)) body.push(`  initial ${out} = 1'b${init};`);
      body.push(`  always @(posedge ${clk}) ${out} <= ${d};`);
      continue;
    }
    if (t === 'Clock') {
      const out = netNameOfPort(id, 'out');
      if (!out) continue;
      const half = Number(c.propagation) || 100;
      body.push(`  // clock 半周期 ${half} tick`);
      body.push(`  initial begin ${out} = 0; forever #${Math.max(1, Math.round(half / 2))} ${out} = ~${out}; end`);
      continue;
    }
    if (t === 'Subcircuit') {
      const ct = String(c.celltype || '').trim();
      const innerIO = (c.subcircuitGraph?.cells || []).filter((n) => n.type === 'Input' || n.type === 'Output');
      if (!ct) { errors.push(`部件「${moduleName}」有一个未指名（celltype 空）的子电路实例`); continue; }
      if (!innerIO.length) { errors.push(`部件「${moduleName}」的子电路「${ct}」缺内部图／无可辨识端口`); continue; }
      const conns: string[] = [];
      for (const p of sortedIO(innerIO)) {
        const pn = String(p.net || '').trim();
        if (!pn) continue;
        const sig = netNameOfPort(id, pn);
        if (sig) conns.push(`.${ident(pn)}(${sig})`);
      }
      body.push(`  ${ident(ct)} sub${++gi} (${conns.join(', ')});`);
      continue;
    }
  }

  if (errors.length) return { verilog: '', errors };

  const header = [`module ${ident(moduleName)} (`, portDecls.join(',\n'), ');'].join('\n');
  return { verilog: [header, ...wireDecls, ...body, 'endmodule', ''].join('\n'), errors: [] };
}
