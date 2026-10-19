// 器件右键菜单构建器 —— 从 SandboxCanvas.openCellMenu 整体迁出（卷三十二 瘦身第二轮）。
//
// 纪律：本文件是**纯搬家**——菜单文案、校验话术、上游注释（为什么只能重建、
// 双有符号规则、fillx 语义……）逐字保留，账本里那些"血泪注释"一条不许在搬运中丢失。
// 所有组件耦合（setState / ref / 本地函数）经 CellMenuCtx 注入；builder 只产菜单项。
// 二级弹窗必须 setTimeout(…, 0) 打开（ContextMenu 在 action() 后立刻 onClose()）——
// 这个时序坑的原注释留在对应项。
import type { ContextMenuItem } from '../components/ContextMenu';
import {
  CN_NAME, GATE_TYPES, NARY_GATE_TYPES, IO_TYPES, PORT_TYPES, MUX_TYPES,
  SPARSE_MUX_TYPES, EXTEND_TYPES, REDUCE_TYPES, SOURCE_TYPES,
  ARITH_TYPES, COMPARE_TYPES, SHIFT_TYPES, sparseSelBits, arithBits,
} from './sandboxCatalog';
import { normalizeGroups } from './deviceParams';
import { ANNOTATION_TYPE } from './annotationCell';
import { t } from '../i18n';   // i18n：中文原文即键（I18N_DESIGN §二）

export interface CellMenuCtx {
  cell: any;
  cellId: string;
  type: string;
  multi: boolean;
  selCount: number;
  paper: any;
  scopeToClicked(): void;
  deleteSelection(): void;
  copySelection(): void;
  duplicateSelection(): void;
  rotateSelection(deg: number): void;
  flipSelection(dir: 'h' | 'v'): void;
  alignSelection(mode: string): void;
  distributeSelection(axis: string): void;
  bringToFront(up: boolean): void;
  selectAll(): void;
  setProp(id: string, key: string, val: any): void;
  reconfigureCell(id: string, extra: Record<string, any>): any;
  resetIoOutput(cell: any): void;
  showToast(msg: string): void;
  ensureSimRunning(): void;
  commit(): void;
  openDffPorts(id: string): void;
  openFsm(id: string): void;
  openBusDlg(id: string, type: string, total: number, firstW: number): void;
  openMemView(cell: any): void;
  openMemPorts(id: string): void;
  openInner(cell: any): void;
  openRebind(id: string, cur: string): void;
  startNoteEdit(cell: any): void;
  saveSubAsPart(cell: any, name: string): void;
}

