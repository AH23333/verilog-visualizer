// verilog 的**多驱动冲突检测/摘除与标准单元归一域**（卷三十三从 verilog.ts 分离，纯搬家零改语义）。
// 只操作 yosys write_json 的输出对象；冲突分级语义（具名可出图标冲突、无名拒编）的血泪注释随迁。

export const PORT_DRIVER_PREFIX = '端口 ';

/** 冲突的统一话术：先列是哪几根线、谁在并驱，再说为什么处理不了 */
export function conflictText(conflicts: NetConflict[], why: string): string {
  const named = conflicts.filter((c) => c.net).map((c) => c.net).slice(0, 6).join(', ');
  const detail = conflicts.slice(0, 3)
    .map((c) => `net「${c.net ?? '无名'}」← ${c.drivers.join(' + ')}`).join('；');
  return `检测到 ${conflicts.length} 处多驱动冲突${named ? `（${named}${conflicts.length > 6 ? ' …' : ''}）` : ''}：${detail}。`
    + `${why}。本工具渲染的是「每个信号单一驱动、可直接仿真」的电路图，已拒绝编译。`
    + '请把每个输出改成独立信号，或去掉并驱的 assign / 例化端口连接。';
}

/** 一处多驱动冲突：net 名（拿不到就是 null）+ 驱动它的 端口 列表 */
export interface NetConflict {
  net: string | null;
  module: string;
  drivers: string[];
}

/**
 * 从 yosys write_json 里找出「同一根线上有多个驱动」的位。
 *
 * 为什么要自己查：yosys2digitaljs 遇到多驱动直接抛 `Multiple sources driving
 * net: <name>` 就什么都不画了，而 `<name>` 经常是 `undefined`（它拿不到可读
 * 名字），用户看到的是一句没有信息量的失败。自己查可以分清两种情况：
 *  - 冲突位能对上具名 net ⇒ 这是可修的写法问题，剥掉多余驱动后照常出图并报告；
 *  - 对不上名字 ⇒ 典型的手工门级网表（assign 与 dff 输出并驱），本工具按
 *    「单驱动、可仿真」的电路图渲染，直接拒编译并说清原因。
 */
export function findNetConflicts(yosysOutput: any): NetConflict[] {
  const conflicts: NetConflict[] = [];
  for (const [modName, mod] of Object.entries<any>(yosysOutput?.modules || {})) {
    const drivers = new Map<number, string[]>();
    const note = (bits: unknown, who: string) => {
      if (!Array.isArray(bits)) return;
      for (const raw of bits) {
        const bit = Number(raw);
        if (!Number.isFinite(bit)) continue;
        const list = drivers.get(bit);
        if (list) list.push(who); else drivers.set(bit, [who]);
      }
    };
    // yosys2digitaljs 的方向语义（core.ts connect_ports）：**input 端口是驱动源**、
    // output 端口是负载。所以这里只把 input 端口记成驱动者 —— 记反了会把
    // 「门驱动输出端口」这一正常结构误判成冲突（实测踩过）。
    // input 端口摘不掉（那是引脚），落在它上面的冲突只能拒编译。
    for (const [pn, p] of Object.entries<any>(mod?.ports || {})) {
      if (p?.direction === 'input') note(p.bits, PORT_DRIVER_PREFIX + pn);
    }
    for (const [cellName, cell] of Object.entries<any>(mod?.cells || {})) {
      const dirs = cell?.port_directions || {};
      for (const [port, bits] of Object.entries<any>(cell?.connections || {})) {
        if (dirs[port] === 'output' || dirs[port] === 'inout') note(bits, `${cellName}.${port}`);
      }
    }
    const conflicted = new Set<number>();
    for (const [bit, list] of drivers) {
      if (list.length >= 2) conflicted.add(bit);
    }
    if (!conflicted.size) continue;
    // 冲突位 → 可读 net 名（netnames 里 bits 命中即算，hide_name 的也认）
    const nameOf = new Map<number, string>();
    for (const [nn, info] of Object.entries<any>(mod?.netnames || {})) {
      for (const b of info?.bits || []) {
        const bit = Number(b);
        if (conflicted.has(bit) && !nameOf.has(bit)) nameOf.set(bit, nn);
      }
    }
    const grouped = new Map<string, NetConflict>();
    for (const bit of conflicted) {
      const who = drivers.get(bit)!.join(' + ');
      const net = nameOf.get(bit) ?? null;
      const key = `${net}|${who}`;
      if (!grouped.has(key)) grouped.set(key, { net, module: modName, drivers: drivers.get(bit)!.slice() });
    }
    conflicts.push(...grouped.values());
    // 留给 stripExtraDrivers 用：哪些位有冲突、每位分别是谁在驱动
    mod.__conflictedBits = conflicted;
    mod.__driverList = drivers;
  }
  return conflicts;
}

/**
 * 剥掉多余驱动：只有当某个驱动端口的**每一位**都是多余驱动时才整个删掉它
 * （部分位删除要做位级手术，风险大，宁可退回拒编译）。
 * 返回剥掉的驱动端口数。
 */
