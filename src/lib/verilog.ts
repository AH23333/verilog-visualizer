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
  circuitJson: any;
  yosysLog: string;
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
function parseInstantiations(source: string): InstanceInfo[] {
  const definedModules = new Set(parseVerilogModules(source));
  const primitives = new Set([
    'and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf', 'bufif0', 'bufif1',
    'notif0', 'notif1', 'dff', 'dffs', 'dffe', 'dlatch',
    'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'assign',
    'always', 'initial', 'if', 'else', 'case', 'endcase', 'begin', 'end',
    'posedge', 'negedge', 'parameter', 'localparam', 'function', 'endfunction',
    'task', 'endtask', 'generate', 'endgenerate', 'for', 'while', 'integer',
    'signed', 'supply0', 'supply1', 'genvar',
  ]);

  const instances: InstanceInfo[] = [];

  // Remove comments first
  let cleaned = source
    .replace(/\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  // Collapse whitespace for easier matching
  cleaned = cleaned.replace(/\s+/g, ' ');

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

    // Calculate approximate line number in original source
    const beforeMatch = cleaned.substring(0, match.index);
    const lineNum = beforeMatch.split(' ').length > 0 ? 1 : 1;
    // Use a rough estimate: count newlines in original source up to the module name position
    const origIdx = source.indexOf(moduleName);
    const origLineNum = origIdx >= 0 ? source.substring(0, origIdx).split('\n').length : 1;

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
  for (let i = 0; i < files.length; i++) {
    const fp = `/input_${i}.v`;
    FS.writeFile(fp, files[i].content);
    filePaths.push(fp);
  }

  const scriptFile = '/script.ys';
  const jsonFile = '/output.json';

  // Build Yosys script: read all files, then synthesize
  const readCmds = filePaths.map((fp) => `read_verilog ${fp}`).join('\n');
  const hierarchyCmd = topModule
    ? `hierarchy -top ${topModule}`
    : 'hierarchy -auto-top';
  const script = [
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
  ].join('\n');

  FS.writeFile(scriptFile, script);

  // Run Yosys
  try {
    mod.callMain([scriptFile]);
  } catch (err: any) {
    const fullLog = logLines.join('\n');
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

  // Cleanup temp files
  try {
    for (const fp of filePaths) { FS.unlink(fp); }
    FS.unlink(scriptFile);
    FS.unlink(jsonFile);
  } catch {}

  const yosysOutput = JSON.parse(jsonStr);
  if (!yosysOutput.modules || Object.keys(yosysOutput.modules).length === 0) {
    throw new YosysCompileError('No modules found in the Verilog source. Check the syntax.', fullLog);
  }

  const digitaljsCircuit = yosys2digitaljs(yosysOutput, { propagation: 1 });
  io_ui(digitaljsCircuit);
  return { circuitJson: digitaljsCircuit, yosysLog: fullLog };
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