export function buildCellMenuItems(ctx: CellMenuCtx): ContextMenuItem[] {
  const { cell, cellId, type, multi, selCount, paper } = ctx;
  const suffix = multi ? t('（{count} 项）', { count: selCount }) : '';
  const items: ContextMenuItem[] = [];
  items.push({ label: t('删除') + suffix, hint: 'Delete', danger: true, action: () => { ctx.scopeToClicked(); ctx.deleteSelection(); } });
  items.push({ label: t('复制') + suffix, hint: 'Ctrl+C', action: () => { ctx.scopeToClicked(); ctx.copySelection(); } });
  items.push({ label: t('剪切') + suffix, hint: 'Ctrl+X', action: () => { ctx.scopeToClicked(); ctx.copySelection(); ctx.deleteSelection(); } });
  items.push({ label: t('创建副本') + suffix, hint: 'Ctrl+D', action: () => { ctx.scopeToClicked(); ctx.duplicateSelection(); } });
  items.push({ label: '---' });
  items.push({ label: t('顺时针旋转 90°'), hint: 'Ctrl+R', action: () => { ctx.scopeToClicked(); ctx.rotateSelection(90); } });
  items.push({ label: t('逆时针旋转 90°'), hint: 'Shift+Ctrl+R', action: () => { ctx.scopeToClicked(); ctx.rotateSelection(-90); } });
  items.push({ label: t('水平镜像'), action: () => { ctx.scopeToClicked(); ctx.flipSelection('h'); } });
  items.push({ label: t('垂直镜像'), action: () => { ctx.scopeToClicked(); ctx.flipSelection('v'); } });
  items.push({ label: '---' });
  if (type === 'Clock') {
    items.push({ label: t('时钟周期'), input: { value: String(cell.get('propagation') ?? ''), placeholder: t('周期'), onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) { ctx.showToast(t('时钟周期必须是 ≥1 的数字')); return; }
      ctx.setProp(cellId, 'propagation', Math.floor(n));
    } } });
  }
  if (GATE_TYPES.includes(type)) {
    items.push({ label: t('传播延迟'), input: { value: String(cell.get('propagation') ?? ''), placeholder: t('延迟'), onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { ctx.showToast(t('传播延迟必须是 ≥0 的数字')); return; }
      ctx.setProp(cellId, 'propagation', Math.floor(n));
    } } });
    items.push({ label: t('标签'), input: { value: String(cell.get('label') ?? ''), placeholder: t('标签'), onCommit: (v) => ctx.setProp(cellId, 'label', v) } });
  }
  if (NARY_GATE_TYPES.includes(type)) {
    // 扇入只能在构造期给（见 NARY_GATE_TYPES 的说明）→ 重建。缩小时落在被删掉的
    // inK 上的连线会断，这里把断了几条如实报出来，不静默吃线。
    const inPortsNow = (cell.get('ports')?.items || []).filter((p: any) => /^in\d+$/.test(String(p.id))).length;
    items.push({ label: t('输入引脚数'), input: { value: String(inPortsNow || Number(cell.get('inputs')) || 2), placeholder: '2–16', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 2 || n > 16) { ctx.showToast(t('输入引脚数必须是 2–16 的整数')); return; }
      const linksBefore = paper ? paper.model.getConnectedLinks(cell).length : 0;
      const rebuilt = ctx.reconfigureCell(cellId, { inputs: Math.floor(n), bits: Number(cell.get('bits')) || 1 });
      if (!rebuilt) { ctx.showToast(t('重建失败：器件没能换成新扇入')); return; }
      const ports = (rebuilt.get('ports')?.items || []).map((p: any) => String(p.id)).filter((x: string) => /^in\d+$/.test(x));
      const linksAfter = paper ? paper.model.getConnectedLinks(rebuilt).length : 0;
      const lost = Math.max(0, linksBefore - linksAfter);
      ctx.showToast(ports.length !== Math.floor(n)
        ? t('扇入没改成：新器件的输入引脚是 {pins}', { pins: ports.join(',') || t('无') })
        : lost ? t('已改为 {count} 输入（断开 {lost} 条落在被删引脚上的线）', { count: ports.length, lost }) : t('已改为 {count} 输入', { count: ports.length }));
    } } });
  }
  if (PORT_TYPES.includes(type)) {
    items.push({ label: t('引脚名'), input: { value: String(cell.get('net') ?? ''), placeholder: 'net', onCommit: (v) => ctx.setProp(cellId, 'net', v) } });
    items.push({ label: t('位宽'), input: { value: String(cell.get('bits') ?? ''), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) { ctx.showToast(t('位宽必须是 ≥1 的数字')); return; }
      ctx.setProp(cellId, 'bits', Math.floor(n));
      ctx.resetIoOutput(cell);
    } } });
  }
  if (IO_TYPES.includes(type) && type !== 'Clock') {
    items.push({ label: t('位宽'), input: { value: String(cell.get('bits') ?? ''), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) { ctx.showToast(t('位宽必须是 ≥1 的数字')); return; }
      ctx.setProp(cellId, 'bits', Math.floor(n));
      ctx.resetIoOutput(cell);
    } } });
  }
  if (type === 'Constant') {
    // digitaljs 的 Constant 监听 change:constant，会自动更新位宽与端口
    items.push({ label: t('常量值'), input: { value: String(cell.get('constant') ?? ''), placeholder: t('二进制，如 1010'), onCommit: (v) => {
      const s = String(v).trim();
      if (!/^[01x]{1,32}$/.test(s)) { ctx.showToast(t('常量值只能是 0/1/x 组成的 1–32 位串')); return; }
      ctx.setProp(cellId, 'constant', s);
    } } });
  }
  if (type === 'Dff') {
    // initial / bits 都在 digitaljs 的「不支持运行时修改」名单里 —— 必须重建器件
    const bitsNow = Number(cell.get('bits')) || 1;
    items.push({ label: t('位宽'), input: { value: String(bitsNow), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { bits: Math.floor(n), polarity: cell.get('polarity') });
      ctx.showToast(t('触发器已重建为 {count} 位', { count: Math.floor(n) }));
    } } });
    items.push({ label: t('初始值'), input: { value: String(cell.get('initial') ?? 'x'), placeholder: '0/1/x', onCommit: (v) => {
      const s = String(v).trim();
      if (!/^[01x]+$/.test(s)) { ctx.showToast(t('初始值只能由 0/1/x 组成')); return; }
      ctx.reconfigureCell(cellId, { bits: bitsNow, initial: s, polarity: cell.get('polarity') });
      ctx.showToast(t('初始值已设为 {value}（器件已重建）', { value: s }));
    } } });
    // 整套控制脚（clk/en/arst/srst/set/clr/aload）＋每一脚的高低有效＋复位值：digitaljs 全在
    // 构造期读走，且"复位值不能长于位宽""enable_srst 只在使能＋同步复位同时存在时才有意义"
    // 这类约束要一次校验完 —— 散成菜单里的一排输入框做不到，集中成一颗编辑窗（存储器端口配置同形）。
    items.push({ label: t('端口与极性…'), hint: '▶', action: () => { setTimeout(() => ctx.openDffPorts(cellId), 0); } });
  }
  if (type === 'FSM') {
    // 状态数 / 初始状态 / 位宽 / 转移表全部集中在一个编辑窗里改：散成四条菜单输入项会让
    // "范围必须互相自洽"（init < states、状态号不越界）没法一次性校验。
    // 二级弹窗必须 setTimeout 打开 —— ContextMenu 在 action() 之后立刻 onClose()。
    items.push({ label: t('转移表…'), hint: '▶', action: () => { setTimeout(() => ctx.openFsm(cellId), 0); } });
  }
  if (MUX_TYPES.includes(type)) {
    // Mux 的 bits 同样不可运行时修改 → 重建
    const b = cell.get('bits') || { in: 1, sel: 1 };
    items.push({ label: t('数据位宽'), input: { value: String(b.in ?? 1), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('数据位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { bits: { in: Math.floor(n), sel: b.sel ?? 1 } });
      ctx.showToast(t('数据位宽 {count} 位（{ways} 路）', { count: Math.floor(n), ways: type === 'Mux' ? 1 << (b.sel ?? 1) : (b.sel ?? 1) }));
    } } });
    items.push({ label: t('选择位宽'), input: { value: String(b.sel ?? 1), placeholder: 'sel bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 5) { ctx.showToast(t('选择位宽必须是 1–5（最多 32 路）')); return; }
      ctx.reconfigureCell(cellId, { bits: { in: b.in ?? 1, sel: Math.floor(n) } });
      ctx.showToast(t('选择位宽 {count} 位 → {ways} 路输入', { count: Math.floor(n), ways: 1 << Math.floor(n) }));
    } } });
  }
  if (SPARSE_MUX_TYPES.includes(type)) {
    // 案件值表与默认分支都只能在构造期给（端口行数由它们算出来）→ 重建。
    const curCases = ((cell.get('inputs') as any[]) || []).map((x) => typeof x === 'bigint' ? x.toString() : String(x));
    const curDefault = cell.get('default_input') === true;
    const curBits = cell.get('bits') || { in: 4, sel: 1 };
    items.push({ label: t('分支取值表'), input: { value: curCases.join(','), placeholder: '0,2,5', onCommit: (v) => {
      const list = String(v).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!list.length) { ctx.showToast(t('至少填一个案件值（逗号分隔，如 0,2,5）')); return; }
      if (list.some((s) => !/^\d+$/.test(s))) { ctx.showToast(t('案件值只能是非负十进制整数')); return; }
      if (list.length > 32) { ctx.showToast(t('分支太多（上限 32 行）')); return; }
      const rows = list.length + (curDefault ? 1 : 0);
      ctx.reconfigureCell(cellId, {
        inputs: list, default_input: curDefault,
        bits: { in: curBits.in ?? 4, sel: sparseSelBits(list, rows) },
      });
      ctx.showToast(t('稀疏选择器：{count} 个案件{extra}，共 {rows} 行', { count: list.length, extra: curDefault ? t(' + 默认分支') : '', rows }));
    } } });
    items.push({ label: curDefault ? t('去掉默认分支') : t('加默认分支（其他值走它）'), action: () => {
      const rows = curCases.length + (curDefault ? 0 : 1);
      ctx.reconfigureCell(cellId, {
        inputs: curCases, default_input: !curDefault,
        bits: { in: curBits.in ?? 4, sel: sparseSelBits(curCases, rows) },
      });
      ctx.showToast(curDefault ? t('已去掉默认分支') : t('已加默认分支：sel 不在案件表里时走这一路'));
    } });
    items.push({ label: t('数据位宽'), input: { value: String(curBits.in ?? 4), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('数据位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { inputs: curCases, default_input: curDefault, bits: { in: Math.floor(n), sel: curBits.sel ?? 1 } });
    } } });
  }
  if (EXTEND_TYPES.includes(type)) {
    // 位扩展：单线 → 总线（或窄总线 → 宽总线）
    const ext = cell.get('extend') || { input: 1, output: 4 };
    items.push({ label: t('输入位宽'), input: { value: String(ext.input), placeholder: 'input bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('输入位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { extend: { input: Math.floor(n), output: Math.max(Math.floor(n), ext.output ?? 1) } });
    } } });
    items.push({ label: t('输出位宽'), input: { value: String(ext.output), placeholder: 'output bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('输出位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { extend: { input: ext.input ?? 1, output: Math.max(ext.input ?? 1, Math.floor(n)) } });
      ctx.showToast(t('已改为 {from} → {to} 位扩展', { from: ext.input, to: Math.max(ext.input ?? 1, Math.floor(n)) }));
    } } });
  }
  if (type === 'BusGroup' || type === 'BusUngroup') {
    items.push({ label: t('位宽方案…'), hint: '▶', action: () => {
      const groups: any = cell.get('groups');
      const widths = normalizeGroups(groups) ?? [1, 1, 1, 1];
      ctx.openBusDlg(cellId, type, widths.reduce((a, b) => a + Number(b), 0) || 4, Number(widths[0]) || 1);
    } });
    // 分组配置：填「4」= 4 组各 1 位；填「2,2,4」= 三组，位宽分别 2/2/4
    const groups: any = cell.get('groups');
    const cur = (normalizeGroups(groups) ?? [1, 1, 1, 1]).join(',');
    items.push({ label: t('分组配置'), input: { value: cur, placeholder: t('4 或 2,2,4'), onCommit: (v) => {
      const s = String(v).trim();
      const widths = /^\d+$/.test(s) ? Array.from({ length: Number(s) }, () => 1) : s.split(',').map(x => Number(x.trim()));
      if (!widths.length || widths.some(x => !Number.isFinite(x) || x < 1 || x > 32)) {
        ctx.showToast(t('请填组数（如 4）或各组位宽（如 2,2,4），单组 1–32 位')); return;
      }
      ctx.reconfigureCell(cellId, { groups: widths });
      ctx.showToast(t('已重建为 {count} 组（共 {bits} 位）', { count: widths.length, bits: widths.reduce((a, b) => a + b, 0) }));
    } } });
  }
  if (type === 'BusSlice') {
    const sl = cell.get('slice') || { first: 0, count: 1, total: 4 };
    // 用户定案写法：「起始位:结束位」**含两端** —— 0:3 = 取第 0-3 位（共 4 位），
    // 1:1 = 只取第 1 位。同时兼容 Verilog 降幂 [msb:lsb]（3:0 与 0:3 等价）。
    // 内部仍是 digitaljs 构造期读的 {first, count, total}，只换 UI 记法。
    const lo = sl.first, hi = sl.first + (sl.count ?? 1) - 1;
    items.push({ label: t('切片配置'), input: { value: `${lo}:${hi}`, placeholder: t('起始:结束（含两端，如 0:3）'), onCommit: (v) => {
      const m = /^(\d+)\s*[:：]\s*(\d+)$/.exec(String(v).trim());
      if (!m) { ctx.showToast(t('格式：起始位:结束位，含两端（0:3 取 0-3 位，1:1 取第 1 位）')); return; }
      const a = Number(m[1]), b = Number(m[2]);
      const first = Math.min(a, b), last = Math.max(a, b);
      const count = last - first + 1;
      if (last > 63 || count > 64) { ctx.showToast(t('切片范围非法（位号 0–63，最多 64 位）')); return; }
      ctx.reconfigureCell(cellId, { slice: { first, count, total: Math.max(sl.total ?? 4, last + 1) } });
      ctx.showToast(t('已取第 {first}–{last} 位，共 {count} 位', { first, last, count }));
    } } });
    items.push({ label: t('总线总位宽'), input: { value: String(sl.total ?? 4), placeholder: 'total bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 64) { ctx.showToast(t('总线总位宽必须是 1–64 的数字')); return; }
      // 收缩总位宽时先夹 first 再按剩余空间夹 count —— 此前只夹 count≤n，
      // first+count 仍可能越过新 total（切片越界）。
      const first = Math.min(sl.first ?? 0, n - 1);
      const count = Math.min(sl.count ?? 1, n - first);
      ctx.reconfigureCell(cellId, { slice: { first, count, total: Math.floor(n) } });
    } } });
  }
  // Display7 固定 8 位段码（改位宽会让段码错乱），故不列入
  if (REDUCE_TYPES.includes(type) || type === 'NumDisplay' || SOURCE_TYPES.includes(type)) {
    const b = Number(cell.get('bits')) || 1;
    items.push({ label: t('位宽'), input: { value: String(b), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('位宽必须是 1–32 的数字')); return; }
      ctx.setProp(cellId, 'bits', Math.floor(n)); // IO / Gate 的 bits 支持运行时修改
    } } });
  }
  if (type === 'Memory') {
    // 批量填充：直接改 cell.memdata 实例并触发 manualMemChange（与内存编辑器同通路）
    const fillMem = (bit: '0' | '1') => {
      ctx.ensureSimRunning();
      const mem = (cell as any).memdata;
      if (!mem) { ctx.showToast(t('引擎尚未就绪，请稍后再试')); return; }
      try {
        const v0 = mem.get(0);
        const Ctor = v0.constructor;
        const nBits = Number(cell.get('bits')) || 1;
        const vec = bit === '1' ? Ctor.fromBin('1'.repeat(nBits), nBits) : Ctor.zeros(nBits);
        const words = Math.min(1 << (Number(cell.get('abits')) || 2), 256);
        for (let a = 0; a < words; a++) mem.set(a, vec);
        cell.trigger('manualMemChange', cell);
        ctx.commit();
        ctx.showToast(bit === '1' ? t('内存已全部置 1') : t('内存已清零'));
      } catch { ctx.showToast(t('填充失败')); }
    };
    items.push({ label: t('查看 / 编辑内存'), hint: '▶', action: () => {
      // 编辑内存是有意义交互：引擎若冻结先自动恢复（gate 即 cell，prepare 后才有 memdata）
      ctx.ensureSimRunning();
      setTimeout(() => ctx.openMemView(cell), 300);
    } });
    items.push({ label: t('端口配置…'), hint: '▶', action: () => { setTimeout(() => ctx.openMemPorts(cellId), 0); } });
    items.push({ label: t('内存清零'), action: () => fillMem('0') });
    items.push({ label: t('内存全部置 1'), action: () => fillMem('1') });
  }
  if (ARITH_TYPES.includes(type) || COMPARE_TYPES.includes(type) || SHIFT_TYPES.includes(type)) {
    items.push({ label: t('位宽'), input: { value: String(cell.get('bits')?.in1 ?? cell.get('bits')?.in ?? ''), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('位宽必须是 1–32 的数字')); return; }
      const b = Math.floor(n);
      // 运算器按类型加宽输出位（乘法 2N、加减 N+1 含进位），比较器输出恒 1 位，
      // 移位量端口 = ceil(log2 N)
      ctx.setProp(cellId, 'bits', COMPARE_TYPES.includes(type) ? { in1: b, in2: b }
        : SHIFT_TYPES.includes(type) ? { in1: b, in2: Math.max(1, Math.ceil(Math.log2(Math.max(2, b)))), out: b }
        : type === 'Negation' ? { in: b, out: b }
        : arithBits(type, b));
    } } });
    // —— 有符号（R95）：signed 与 bits 同在「不支持运行时修改」名单（arith.mjs:39），
    //    只能重建。形状按上游（yosys2digitaljs core.ts:766-810、arith.mjs:46/76/121/156）：
    //    取负＝布尔；加减乘除取模幂与比较器＝{in1,in2}；移位＝{in1,in2,out}
    //    （out 只有 $sshl/$sshr 那一族真的参与语义，$shl/$shr 传了也不碍事）。
    //    ⚠ 重建只传 {signed}：reconfigureCell 会先并上器件现有的整套构造参数（R94），
    //    bits/groups/inputs 不会掉回默认。标签的 √ 前缀反映的是**打开菜单那一刻**的现态。
    const sgnRaw = cell.get('signed');
    const isObj = !!sgnRaw && typeof sgnRaw === 'object';
    const sgnOf = (k?: string) => (isObj ? !!sgnRaw[k!] : !!sgnRaw);
    const sgnName = t(CN_NAME[type] || type);   // 动态键：器件名在 SHARED_VOCAB（I18N_DESIGN §二）
    if (type === 'Negation' || type === 'UnaryPlus') {
      // ⚠ 这两颗是 Arith11：signed 是**布尔**。UnaryPlus 落进 {in1,in2} 分支的话，
      //   对象恒为 truthy ⇒ `toBigInt(signed)` 会把它错读成有符号（形状即语义）。
      items.push({ label: `${sgnOf() ? '√ ' : ''}${t('有符号')}`, action: () => {
        const next = !sgnOf();
        ctx.reconfigureCell(cellId, { signed: next });
        ctx.showToast(t('{name}：有符号＝{state}（器件已重建）', { name: sgnName, state: next ? t('开') : t('关') }));
      } });
    } else {
      const keys = SHIFT_TYPES.includes(type) ? ['in1', 'in2', 'out'] : ['in1', 'in2'];
      const sgnLabel: Record<string, string> = { in1: t('操作数 A'), in2: t('操作数 B'), out: t('输出') };
      // ⚠ 上游规则（arith.mjs:95-96 与 186-187 同一条）：二元运算按 `sgn.in1 && sgn.in2`
      //   解释两个操作数 —— **两脚全开才按有符号算**，只开一脚在电平上没有观感差
      //   （与 Verilog"有一边是无符号则整式按无符号"的晋升规则一致）。移位是例外，
      //   shiftHelp 逐脚取符号。把这条写进 toast，免得用户开了一脚看没变化以为坏了。
      const andRule = !SHIFT_TYPES.includes(type);
      for (const k of keys) {
        items.push({ label: `${sgnOf(k) ? '√ ' : ''}${t('{pin} 有符号', { pin: sgnLabel[k] })}`, action: () => {
          const next: Record<string, boolean> = { in1: sgnOf('in1'), in2: sgnOf('in2') };
          if (SHIFT_TYPES.includes(type)) next.out = sgnOf('out');
          next[k] = !next[k];
          ctx.reconfigureCell(cellId, { signed: next });
          ctx.showToast(t('{name}：{pin} 有符号＝{state}（器件已重建）', { name: sgnName, pin: sgnLabel[k], state: next[k] ? t('开') : t('关') })
            + (andRule && !(next.in1 && next.in2) ? t('；两个操作数都有符号时才按有符号运算') : ''));
        } });
      }
      // 移出空隙补 x（fillx）：shiftHelp 里 fill 决定"移出位宽的那截"补 x、补符号位还是补 0
      // （Vector3vl.make 的初值语义：0＝补 x、-1＝补 0、signbit＝补符号）——$shiftx 那一族
      // （右移出界/负移量左移出界）靠它把结果变成 x 而不是错的 0。同样只能构造期给。
      if (SHIFT_TYPES.includes(type)) {
        items.push({ label: `${cell.get('fillx') ? '√ ' : ''}${t('移出空隙补 x')}`, action: () => {
          const next = !cell.get('fillx');
          ctx.reconfigureCell(cellId, { fillx: next });
          ctx.showToast(t('{name}：移出空隙补 x＝{state}（器件已重建）', { name: sgnName, state: next ? t('开') : t('关') }));
        } });
      }
    }
  }
  if (type === 'Memory') {
    // Memory 的 bits/abits 同样在「不支持运行时修改」名单 → 重建（端口 id 不变，连线自动接回）
    const nBits = Number(cell.get('bits')) || 8;
    const abits = Number(cell.get('abits')) || 3;
    items.push({ label: t('数据位宽'), input: { value: String(nBits), placeholder: 'bits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 32) { ctx.showToast(t('数据位宽必须是 1–32 的数字')); return; }
      ctx.reconfigureCell(cellId, { bits: Math.floor(n), abits, rdports: cell.get('rdports'), wrports: cell.get('wrports') });
      ctx.showToast(t('存储器已重建为 {count} 位数据宽', { count: Math.floor(n) }));
    } } });
    items.push({ label: t('地址位宽'), input: { value: String(abits), placeholder: 'abits', onCommit: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 12) { ctx.showToast(t('地址位宽必须是 1–12（最多 4096 字）')); return; }
      ctx.reconfigureCell(cellId, { bits: nBits, abits: Math.floor(n), rdports: cell.get('rdports'), wrports: cell.get('wrports') });
      ctx.showToast(t('存储器已重建为 {count} 字', { count: 1 << Math.floor(n) }));
    } } });
  }
  if (type === ANNOTATION_TYPE) {
    items.push({ label: t('编辑注释'), hint: t('双击'), action: () => ctx.startNoteEdit(cell) });
  }
  if (type === 'Subcircuit') {
    items.push({ label: t('查看内部电路'), hint: t('双击'), action: () => ctx.openInner(cell) });
    // 绑定（与编译模式一致：「绑定...」开对话框；样式也同款）——实例按 celltype 名绑定
    // 部件文件，「绑定...」改这个名字并重建实例（rebindSubcircuitCell 单一主人）。
    items.push({ label: t('绑定...'), hint: '▶', action: () => {
      setTimeout(() => {
        ctx.openRebind(cellId, String(cell.get('celltype') || ''));
      }, 0);
    } });
    // 绑定闭环（R39）：把该子电路存为**可编辑部件文件**（.djs，同文件夹）——
    // 内部嵌套的绑定式子部件递归入库并按名绑定。导出 .djs 时闭包自动随行。
    items.push({ label: t('保存为部件（可编辑电路）'), input: {
      value: String(cell.get('celltype') || cell.get('label') || ''),
      placeholder: t('部件名'),
      onCommit: (v: string) => {
        const name = String(v).trim();
        if (!name) { ctx.showToast(t('请输入部件名称')); return; }
        ctx.saveSubAsPart(cell, name);
      },
    } });
  }
  if (multi) {
    items.push({ label: '---' });
    items.push({ label: t('左对齐'), action: () => ctx.alignSelection('left') });
    items.push({ label: t('水平居中'), action: () => ctx.alignSelection('hcenter') });
    items.push({ label: t('右对齐'), action: () => ctx.alignSelection('right') });
    items.push({ label: t('顶对齐'), action: () => ctx.alignSelection('top') });
    items.push({ label: t('垂直居中'), action: () => ctx.alignSelection('vcenter') });
    items.push({ label: t('底对齐'), action: () => ctx.alignSelection('bottom') });
    items.push({ label: t('水平等距分布'), action: () => ctx.distributeSelection('h') });
    items.push({ label: t('垂直等距分布'), action: () => ctx.distributeSelection('v') });
  }
  items.push({ label: '---' });
  items.push({ label: t('置于顶层'), action: () => { ctx.scopeToClicked(); ctx.bringToFront(true); } });
  items.push({ label: t('置于底层'), action: () => { ctx.scopeToClicked(); ctx.bringToFront(false); } });
  items.push({ label: '---' });
  items.push({ label: t('全选'), hint: 'Ctrl+A', action: ctx.selectAll });
  return items;
}
