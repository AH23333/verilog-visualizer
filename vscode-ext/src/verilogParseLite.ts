// Verilog 轻量解析（模块/实例）——从主仓 src/lib/verilogParse.ts 抽取的核心正则。
// ⚠ 骨架期复制进扩展（扩展宿主不打包主仓 TS）；后续若双端共用需求增强，抽独立 npm 包。
// 来源批次：主仓卷四十（R132）。

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

/** 轻量接口校验（骨架版）：重复模块定义、实例引用的模块在工作区缺失。
 *  完整校验（端口/位宽/方向）随 Webview 编译器接入（复用主仓 validateModuleInterfaces）。 */
export function validateModuleInterfacesLite(source: string): { message: string; detail: string }[] {
  const errors: { message: string; detail: string }[] = [];
  const modules = parseVerilogModules(source);
  if (new Set(modules).size !== modules.length) {
    errors.push({ message: '存在重复的模块定义', detail: '同一文件内定义了同名模块' });
  }
  const defined = new Set(modules);
  for (const inst of parseVerilogInstances(source)) {
    if (!defined.has(inst)) {
      errors.push({
        message: `模块 ${inst} 未定义`,
        detail: `实例引用了模块 ${inst}，但工作区内没有它的定义文件`,
      });
    }
  }
  return errors;
}
