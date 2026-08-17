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
 * Compile Verilog source code to a DigitalJS circuit JSON.
 * Clears Yosys state between calls to allow multiple compilations.
 */
export async function compileVerilog(verilogCode: string) {
  const mod = await initYosys();
  const FS = mod.FS;

  const filename = '/input.v';
  const scriptFile = '/script.ys';
  const jsonFile = '/output.json';

  FS.writeFile(filename, verilogCode);

  // design -reset ensures clean state for re-imports
  const script = [
    'design -reset',
    'read_verilog ' + filename,
    'hierarchy -auto-top',
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

  try {
    mod.callMain([scriptFile]);
  } catch (err: any) {
    throw new Error('Yosys compilation failed: ' + (err.message || String(err)));
  }

  const jsonStr = FS.readFile(jsonFile, { encoding: 'utf8' }) as string;

  // Cleanup temp files
  try { FS.unlink(filename); } catch {}
  try { FS.unlink(scriptFile); } catch {}
  try { FS.unlink(jsonFile); } catch {}

  const yosysOutput = JSON.parse(jsonStr);
  if (!yosysOutput.modules || Object.keys(yosysOutput.modules).length === 0) {
    throw new Error('No modules found in the Verilog source. Check the syntax.');
  }

  const digitaljsCircuit = yosys2digitaljs(yosysOutput, { propagation: 1 });
  io_ui(digitaljsCircuit);
  return digitaljsCircuit;
}