export function stripExtraDrivers(yosysOutput: any): number {
  let fixed = 0;
  for (const mod of Object.values<any>(yosysOutput?.modules || {})) {
    const conflicted: Set<number> | undefined = mod.__conflictedBits;
    const driverList: Map<number, string[]> | undefined = mod.__driverList;
    if (!conflicted?.size || !driverList) continue;
    const isPortDriver = (who: string) => who.startsWith(PORT_DRIVER_PREFIX);
    const keep = new Map<number, string>();      // 每位保留第一个驱动
    for (const bit of conflicted) {
      const first = (driverList.get(bit) || [])[0];
      if (first) keep.set(bit, first);
    }
    // 输出被摘空的器件：如果它**所有**输出都摘空了，就把整颗删掉。
    // 只把 connections 置空是不够的 —— 上游对每个输出端口都 assert
    // `connections[port].length == 端口位宽`（core.ts:755/767/960 一族的写法），
    // 空向量长度 0 对不上位宽 ⇒ `Assertion failed`（实测 r56_conflict_named：
    // `assign dup = a&b; assign dup = a|b;` 摘完第二颗仍报 Assertion failed）。
    const emptiedOut = new Map<string, number>();  // cell → 被摘空的输出端口数
    const totalOut = new Map<string, number>();    // cell → 输出端口总数
    for (const [cellName, cell] of Object.entries<any>(mod?.cells || {})) {
      const dirs = cell?.port_directions || {};
      const outs = Object.keys(dirs).filter((p) => dirs[p] === 'output' || dirs[p] === 'inout');
      totalOut.set(cellName, outs.length);
      for (const port of outs) {
        const bits = cell?.connections?.[port];
        const arr = Array.isArray(bits) ? bits.map(Number) : [];
        if (!arr.length) continue;
        // 每一位都必须是「有冲突、保留者不是本端口、且保留者不是顶层端口」
        // —— 顶层端口摘不掉（摘了就没有这个引脚），那种情况交给上层拒编译。
        const allExtra = arr.every((b) => {
          const k = keep.get(b);
          return conflicted.has(b) && k !== `${cellName}.${port}` && !isPortDriver(String(k));
        });
        if (!allExtra) continue;
        // 置空而不是删除这个键：yosys2digitaljs 读 undefined.length 会崩（实测）
        cell.connections[port] = [];
        emptiedOut.set(cellName, (emptiedOut.get(cellName) || 0) + 1);
        fixed++;
      }
    }
    for (const [cellName, n] of emptiedOut) {
      if (n >= (totalOut.get(cellName) || 0)) {
        delete mod.cells[cellName];
        fixed++;
      }
    }
  }
  return fixed;
}

/**
 * Upstream-gap workaround (yosys2digitaljs@0.10.3, verified by Node spike):
 * its `techmap_dff_kinds` Map declares the key `'$_DFF_'` twice — the
 * clk+arst entry silently overwrites the clk-only entry, so single-polarity
 * standard cells produced by `techmap` (`$_DFF_P_`, `$_DFF_N_`, `$_DFFE_PP_`, …)
 * never get registered and conversion throws `Invalid cell type: $_DFF_P_`.
 * Pure synchronous DFFs (`always @(posedge clk) q <= …`) are extremely common,
 * so normalize those cells back to `$dff`/`$dffe` RTLIL cells (which
 * yosys2digitaljs maps correctly) before conversion.
 */
export function normalizeStdDffCells(yosysOutput: any): void {
  const modules = yosysOutput?.modules;
  if (!modules || typeof modules !== 'object') return;
  // single-bit WIDTH constant in the exact 32-bit binary-string form Yosys emits
  const WIDTH1 = '00000000000000000000000000000001';
  for (const mod of Object.values<any>(modules)) {
    const cells = mod?.cells;
    if (!cells || typeof cells !== 'object') continue;
    for (const cell of Object.values<any>(cells)) {
      if (typeof cell?.type !== 'string') continue;
      const m = cell.type.match(/^\$_DFF_(N|P)_$/);
      if (m) {
        cell.type = '$dff';
        cell.parameters = { ...cell.parameters, CLK_POLARITY: m[1] === 'P' ? '1' : '0', WIDTH: WIDTH1 };
        cell.connections = { CLK: cell.connections.C, D: cell.connections.D, Q: cell.connections.Q };
        cell.port_directions = { CLK: 'input', D: 'input', Q: 'output' };
        continue;
      }
      const me = cell.type.match(/^\$_DFFE_(N|P)(N|P)_$/);
      if (me) {
        cell.type = '$dffe';
        cell.parameters = {
          ...cell.parameters,
          CLK_POLARITY: me[1] === 'P' ? '1' : '0',
          EN_POLARITY: me[2] === 'P' ? '1' : '0',
          WIDTH: WIDTH1,
        };
        cell.connections = {
          CLK: cell.connections.C,
          EN: cell.connections.E,
          D: cell.connections.D,
          Q: cell.connections.Q,
        };
        cell.port_directions = { CLK: 'input', EN: 'input', D: 'input', Q: 'output' };
      }
    }
  }
}