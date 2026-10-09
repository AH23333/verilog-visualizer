/**
 * 器件参数在「编译 JSON ↔ 沙盒 cells 快照 ↔ 画布模型」三处之间必须**对称往返**。
 *
 * 以往这三处各写一条 if 链，字段清单靠人手对齐，于是 digitaljs 在**构造期**读走的
 * 参数被逐段静默丢掉，而器件数与连线数都不变 —— 拓扑闸门全绿，仿真却和编译模式不一样：
 *  - `ZeroExtend.extend = {input:3,output:4}` 丢了 → digitaljs 退回默认 {1,1}，
 *    一个 3→4 位的零扩展变成 1→1 位（multiplier 实测）；
 *  - `Dff.arst_value / srst_value` 丢了 → digitaljs 补 `"0000…"`，异步/同步复位值
 *    从 1 变 0（r48_exotic 实测 25 颗、r48_sync 实测 11 颗）；
 *  - `angle` 只在其中一个方向带 → 沙盒里旋转过（Ctrl+R）的器件，展开图/导出 .djs/
 *    「保存为部件」都会把它摆回 0°，与编译渲染不一致。
 *
 * 这里只放**清单与取值规则**，不放渲染逻辑；`hide_label`、`source_positions` 刻意不收录：
 * 前者 digitaljs 与本项目都不读（丢掉无后果），后者只对编译模式跳源码有意义，
 * 进沙盒会让每个器件多一段路径+行号却永远用不上。
 */

/**
 * digitaljs 的 BusGroup/BusUngroup 把 `groups` 当**每组位宽的数组**用
 * （`groups.entries()` 取 [下标, 位宽]、`groups.length` 算高度）。历史代码按
 * Map 处理，于是：①Map 没有 `.length` → 原生高度 NaN（joint 报
 * `<rect> attribute height: Expected length, "NaN"`）；②存档写成
 * `Array.from(map.entries())` 的「[下标,位宽] 对」数组，回转给 digitaljs 后
 * `bits += [0,4]` → NaN，且合线器端口整个错掉。
 * 这里把三种历史形状统一成 digitaljs 原生的位宽数组。
 */
export function normalizeGroups(g: unknown): number[] | undefined {
  if (g == null) return undefined;
  if (g instanceof Map) return Array.from(g.values()).map(Number);
  if (Array.isArray(g)) {
    // 「[下标, 位宽] 对」数组（旧存档）→ 取位宽
    if (g.length && g.every((e) => Array.isArray(e) && e.length === 2 && Number.isFinite(Number(e[1])))) {
      return g.map((e) => Number((e as [unknown, unknown])[1]));
    }
    return g.map(Number);
  }
  return undefined;
}

/**
 * 必须**在构造期**给出的字段：digitaljs 把它们列进 `_unsupportedPropChanges`
 * （polarity/bits/initial/arst_value/srst_value/enable_srst/no_data）或在
 * `initialize()` 里读走（extend 建端口、groups/slice/rdports 定位宽）。
 * 事后 `cell.set()` 会被回滚并告警，端口也不会重建。
 */
