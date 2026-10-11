import { yosys2digitaljs, io_ui } from 'yosys2digitaljs/core';
import { normalizeIoLabels, renameAutoCells, assignAutoNetNames } from './verilogCircuit';
import { parseVerilogModules, parseVerilogInstances, validateModuleInterfaces, stripBom, parseInstantiations, type ValidationError } from './verilogParse';
import { findNetConflicts, stripExtraDrivers, normalizeStdDffCells, conflictText, PORT_DRIVER_PREFIX, type NetConflict } from './verilogConflicts';
// parse 域与冲突域已分离（卷三十三）；re-export 保持既有 import 路径兼容。
export { parseVerilogModules, parseVerilogInstances, validateModuleInterfaces, type ValidationError };
export { findNetConflicts, stripExtraDrivers, normalizeStdDffCells, type NetConflict };
// 电路后处理域已分离至 verilogCircuit.ts；此处 re-export 保持既有 import 路径兼容。
export { normalizeIoLabels, renameAutoCells, assignAutoNetNames };

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