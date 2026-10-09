import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';

declare global {
  interface Window {
    Yosys: (opts?: any) => Promise<YosysModule>;
  }
}

interface YosysModule {
  FS: EmscriptenFS;
  callMain(args: string[]): void;
  [key: string]: any;
}

interface EmscriptenFS {
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string, opts?: { encoding?: string }): string | Uint8Array;
  readdir(path: string): string[];
  unlink(path: string): void;
}

/** Result of a successful compilation */
export interface CompileResult {
  circuitJson: Record<string, unknown>;
  yosysLog: string;
  /** Synthesized gate-level netlist from `write_verilog` (null if unavailable) */
  netlistVerilog: string | null;
  /** Raw yosys write_json output (cached for future signal-tracing / goto-def features) */
  yosysJson: any;
  /** Maps the synthesis FS path (e.g. '/input_0.v') used inside source_positions back to the real file name */
  srcFileMap: Record<string, string>;
  /** 多驱动冲突：已剥掉多余驱动照常出图的那些，UI 要作为告警报出来 */
  netConflicts: NetConflict[];
}

/** Error thrown when Yosys compilation fails due to missing modules */
export class MissingModulesError extends Error {
  public missingModules: string[];
  public yosysLog: string;

  constructor(missingModules: string[], yosysLog: string) {
    const names = missingModules.map((m) => `'${m}'`).join(', ');
    super(`Missing module implementations: ${names}. Please import the files that define these modules.`);
    this.name = 'MissingModulesError';
    this.missingModules = missingModules;
    this.yosysLog = yosysLog;
  }
}

/** Error thrown when Yosys compilation fails (includes full log) */
export class YosysCompileError extends Error {
  public yosysLog: string;

  constructor(message: string, yosysLog: string) {
    super(message);
    this.name = 'YosysCompileError';
    this.yosysLog = yosysLog;
  }
}

let yosysModule: YosysModule | null = null;
let initPromise: Promise<YosysModule> | null = null;
export async function initYosys(): Promise<YosysModule> {
  if (yosysModule) return yosysModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (typeof window.Yosys !== 'function') {
      throw new Error('window.Yosys is not available. Ensure yosys.browser.js is loaded.');
    }
    const mod = await window.Yosys({
      noInitialRun: true,
      locateFile: (path: string) => '/yosys/' + path,
    });
    if (!mod.FS) {
      throw new Error('Yosys FS not available');
    }
    yosysModule = mod;
    return mod;
  })();

  return initPromise;
}

/**
 * Parse Verilog source to extract module names.
 * Returns deduplicated array of module names found in the source.
 */
export function parseVerilogModules(source: string): string[] {
  const modules: string[] = [];
  // Match: module name (params) (ports) ; ... endmodule
  // Also match: module name #(params) (ports) ;
  const pattern = /^\s*module\s+(\w+)\s*[#(;]/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    modules.push(match[1]);
  }
  return [...new Set(modules)];
}

/**
 * Parse Verilog source to extract module instantiations.
 * Returns deduplicated array of module names that are instantiated (not defined).
 * Handles multi-line instantiations, parameterized modules, and nested parentheses.
 */
