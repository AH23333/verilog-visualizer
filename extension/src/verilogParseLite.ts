// Verilog 轻量解析（模块/实例）——从主仓 src/lib/verilogParse.ts 抽取的核心正则，
// 逐字随迁（R134 片 4：扩展宿主侧为 TreeView 提供解析能力，主仓保留权威版本）。
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
  const primitives = new Set([
    'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
    'notif0', 'notif1', 'add', 'sub', 'module', 'endmodule', 'input', 'output',
    'inout', 'wire', 'reg', 'assign', 'always', 'initial', 'if', 'else', 'case',
    'endcase', 'begin', 'end', 'posedge', 'negedge', 'parameter', 'localparam',
  ]);
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

function stripComments(source: string): string {
  return source
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}
