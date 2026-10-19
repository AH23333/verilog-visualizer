// Verilog 轻量解析（模块/实例）——从主仓 src/lib/verilogParse.ts 抽取的核心正则，
// 逐字随迁（R134 片 4：扩展宿主侧为 TreeView 提供解析能力，主仓保留权威版本）。
// R160 四-3：lite 原语表提为 export const（两函数体同源引用；res.parseFile 与主仓两份表并呈差集——
//   ⛔ 三条字面量各抄各的，挂名才是同一把尺）。与主仓分岔（dff 族/tri 族）＝在册 P5 案底，如实并存。
export const VERILOG_LITE_PRIMITIVES: readonly string[] = [
  'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
  // R160 真机实锤（批1问题E）：⛔ 'add'/'sub'——非 IEEE 1364 原语，撞名模块的例化会被吞（与主仓对齐）。
  'notif0', 'notif1', 'module', 'endmodule', 'input', 'output',
  'inout', 'wire', 'reg', 'assign', 'always', 'initial', 'if', 'else', 'case',
  'endcase', 'begin', 'end', 'posedge', 'negedge', 'parameter', 'localparam',
];

export function parseVerilogModules(source: string): string[] {
  const cleaned = stripComments(source);
  const modules: string[] = [];
  const re = /\bmodule\s+([A-Za-z_][\w$]*)\s*(?:#\s*\([^)]*\)\s*)?[(;]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (!modules.includes(m[1])) modules.push(m[1]);
  }
  return modules;
}

export function parseVerilogInstances(source: string): string[] {
  const cleaned = stripComments(source);
  const definedModules = new Set(parseVerilogModules(source));
  const primitives = new Set(VERILOG_LITE_PRIMITIVES);
  const instances: string[] = [];
  const re = /\b([A-Za-z_][\w$]*)\s+(?:#\s*\([^)]*\)\s*)?([A-Za-z_][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const mod = m[1];
    if (primitives.has(mod) || definedModules.has(m[2])) continue;
    if (!instances.includes(mod)) instances.push(mod);
  }
  return instances;
}

/**
 * 带行号的实例清单（诊断锚点用）：形状与 parseVerilogInstances 同判据，但注释用
 * **等长掩码**（⛔ 拼接成单空格——那会让行号整体漂移），命中下标折原源 1-based 行号。
 */
export function parseVerilogInstancesWithLines(source: string): Array<{ name: string; line: number }> {
  // 等长掩码：`//…` 换行内抹平，`/*…*/` 保留换行只抹内容——下标与原源逐位对应
  const masked = source
    .replace(/\/\/[^\n]*/g, (s) => ' '.repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  const definedModules = new Set(parseVerilogModules(source));
  const primitives = new Set([
    'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
    // R160 真机实锤（批1问题E）：⛔ 'add'/'sub'（与 parseVerilogInstances 同判据，两形一把尺）。
    'notif0', 'notif1', 'module', 'endmodule', 'input', 'output',
    'inout', 'wire', 'reg', 'assign', 'always', 'initial', 'if', 'else', 'case',
    'endcase', 'begin', 'end', 'posedge', 'negedge', 'parameter', 'localparam',
  ]);
  const seen = new Set<string>();
  const out: Array<{ name: string; line: number }> = [];
  const re = /\b([A-Za-z_][\w$]*)\s+(?:#\s*\([^)]*\)\s*)?([A-Za-z_][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const mod = m[1];
    if (primitives.has(mod) || definedModules.has(m[2]) || seen.has(mod)) continue;
    seen.add(mod);
    out.push({ name: mod, line: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}