export const CTOR_PARAM_KEYS = [
  'polarity', 'initial', 'arst_value', 'srst_value', 'enable_srst', 'no_data',
  'constant', 'extend', 'groups', 'slice', 'abits', 'rdports', 'wrports',
  // yosys2digitaljs 会往器件上写这四项（core.ts:755/767/794/807 signed、:812 fillx、
  // :1032-1033 words/offset），digitaljs 在构造期读走：
  //  - `signed` 丢 → 有符号乘/除/比较在沙盒里变成无符号，同一个端口读数完全不同；
  //  - `fillx` 丢 → $shiftx「移位量取不出补 x」变成补 0；
  //  - `words`/`offset` 丢 → 128 字存储器按默认行数建，写进高位地址的数据不见。
  // 三者都不改器件数与连线数，正是 R48/R49 那一族「拓扑没变、仿真变了」。
  // 官方流（verilog.ts EXPERIMENTAL_FLOW）下这四项已被实证能出现在产物里（r116 实验闸门：
  // Multiplication.signed={in1:true,in2:true}、Memory.words=128）；默认旧流（techmap）下仍不出现。
  // 这份清单在两种流下都是三处对称往返的契约，删任何一行都会回到 R48/R49 那一族。
  'signed', 'fillx', 'words', 'offset',
  // NumDisplay/NumEntry/总线终端的数值基（io.mjs:9-82 画布内 <select> 直接改这个属性）。
  // 不序列化 = 用户把 hex 改成 dec，存盘重开就变回 hex。
  'numbase',
  // 状态机（FSM）：digitaljs 在 initialize 里按 states 建状态图的圈、按 trans_table 建弧线，
  // prepare() 再把 ctrl_in/ctrl_out 解成向量（cells/FSM.mjs:14-105）。yosys2digitaljs 从
  // $fsm 的 TRANS_TABLE 解出来的也是同一形状（core.ts:994-1010）。丢掉任一项，
  // 器件还在、端口还对，但状态机退化成「只有一个圈的机器」，仿真输出恒 x。
  'states', 'init_state', 'trans_table',
  // n 元门（And/Or/Nand/Nor/Xor/Xnor ＝ 上游 GateX1 族）的扇入数：initialize 里按它
  // 生成 in1..inN 端口并把盒体设成 60*(n/2)×32*(n/2)（bundle @2302908），且列在
  // `_unsupportedPropChanges`（@2303863）⇒ 事后 set 会被回滚，只能在构造期给。
  // r68 实测：存档里写 inputs=4 → 重开变回 2、端口只剩 in1/in2/out（盒体也从 120×64 缩回
  // 60×32）。今天从元件库放出来的门是默认 2，所以丢它看不出来；一旦扇入可编辑（沙盒右键
  // 「输入引脚数」）或导入别人给的 .djs，丢的这一项就是**端口整个不见、连线被孤立**；
  // 更要命的是存档里的 size 仍然是 4 输入的 120×64 —— 变异跑实测：门变回 2 输入、盒体却还是
  // 4 输入那么大，端口点与连线落点一起错位。
  'inputs',
  // 稀疏多路选择（MuxSparse）的「有没有默认分支」：它和 `inputs` 一起决定端口行数
  // （r69 现场：inputs=['0','1','3'] + default_input=true ⇒ 端口 sel,out,in0..in3，四行）。
  // 漏了它，用户加的默认分支在重开后变成少一行端口，全部落在 in3 上的连线被孤立。
  'default_input',
  // 数据位宽。**现场读数（2026-10-06，r94 批次探针）**：一颗 4 位、带低有效清零与同步复位值 0101 的
  // 寄存器存盘重开后 `bits` 变回 1 —— 存档里 bits 是有的（sandboxSerialize 直接写这一格），
  // 但回读靠 `sandboxLoad` 事后 `cell.set('bits', …)`，而 Dff/Mux/Arith 这一族把 bits 列进
  // `_unsupportedPropChanges`（dff.mjs:118），事后 set 被 digitaljs 回滚并告警，端口按构造期的
  // 默认位宽建好就不再变宽。于是 4 位寄存器的 `srst_value="0101"` 配着 1 位的 Q ——
  // 器件数、端口名、连线数全对，只有仿真错了（正是这份文件开头 R48 那一族的形状）。
  'bits',
  // 镜像翻转状态（{h?,v?}，cellMirror 的消费属性——R99）：不是 digitaljs 的构造参数，
  // 但同样只在构造期生效（sandboxLoad 在 spawn 后调 applyMirror 重挂图形与端口位置），
  // 且必须随存档/复制往返——丢了就是"存盘重开镜像消失"。
  'mirror',
];

/**
 * 需要在两份转换（circuitJson ⇄ cells）与存档序列化之间逐字段往返的参数全集。
 * position/size/net/label/order/attrs 由调用方单独处理（空网名、空标签有特殊含义）。
 */
export const DEVICE_PARAM_KEYS = ['angle', 'propagation', ...CTOR_PARAM_KEYS];

/** 取值：`groups` 走历史形状归一，其余原样；`null/undefined` 才算缺省（0 / false / "0" 都是有效值） */
export function paramValue(key: string, cell: any): unknown {
  if (!cell) return undefined;
  const v = key === 'groups' ? normalizeGroups(cell.get ? cell.get('groups') : cell.groups)
    : (cell.get ? cell.get(key) : cell[key]);
  // BigInt 进不了 JSON.stringify（整次保存直接抛：r76 实测 handleSave 抛
  // `Do not know how to serialize a BigInt`）。上游 MuxSparse 在构造期把
  // `inputs` 的**每一项**转成 BigInt（`"bigint"!=typeof t[n] && (t[n]=BigInt(t[n]))`），
  // 也就是说存字符串它认得、存 BigInt 只有画布上那一版认得 ⇒ **数组元素也要降**成十进制串。
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v) && v.some((x) => typeof x === 'bigint')) return v.map((x) => (typeof x === 'bigint' ? x.toString() : x));
  return v;
}

/** 存档里的器件快照 → digitaljs 构造参数（Memory 的 bits 决定 data 端口位宽，也要构造期给） */
export function ctorParams(cc: any): Record<string, any> {
  const extra: Record<string, any> = {};
  if (!cc) return extra;
  for (const k of CTOR_PARAM_KEYS) {
    const v = paramValue(k, cc);
    if (v != null) extra[k] = v;
  }
  if (cc.type === 'Memory' && cc.bits != null) extra.bits = cc.bits;
  return extra;
}