export function parseVerilogInstances(source: string): string[] {
  const definedModules = new Set(parseVerilogModules(source));
  const instances: string[] = [];

  // Primitives and keywords to skip
  const primitives = new Set([
    'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
    'notif0', 'notif1', 'dff', 'dffs', 'dffe', 'dlatch', 'adffe', 'add', 'sub',
    'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'assign',
    'always', 'initial', 'if', 'else', 'case', 'endcase', 'begin', 'end',
    'posedge', 'negedge', 'parameter', 'localparam', 'function', 'endfunction',
    'task', 'endtask', 'generate', 'endgenerate', 'for', 'while', 'integer',
    'signed', 'supply0', 'supply1', 'tri', 'tri0', 'tri1', 'wand', 'wor',
    'specify', 'endspecify', 'defparam', 'genvar',
  ]);

  // Step 1: Remove comments to avoid false matches
  let cleaned = source
    .replace(/\/\/.*$/gm, ' ')           // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ');  // multi-line comments

  // Step 2: Collapse whitespace (but preserve structure)
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Step 3: Match module instantiations
  // Pattern: module_name [optional #(...params)] instance_name (...ports)
  // We use a more flexible approach: match identifier pairs that look like instantiations
  // First, find all positions where an identifier is followed by another identifier and then (
  const instPattern = /(\w+)\s+(?:#\s*\([^)]*(?:\([^)]*\)[^)]*)*\)\s+)?(\w+)\s*\(/g;
  let match;
  while ((match = instPattern.exec(cleaned)) !== null) {
    const moduleName = match[1];
    if (!primitives.has(moduleName.toLowerCase()) && !definedModules.has(moduleName)) {
      instances.push(moduleName);
    }
  }

  // Step 4: Also try original source for multi-line instantiations
  // The cleaned version may have collapsed lines that were multi-line instantiations
  // We scan the original source line-by-line for module_name instance_name patterns
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\/\/.*$/, '').trim();
    if (!line) continue;

    // Match: module_name instance_name ( or module_name #(...) instance_name (
    // Handle multiple lines: if line ends with a module name, next line might be the instance
    const inlineMatch = line.match(/^\s*(\w+)\s+(?:#\s*\(.*\)\s+)?(\w+)\s*\(/);
    if (inlineMatch) {
      const moduleName = inlineMatch[1];
      if (!primitives.has(moduleName.toLowerCase()) && !definedModules.has(moduleName)) {
        instances.push(moduleName);
      }
    } else {
      // Check if this line is just a module name (continuation on next line)
      const soloModule = line.match(/^\s*(\w+)\s*$/);
      if (soloModule && i + 1 < lines.length) {
        const moduleName = soloModule[1];
        if (!primitives.has(moduleName.toLowerCase()) && !definedModules.has(moduleName)) {
          const nextLine = lines[i + 1].replace(/\/\/.*$/, '').trim();
          // Check if next line looks like an instance declaration
          if (nextLine.match(/^\s*(?:#\s*\(.*\)\s+)?(\w+)\s*\(/)) {
            instances.push(moduleName);
          }
        }
      }
    }
  }

  return [...new Set(instances)];
}

// ============ Port Interface Validation ============

/** Information about a single port */
interface PortInfo {
  name: string;
  direction: 'input' | 'output' | 'inout';
  width: number; // bit width (1 for scalar)
  isSigned: boolean;
}

/** Information about a module definition */
interface ModuleDefInfo {
  name: string;
  ports: PortInfo[];
  fileName: string;
}

/** Information about a port connection in an instantiation */
interface PortConnection {
  portName: string;
  connectedExpr: string;
}

/** Information about a module instantiation */
interface InstanceInfo {
  instanceName: string;
  moduleName: string;
  ports: PortConnection[];
  fileName: string;
  lineNumber: number;
}

/** A validation error */
export interface ValidationError {
  message: string;
  fileName: string;
  moduleName: string;
  instanceName: string;
  detail: string;
  /**
   * 这条错误在源码里的 1 起行号。**结构化**字段，不再要消费方从 `detail` 文案里正则回捞
   * （旧形状下四条同模块实例全显示第 8 行，见 r80 读数）。文件级错误（重复定义）给不出
   * 具体行 ⇒ 明确 `null`，不许塞个 1 冒充"就在第一行"。
   */
  line: number | null;
}

/**
 * Parse port declarations from a module definition.
 * Handles both ANSI-style (inline) and non-ANSI-style port declarations.
 */
function parseModulePorts(source: string): Map<string, ModuleDefInfo> {
  const modules = new Map<string, ModuleDefInfo>();

  // Match module definitions with ANSI-style ports:
  // module name (input [width] port1, output [width] port2, ...);
  const modulePattern = /^\s*module\s+(\w+)\s*(?:#\s*\([^)]*\)\s*)?\(([\s\S]*?)\)\s*;/gm;
  let match;

  while ((match = modulePattern.exec(source)) !== null) {
    const moduleName = match[1];
    const portList = match[2];
    const ports: PortInfo[] = [];

    // Parse each port declaration: direction [width] name
    // Patterns: input [7:0] clk, output reg [3:0] result, input rst_n, etc.
    // Also handles: input [WIDTH-1:0] data, output [N:0] addr
    const portPattern = /(input|output|inout)\s+(?:reg\s+|wire\s+|logic\s+)?(?:signed\s+)?(?:\[([^\]]+)\s*:\s*([^\]]+)\]\s+)?(\w+)/gi;
    let portMatch;

    while ((portMatch = portPattern.exec(portList)) !== null) {
      const direction = portMatch[1].toLowerCase() as 'input' | 'output' | 'inout';
      const msbStr = portMatch[2] || undefined;
      const lsbStr = portMatch[3] || undefined;
      // Group 4 is always the port name
      const name = portMatch[4];

      // Attempt to determine width: if both msb/lsb are numeric, compute width
      const msbNum = msbStr ? parseInt(msbStr, 10) : NaN;
      const lsbNum = lsbStr ? parseInt(lsbStr, 10) : NaN;
      const width = (!isNaN(msbNum) && !isNaN(lsbNum)) ? Math.abs(msbNum - lsbNum) + 1 : 1;
      const isSigned = /signed/i.test(portMatch[0]);

      ports.push({ name, direction, width, isSigned });
    }

    modules.set(moduleName, { name: moduleName, ports, fileName: '' });
  }

  return modules;
}

/**
 * Parse module instantiations with their port connections from a Verilog source.
 * Returns InstanceInfo for each non-primitive, non-self-defined instantiation.
 */
/**
 * 一遍扫描：去掉注释、把连续空白折成一个空格，并产出 `srcIdx` ——
 * `srcIdx[i]` = 折叠后第 i 个字符在**原源码**里的下标。
 *
 * 有了这张表，任何在折叠文本上的匹配位置都能换算回真实的行列，
 * 不必再用 `indexOf(模块名)` 这种"只能命中第一处"的估法。
 */
function cleanVerilogWithMap(source: string): { text: string; srcIdx: number[] } {
  let out = '';
  const srcIdx: number[] = [];
  let i = 0;
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  while (i < source.length) {
    const two = source.substr(i, 2);
    if (two === '//') {                            // 行注释：整段丢到行尾（换行留给下面折叠）
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {                            // 块注释：连内容一起丢
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (isSpace(source[i])) {                      // 连续空白 → 一个空格，映射指向这段空白起点
      const start = i;
      while (i < source.length && isSpace(source[i])) i++;
      out += ' '; srcIdx.push(start);
      continue;
    }
    out += source[i]; srcIdx.push(i);
    i++;
  }
  return { text: out, srcIdx };
}

/** 源码下标 → 1 起的行号 */
function lineAt(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

function parseInstantiations(source: string): InstanceInfo[] {
  const definedModules = new Set(parseVerilogModules(source));
  const primitives = new Set([
    'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
    'notif0', 'notif1',
    // ⚠ 这里刻意**不列** dff / dffe / dffs / dlatch / adffe：IEEE 1364 没有这些原语，
    // yosys 也不认（除非用户自己 `primitive dff(...)` 声明）。把它们当原语跳过，
    // 门级网表里的未声明单元就会一路走到 callMain，撞成不可捕获的 wasm abort。
    'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'assign',
    'always', 'initial', 'if', 'else', 'case', 'endcase', 'begin', 'end',
    'posedge', 'negedge', 'parameter', 'localparam', 'function', 'endfunction',
    'task', 'endtask', 'generate', 'endgenerate', 'for', 'while', 'integer',
    'signed', 'supply0', 'supply1', 'genvar',
  ]);

  const instances: InstanceInfo[] = [];

  // 去注释 + 折叠空白，但**同时记下每个字符来自源码的哪个下标**。
  // 为什么不能再像以前那样只留一个字符串：实例正则是在折叠过的文本上 exec 的，
  // `match.index` 于是回不到源码 ⇒ 旧实现只能 `source.indexOf(moduleName)` 估行，
  // 同一个模块的多个实例必然拿到**同一个行号**（r80 实测：test_counter.v 四条
  // "模块 dff 未定义"全显示第 8 行，而 d0-d3 真身在 8/9/10/11 行）。
  const { text: cleaned, srcIdx } = cleanVerilogWithMap(source);

  // Match: module_name instance_name ( .port1(expr1), .port2(expr2) );
  // Also handles: module_name #(.param(val)) instance_name ( .port1(expr1) );
  // Use a more flexible pattern that doesn't require ^
  const instPattern = /(\w+)\s+(?:#\s*\([^)]*(?:\([^)]*\)[^)]*)*\)\s+)?(\w+)\s*\(([\s\S]*?)\)\s*;/g;
  let match;

  while ((match = instPattern.exec(cleaned)) !== null) {
    const moduleName = match[1];
    const instanceName = match[2];
    const portList = match[3];

    if (primitives.has(moduleName.toLowerCase()) || definedModules.has(moduleName)) {
      continue;
    }

    const ports: PortConnection[] = [];

    // Parse port connections: .portName(expr), .portName(expr)
    // Handle nested parens in expressions like .port(func(a, b))
    const portConnPattern = /\.(\w+)\s*\(\s*/g;
    let connMatch;

    while ((connMatch = portConnPattern.exec(portList)) !== null) {
      const portName = connMatch[1];
      const startIdx = connMatch.index + connMatch[0].length;
      let depth = 1;
      let endIdx = startIdx;

      // Find matching closing paren
      while (endIdx < portList.length && depth > 0) {
        if (portList[endIdx] === '(') depth++;
        else if (portList[endIdx] === ')') depth--;
        endIdx++;
      }

      const connectedExpr = portList.slice(startIdx, endIdx - 1).trim();
      ports.push({ portName, connectedExpr });
    }

    // 行号：拿**这次匹配**在折叠文本里的起点，经 srcIdx 换算回源码，再数换行符。
    // 正则的第一个捕获组就是模块名、且它总是出现在 match[0] 开头，所以 match.index 直接可用。
    const srcPos = srcIdx[match.index] ?? 0;
    const origLineNum = lineAt(source, srcPos);

    instances.push({
      instanceName,
      moduleName,
      ports,
      fileName: '',
      lineNumber: origLineNum,
    });
  }

  return instances;
}

/**
 * Validate module interfaces before compilation.
 * Checks that instantiated modules have matching port declarations.
 * Returns array of validation errors (empty if valid).
 */
export function validateModuleInterfaces(
  files: { name: string; content: string }[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Step 1: Collect all module definitions across all files
  const allModules = new Map<string, ModuleDefInfo>();
  for (const file of files) {
    const modules = parseModulePorts(file.content);
    for (const [name, info] of modules) {
      info.fileName = file.name;
      // Merge: if module already defined (duplicate), warn
      if (allModules.has(name)) {
        errors.push({
          message: `模块 '${name}' 在多个文件中重复定义`,
          fileName: file.name,
          moduleName: name,
          instanceName: '',
          line: null,
          detail: `模块 '${name}' 已在文件 '${allModules.get(name)!.fileName}' 中定义，在文件 '${file.name}' 中重复定义`,
        });
      } else {
        allModules.set(name, { ...info, fileName: file.name });
      }
    }
  }

  // Step 2: Parse all instantiations and validate
  for (const file of files) {
    const instances = parseInstantiations(file.content);

    for (const inst of instances) {
      const def = allModules.get(inst.moduleName);

      if (!def) {
        // Module definition not found in any file
        errors.push({
          message: `模块 '${inst.moduleName}' 未定义`,
          fileName: file.name,
          moduleName: inst.moduleName,
          instanceName: inst.instanceName,
          line: inst.lineNumber,
          detail: `实例 '${inst.instanceName}' (第${inst.lineNumber}行) 引用了模块 '${inst.moduleName}'，但该模块未在任何已导入文件中定义。请导入定义该模块的文件或手动绑定。`,
        });
        continue;
      }

      // Check port connections
      const defPortNames = new Set(def.ports.map((p) => p.name));
      const instPortNames = new Set(inst.ports.map((p) => p.portName));

      // Check for connected ports that don't exist in definition
      for (const conn of inst.ports) {
        if (!defPortNames.has(conn.portName)) {
          errors.push({
            message: `端口 '${conn.portName}' 在模块 '${inst.moduleName}' 中不存在`,
            fileName: file.name,
            moduleName: inst.moduleName,
            instanceName: inst.instanceName,
            line: inst.lineNumber,
            detail: `实例 '${inst.instanceName}' (第${inst.lineNumber}行) 连接了端口 '${conn.portName}'，但模块 '${inst.moduleName}' (定义于 '${def.fileName}') 没有此端口。可用端口: ${def.ports.map((p) => p.name).join(', ')}`,
          });
        }
      }

      // Check for required ports that are not connected
      if (def.ports.length > 0 && inst.ports.length > 0) {
        for (const defPort of def.ports) {
          if (!instPortNames.has(defPort.name)) {
            errors.push({
              message: `端口 '${defPort.name}' 未连接`,
              fileName: file.name,
              moduleName: inst.moduleName,
              instanceName: inst.instanceName,
              line: inst.lineNumber,
              detail: `实例 '${inst.instanceName}' (第${inst.lineNumber}行) 未连接模块 '${inst.moduleName}' 的端口 '${defPort.name}' (${defPort.direction}, ${defPort.width}位)。请添加 .${defPort.name}(signal) 连接。`,
            });
          }
        }
      }

      // Check port width compatibility (basic check)
      for (const conn of inst.ports) {
        const defPort = def.ports.find((p) => p.name === conn.portName);
        if (defPort) {
          // Try to detect width of the connected expression
          const exprWidth = estimateExpressionWidth(conn.connectedExpr);
          if (exprWidth > 0 && defPort.width > 1 && exprWidth !== defPort.width) {
            errors.push({
              message: `端口 '${conn.portName}' 宽度不匹配`,
              fileName: file.name,
              moduleName: inst.moduleName,
              instanceName: inst.instanceName,
              line: inst.lineNumber,
              detail: `实例 '${inst.instanceName}' (第${inst.lineNumber}行) 端口 '${conn.portName}' 宽度不匹配: 模块 ${inst.moduleName} 期望 ${defPort.width}位，实际连接表达式宽度为 ${exprWidth}位`,
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Estimate the bit width of a Verilog expression.
 * Returns 0 if unable to determine.
 */
function estimateExpressionWidth(expr: string): number {
  if (!expr) return 0;

  // Handle concatenation: {a, b, c}
  if (expr.startsWith('{') && expr.endsWith('}')) {
    const inner = expr.slice(1, -1);
    const parts = inner.split(',').map((s) => s.trim());
    let total = 0;
    for (const part of parts) {
      const w = estimateExpressionWidth(part);
      if (w === 0) return 0;
      total += w;
    }
    return total;
  }

  // Handle replication: {N{expr}}
  const replMatch = expr.match(/^\s*\{(\d+)\s*\{/);
  if (replMatch) {
    return parseInt(replMatch[1], 10);
  }

  // Handle bit select: expr[msb:lsb] or expr[bit]
  const selMatch = expr.match(/\[(\d+)\s*:\s*(\d+)\]$/);
  if (selMatch) {
    return Math.abs(parseInt(selMatch[1], 10) - parseInt(selMatch[2], 10)) + 1;
  }

  // Handle single bit select: expr[N]
  const bitMatch = expr.match(/\[(\d+)\]$/);
  if (bitMatch) {
    return 1;
  }

  // Handle numeric literals: N'b..., N'd..., N'h...
  const numMatch = expr.match(/^\s*(\d+)\s*'/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  // Handle constants: 1'b0, 1'b1
  if (/^\s*1\s*'\s*b[01]\s*$/.test(expr)) return 1;

  // Unknown: return 0
  return 0;
}

/**
 * After io_ui(), top-level Input/Output ports become interactive cells
 * (Button/Clock for inputs, Lamp/NumDisplay for outputs) but their `label`
 * falls back to the auto-generated device key (`dev0`, `dev13`, …), which is
 * meaningless on the canvas. This pass rewrites those labels to the actual
 * port/net name (clk, reset, count) so the diagram reads like a real schematic.
 *
 * BusGroup devices (multi-bit output aggregates) get their label from the
 * first named connector touching them. Display-only: device keys and the
 * source-position jump chain are untouched.
 */
export function normalizeIoLabels(circuit: any): void {
  if (!circuit) return;

  const IO_TYPES = new Set(['Button', 'Clock', 'Lamp', 'NumDisplay', 'Input', 'Output']);

  // Build a lookup: which connector names touch each device id (for BusGroup).
  const connNameByDevId: Record<string, string> = {};
  if (Array.isArray(circuit.connectors)) {
    for (const conn of circuit.connectors) {
      const name = conn?.name || conn?.netname;
      if (!name) continue;
      for (const end of [conn?.from, conn?.to]) {
        const id = end?.id;
        if (id && !connNameByDevId[id]) connNameByDevId[id] = String(name);
      }
    }
  }

  if (circuit.devices && typeof circuit.devices === 'object') {
    for (const [devKey, device] of Object.entries<any>(circuit.devices)) {
      const d: any = device;
      const type = d?.type;
      if (!type) continue;

      // 1) Single-bit IO cells: the SVG `<text>` under the cell defaults to the
      // auto id (dev0/dev1). Rewrite it to the port/net name so the schematic
      // reads clk/reset instead of dev0. device.label alone is ignored by
      // digitaljs's cell fromJSON — must patch attrs.label.text directly.
      if (IO_TYPES.has(type)) {
        const human = d.net || d.name || connNameByDevId[devKey];
        if (human) {
          d.label = String(human);
          if (d.attrs?.label?.text !== undefined) d.attrs.label.text = String(human);
        }
        continue;
      }

      // 2) BusGroup (multi-bit display): rewrite the auto-id label to the net name.
      if (type === 'BusGroup' || type === 'bus') {
        const human = d.net || connNameByDevId[devKey];
        if (human) {
          d.label = String(human);
          if (d.attrs?.label?.text !== undefined) d.attrs.label.text = String(human);
        }
      }
    }
  }

  // Recurse into subcircuits (drill-down views re-run io_ui themselves).
  if (circuit.subcircuits) {
    for (const sub of Object.values(circuit.subcircuits)) {
      normalizeIoLabels(sub);
    }
  }
}

/**
 * Rename auto-generated Yosys cells (e.g. "$auto$ff.cc:266:slice$781")
 * to clean, human-readable names based on cell type.
 * Preserves user-defined names (those not starting with $).
 */
export function renameAutoCells(circuit: any): void {
  if (!circuit) return;

  // Map Yosys cell type prefixes to clean display names
  const typeNameMap: Record<string, string> = {
    // Combinational
    '$and':   'AND',
    '$or':    'OR',
    '$xor':   'XOR',
    '$not':   'NOT',
    '$nand':  'NAND',
    '$nor':   'NOR',
    '$xnor':  'XNOR',
    '$mux':   'MUX',
    '$pmux':  'PMUX',
    '$tribuf': 'TRI',
    '$lut':   'LUT',
    // Arithmetic
    '$add':   'ADDER',
    '$sub':   'SUB',
    '$mul':   'MUL',
    '$div':   'DIV',
    '$mod':   'MOD',
    '$eq':    'EQ',
    '$ne':    'NE',
    '$lt':    'LT',
    '$le':    'LE',
    '$gt':    'GT',
    '$ge':    'GE',
    '$shl':   'SHL',
    '$shr':   'SHR',
    '$sshl':  'SSHL',
    '$sshr':  'SSHR',
    '$neg':   'NEG',
    '$pos':   'POS',
    '$reduce_and': 'RAND',
    '$reduce_or':  'ROR',
    '$reduce_xor': 'RXOR',
    '$reduce_bool': 'RBOOL',
    '$logic_and': 'LAND',
    '$logic_or':  'LOR',
    '$logic_not': 'LNOT',
    // Sequential
    '$dff':   'DFF',
    '$dffe':  'DFFE',
    '$dffsr': 'DFFSR',
    '$sdff':  'SDFF',
    '$dlatch': 'DLATCH',
    '$adff':  'ADFF',
    '$dlatchsr': 'DSR',
    '$sr':    'SR',
    // Memory
    '$mem':   'MEM',
    '$memrd': 'MRD',
    '$memwr': 'MWR',
    // Misc
    '$slice': 'SLICE',
    '$concat': 'CONCAT',
    '$shift': 'SHIFT',
    '$shiftx': 'SHIFTX',
    '$alu':   'ALU',
    '$fa':    'FA',
    '$lcu':   'LCU',
    '$macc':  'MACC',
    '$fsm':   'FSM',
    '$assert': 'ASSERT',
    '$assume': 'ASSUME',
    '$cover':  'COVER',
    '$specify2': 'SPEC2',
    '$specify3': 'SPEC3',
    '$specrule': 'SPECRULE',
    '$initstate': 'INIT',
    '$anyconst': 'ANYC',
    '$anyseq':   'ANYSEQ',
    '$allconst': 'ALLCONST',
    '$allseq':   'ALLSEQ',
    '$equiv':  'EQUIV',
    '$pow':    'POW',
    '$bwmux':  'BWMUX',
    '$bweqx':  'BWEQ',
    '$bwnot':  'BWNOT',
    '$bwand':  'BWAND',
    '$bwor':   'BWOR',
    // Designs
    '$paramod': 'PARAM',
    '$abstract': 'ABS',
    '$techmap':  'TECHMAP',
    '$scopeinfo': 'SCOPE',
  };

  function getBaseFromName(name: string): string {
    // Try to find a known $type within the name
    for (const prefix of Object.keys(typeNameMap)) {
      if (name.includes(prefix)) {
        return prefix;
      }
    }
    // Fallback: try to match generic $xxx pattern
    const match = name.match(/\$(\w+)/);
    return match ? `$${match[1]}` : 'CELL';
  }

  // Process this circuit's devices
  if (circuit.devices && Object.keys(circuit.devices).length > 0) {
    const counters: Record<string, number> = {};
    const renameMap: Record<string, string> = {};

    function makeCleanName(baseType: string): string {
      const display = typeNameMap[baseType] || baseType.replace(/^\$/, '').toUpperCase();
      if (!counters[display]) {
        counters[display] = 0;
      }
      counters[display]++;
      return `${display}_${counters[display]}`;
    }

    // Collect all devices that need renaming by checking device.label
    // (the device key in DigitalJS is generated from the cell TYPE, not the cell name;
    //  the Yosys auto-generated name is stored in device.label)
    for (const [devKey, device] of Object.entries(circuit.devices)) {
      const label = (device as any).label || '';
      // Only rename devices whose label contains Yosys auto-generated patterns
      if (label.includes('$auto') || label.includes('$abc') || label.includes('$techmap')) {
        const baseType = getBaseFromName(label);
        renameMap[devKey] = makeCleanName(baseType);
      }
    }

    if (Object.keys(renameMap).length > 0) {
      // Rename device keys and update labels
      const newDevices: Record<string, any> = {};
      for (const [oldKey, device] of Object.entries(circuit.devices)) {
        const newKey = renameMap[oldKey] || oldKey;
        newDevices[newKey] = device;
        // Always update the label to the new clean name
        (device as any).label = newKey;
      }
      circuit.devices = newDevices;

      // Rename references in connectors
      if (circuit.connectors) {
        for (const conn of circuit.connectors) {
          if (conn.from && renameMap[conn.from.id]) {
            conn.from.id = renameMap[conn.from.id];
          }
          if (conn.to && renameMap[conn.to.id]) {
            conn.to.id = renameMap[conn.to.id];
          }
        }
      }
    }
  }

  // Always recurse into subcircuits (this is where most devices live in DigitalJS)
  if (circuit.subcircuits) {
    for (const sub of Object.values(circuit.subcircuits)) {
      renameAutoCells(sub as any);
    }
  }

  // Also recurse into cells (nested IO cells)
  if (circuit.cells) {
    for (const cell of Object.values(circuit.cells) as any[]) {
      if (cell && typeof cell === 'object') {
        renameAutoCells(cell);
      }
    }
  }
}

/** 剥 UTF-8 BOM + CRLF 归一（见 compileVerilog 写虚拟文件处的说明） */
function stripBom(text: string): string {
  return String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * Compile all Verilog files together, with optional top-level module override.
 * @param files - All Verilog files to compile
 * @param topModule - Optional top-level module name (uses auto-top if not specified)
 */
export async function compileVerilog(
  files: { name: string; content: string }[],
  topModule?: string
): Promise<CompileResult> {
  if (files.length === 0) {
    throw new YosysCompileError('No Verilog files to compile.', '');
  }

  const mod = await initYosys();
  const FS = mod.FS;

  // Capture Yosys stdout/stderr
  const logLines: string[] = [];
  const origPrint = (mod as any).print;
  const origPrintErr = (mod as any).printErr;
  try {
    (mod as any).print = (msg: string) => { logLines.push(msg); };
    (mod as any).printErr = (msg: string) => { logLines.push(msg); };
  } catch {
    // print/printErr may not be overridable in all builds
  }

  // Write all files to the virtual filesystem
  const filePaths: string[] = [];
  const srcFileMap: Record<string, string> = {};
  for (let i = 0; i < files.length; i++) {
    const fp = `/input_${i}.v`;
    // UTF-8 BOM 会让 yosys-wasm 的 read_verilog 直接抛 emscripten 异常
    // （「Exception catching is disabled, this exception cannot be caught」），
    // 整个编译连一条人话错误都拿不到。Windows 记事本/VSCode 存出来的 .v 常带 BOM，
    // 所以在进综合器之前就剥掉；CRLF 一并归一成 LF。
    FS.writeFile(fp, stripBom(files[i].content));
    filePaths.push(fp);
    srcFileMap[fp] = files[i].name;
  }

  const scriptFile = '/script.ys';
  const jsonFile = '/output.json';
  const netlistFile = '/output_netlist.v';

  // 预检（必须在 callMain 之前）：门级网表常例化一些**没有声明**的单元（`dff d0(...)` 这类
  // UDP / 库单元）。yosys 对它的报错是 C++ 异常，而这份 wasm 构建关了异常捕获 ⇒ 直接 abort，
  // 用户只能看到 "Exception catching is disabled..."（实测 test_counter.v）。
  // 这里用本仓自己的解析器把名字点出来，走既有的 MissingModulesError →「导入源文件 / 绑定」弹窗。
  {
    const declared = new Set<string>();
    for (const f of files) {
      for (const m of parseVerilogModules(f.content)) declared.add(m);
      // UDP 声明（primitive dff(...); endprimitive）也算"有定义"，别误报
      for (const p of f.content.matchAll(/^\s*primitive\s+(\w+)/gm)) declared.add(p[1]);
    }
    const missingUnits = new Set<string>();
    for (const f of files) {
      for (const inst of parseInstantiations(f.content)) {
        if (!declared.has(inst.moduleName)) missingUnits.add(inst.moduleName);
      }
    }
    if (missingUnits.size > 0) throw new MissingModulesError([...missingUnits], '');
  }

  // Build Yosys script。**两套流程**（R116 卷十八裁决）：
  // · 旧流（默认）：proc/opt/fsm/opt/memory/opt/techmap/opt —— 高层算术被裸 techmap 打散成门阵，
  //   signed/fillx/words 不出现在产物里；但与本仓 InputPanel/parity/IO 全链路兼容（全量 63 格的历史基线）。
  // · 官方流（EXPERIMENTAL_FLOW=true，对齐 yosys2digitaljs prepare_yosys_script）：memory -nomap 保
  //   $mem_v2（→ Memory words/offset）、wreduce -memx、不跑 techmap —— 高层器件（Multiplication.signed、
  //   Memory.words）真实进产物（r116 实验闸门已实证）；**已知缺口**：异宽操作数（count+1 → in2:1）
  //   触发 InputPanel 驱动链 setInput 位宽错（r42/r50/r85 红的根因）、同步读 mem 被降级成 FF 海。
  //   缺口清单与修复排期见账本卷十八；修复完才允许把默认切到官方流。
  const readCmds = filePaths.map((fp) => `read_verilog ${fp}`).join('\n');
  const hierarchyCmd = topModule
    ? `hierarchy -top ${topModule}`
    : 'hierarchy -auto-top';
  // 实验开关（编译期常量）：官方流研究/联调用；false = 旧流（与全量闸门基线一致）
  const EXPERIMENTAL_FLOW = false;
  const script = EXPERIMENTAL_FLOW
    ? [
        'design -reset',
        readCmds,
        'setattr -mod -unset top',
        hierarchyCmd,
        'proc',
        'opt_clean',
        'fsm',
        'memory -nomap',
        'wreduce -memx',
        'opt_clean',
        'write_json ' + jsonFile,
        'write_verilog ' + netlistFile,
      ].join('\n')
    : [
        'design -reset',
        readCmds,
        hierarchyCmd,
        'proc',
        'opt',
        'fsm',
        'opt',
        'memory',
        'opt',
        'techmap',
        'opt',
        'write_json ' + jsonFile,
        'write_verilog ' + netlistFile,
      ].join('\n');

  FS.writeFile(scriptFile, script);

  // Run Yosys
  try {
    mod.callMain([scriptFile]);
  } catch (err: any) {
    const fullLog = logLines.join('\n');
    // 门级网表里例化了没随包提供的模块（`dff d0(...)`）时，yosys 抛的是 **C++ 异常**，
    // 而这份 emscripten 构建编译时关了异常捕获 ⇒ callMain 直接 abort，
    // 原始信息只有一句 "Exception catching is disabled, this exception cannot be caught"。
    // 用户看到它既不知道缺哪个模块，也不知道下一步做什么。日志里其实已经打了
    // "Module `dff' referenced in module ... does not exist"，所以这里先按既有解析器
    // 翻成 MissingModulesError（走既有的「绑定/导入源文件」弹窗），解析不出来才回落原文。
    const aborted = /Exception catching is disabled|this exception cannot be caught/i.test(String(err?.message || err));
    const missing = parseMissingModules(fullLog);
    if (missing.length > 0) throw new MissingModulesError(missing, fullLog);
    if (aborted) {
      const errLine = (fullLog.match(/^\s*ERROR:.*$/m) || [''])[0].trim();
      throw new YosysCompileError(
        '综合器在这个文件上异常退出（yosys 的 wasm 构建关掉了 C++ 异常捕获，错误无法原样回传）。'
        + (errLine ? `日志里的最后一条错误：${errLine}` : '日志里没有 ERROR 行，请把这份文件反馈出来。')
        + ' 常见原因是门级网表里例化了没有随包提供的单元（如 dff /Latch 等），把这些源文件一起导入即可。',
        fullLog,
      );
    }
    throw new YosysCompileError('Yosys compilation failed: ' + (err.message || String(err)), fullLog);
  }

  // Restore original print/printErr
  try {
    (mod as any).print = origPrint;
    (mod as any).printErr = origPrintErr;
  } catch {}

  const fullLog = logLines.join('\n');

  // Check if output JSON was created
  let jsonStr: string;
  try {
    jsonStr = FS.readFile(jsonFile, { encoding: 'utf8' }) as string;
  } catch {
    // No output JSON — parse the log for missing modules
    const missing = parseMissingModules(fullLog);
    if (missing.length > 0) {
      throw new MissingModulesError(missing, fullLog);
    }
    throw new YosysCompileError('Yosys compilation failed. No output produced.', fullLog);
  }

  // Synthesized netlist is a bonus artifact — never fail the compile over it
  let netlistVerilog: string | null = null;
  try {
    netlistVerilog = FS.readFile(netlistFile, { encoding: 'utf8' }) as string;
  } catch { /* write_verilog unavailable in this yosys build */ }

  // Cleanup temp files
  try {
    for (const fp of filePaths) { FS.unlink(fp); }
    FS.unlink(scriptFile);
    FS.unlink(jsonFile);
    FS.unlink(netlistFile);
  } catch {}

  const yosysOutput = JSON.parse(jsonStr);
  if (!yosysOutput.modules || Object.keys(yosysOutput.modules).length === 0) {
    throw new YosysCompileError('No modules found in the Verilog source. Check the syntax.', fullLog);
  }

  normalizeStdDffCells(yosysOutput);

  // 多驱动冲突分级（用户裁决）：能命名且能安全摘掉多余驱动 ⇒ 照常出图并把冲突
  // 报成告警；摘不动（驱动挂在顶层端口上）或连 net 名都拿不到 ⇒ 直接拒编译，
  // 说清原因，不再甩一句 yosys2digitaljs 的内部异常。
  const netConflicts = findNetConflicts(yosysOutput);
  let conflictsReported: NetConflict[] = [];
  if (netConflicts.length) {
    const unnamed = netConflicts.filter((c) => !c.net);
    const stripped = unnamed.length ? 0 : stripExtraDrivers(yosysOutput);
    // 复跑一遍：摘完之后还有冲突（例如多余驱动落在摘不掉的 input 端口上）就拒
    const remain = stripped ? findNetConflicts(yosysOutput) : netConflicts;
    const portInvolved = remain.some((c) => c.drivers.some((d) => d.startsWith(PORT_DRIVER_PREFIX)));
    if (remain.length) {
      const why = unnamed.length
        ? `有 ${unnamed.length} 处冲突位连 net 名都没有 —— 手工门级网表的典型特征`
        : portInvolved
          ? '多余驱动挂在顶层输入端口上（多个端口并到同一根线），端口摘不掉'
          : '多余驱动与其它正常位混在同一端口上，摘不掉';
      throw new YosysCompileError(conflictText(netConflicts, why), fullLog);
    }
    conflictsReported = netConflicts;
  }

  // 缺模块时 yosys 不带 `-check`，会把没定义的模块当黑盒留下；转成 digitaljs 时
  // 炸的是 `Invalid cell type: <模块名>` —— 一句实现细节话术，用户看不出「少一个
  // 源文件」，更不会知道去点「绑定」。这里翻成 MissingModulesError，走既有的绑定弹窗。
  let digitaljsCircuit: ReturnType<typeof yosys2digitaljs>;
  try {
    digitaljsCircuit = yosys2digitaljs(yosysOutput, { propagation: 1 });
  } catch (e) {
    // 摘掉多余驱动后仍然转不动（实测：真多驱动网表会踩到 yosys2digitaljs 的
    // assert）—— 不要甩一句 Assertion failed，把冲突清单原样报出去；
    // 同时把上游那句原文带上：没有它，"为什么摘了还转不动"就永远只能靠猜。
    if (netConflicts.length) throw new YosysCompileError(
      conflictText(netConflicts, `且摘除多余驱动后仍无法转换（上游报：${String((e as any)?.message || e).slice(0, 140)}）`),
      fullLog);
    const m = String((e as Error)?.message || e).match(/^Invalid cell type: (\S+)$/);
    const name = m?.[1];
    if (name && !yosysOutput.modules[name]) throw new MissingModulesError([name], fullLog);
    throw e;
  }
  io_ui(digitaljsCircuit);
  // 无名连线补自动名（必须在 io_ui 之后、渲染之前；见函数注释）
  assignAutoNetNames(digitaljsCircuit);
  normalizeIoLabels(digitaljsCircuit);
  renameAutoCells(digitaljsCircuit);
  return { circuitJson: digitaljsCircuit, yosysLog: fullLog, netlistVerilog, yosysJson: yosysOutput, srcFileMap, netConflicts: conflictsReported };
}

/**
 * 给没有名字的连线补一个自动名（N1、N2…），逐层递归到所有子模块体。
 *
 * 为什么必须在编译产物阶段做：digitaljs 的 Wire 只在 `initialize()` 里
 * 判断 `has('netname')` 来决定要不要建标签节点（cells/base.mjs），事后
 * set('netname') 不会凭空长出标签。
 * 沙盒画布之所以每条线都有名字，是因为 loadCells 给无名线补了 N 序号；
 * 编译模式此前不补 ⇒ 内部连线一片空白，两个模式对不上（用户裁决：编译模式
 * 也标自动名）。
 */
export function assignAutoNetNames(circuit: any, counter = { n: 0 }): void {
  if (!circuit || typeof circuit !== 'object') return;
  for (const conn of circuit.connectors || []) {
    if (!conn || typeof conn !== 'object') continue;
    if (!conn.name || !String(conn.name).trim()) conn.name = `N${++counter.n}`;
  }
  for (const sub of Object.values<any>(circuit.subcircuits || {})) assignAutoNetNames(sub, counter);
}

const PORT_DRIVER_PREFIX = '端口 ';

/** 冲突的统一话术：先列是哪几根线、谁在并驱，再说为什么处理不了 */
function conflictText(conflicts: NetConflict[], why: string): string {
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

/**
 * Parse Yosys error output to extract missing module names.
 */
function parseMissingModules(yosysLog: string): string[] {
  const missing = new Set<string>();
  const patterns = [
    /Module `([^`]+)` referenced in module/g,
    /Can't find module `([^`]+)`/gi,
    /Module `([^`]+)` not found/gi,
    /unknown module `([^`]+)`/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(yosysLog)) !== null) {
      missing.add(match[1]);
    }
  }

  return Array.from(missing);
}

/**
 * Compile a single file (backward-compatible convenience wrapper).
 */
export async function compileSingleFile(verilogCode: string): Promise<CompileResult> {
  return compileVerilog([{ name: 'input.v', content: verilogCode }]);
}

/**
 * Build a standalone, renderable + interactive circuit JSON for a sub-module at
 * `path` (e.g. ['half_adder'] or ['cpu','alu']) from the compiled top-level JSON.
 *
 * yosys2digitaljs keeps each instantiated module's body in `subcircuits[name]`
 * with raw Input/Output port cells (io_ui only ran on the top module). Here we
 * clone that body, run io_ui on it (Input→Button, Output→Lamp so it's clickable
 * and self-runs like the top view), and rename auto cells for readable labels.
 * Returns null if any path segment is missing. Empty path returns the top JSON
 * unchanged. Always re-derives from the root so re-drilling is idempotent.
 */
export function buildViewJson(
  circuitJson: Record<string, unknown> | null | undefined,
  path: string[],
): Record<string, unknown> | null {
  if (!circuitJson) return null;
  if (path.length === 0) return circuitJson;
  let cur: any = circuitJson;
  for (const name of path) {
    const sub = cur?.subcircuits?.[name];
    if (!sub || !sub.devices) return null;
    cur = {
      devices: structuredClone(sub.devices),
      connectors: structuredClone(sub.connectors ?? []),
      subcircuits: structuredClone(sub.subcircuits ?? {}),
    };
    try { io_ui(cur); } catch { /* keep raw Input/Output if io_ui rejects */ }
    try { normalizeIoLabels(cur); } catch { /* labels optional */ }
    try { renameAutoCells(cur); } catch { /* labels optional */ }
  }
  return cur as Record<string, unknown>;
}