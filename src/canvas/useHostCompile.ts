// 编译管线 hook —— useCompilePipeline 的宿主推送版（片 5「全面原生」后的电路视图残体）。
//
// 与旧管线的差别：
//  · 文件闭包不再从 fileStore 解析依赖 —— 宿主推送的 compile 单里 `files` 就是全量闭包
//    （extension/src/compilePanel.ts 已算好），topModule 也由宿主定根；
//  · 结果不再写回 fileStore，而是留在本 hook 状态里直接喂 <Canvas>；
//  · 问题/日志的出口只剩 workbench：host.publishProblems / host.appendOutput（旧 OutputPanel 已退役）；
//  · MissingModulesError 不再弹对话框：每个缺失模块转成一条 error Problem，
//    引导用户在工作区补源文件（保存后由宿主 autoRecompile 重推）。
import { useCallback, useRef, useState } from 'react';
import {
  compileVerilog, MissingModulesError, YosysCompileError, validateModuleInterfaces,
} from '../lib/verilog';
import { hostFire, type ProblemItem } from '../lib/host/host';

/** 宿主推送的编译单（extension/src/compilePanel.ts CompileJob 的形状） */
export interface CompileJob {
  files: { name: string; content: string }[];
  topModule: string;
  entryName: string;
  /** R152：宿主侧绑定解析失败清单（未录入 / 解不到 / `.djs` 转换失败）——有则编译拦下 */
  bindingErrors?: string[];
  /** 诊断锚点：与 bindingErrors 逐条平行的行号落点（缺失绑定的部件在宿主源文件里的 1-based 行）。
   *  用户裁决（2026-10-17）：BUG 报错要锚在出错的部件所在行，⛔ 全部糊到入口文件第 1 行。 */
  bindingAnchors?: Array<{ file: string; line: number | null }>;
}

export function useHostCompile() {
  const [compiling, setCompiling] = useState(false);
  const [circuitJson, setCircuitJson] = useState<Record<string, unknown> | null>(null);
  const [srcFileMap, setSrcFileMap] = useState<Record<string, string>>({});
  const [netlistVerilog, setNetlistVerilog] = useState<string | null>(null);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [yosysLog, setYosysLog] = useState('');
  // 乱序防护：yosys 是单例主线程跑的，但连点两次编译（宿主 autoRecompile + 手动）时
  // 旧的那份慢返回不许盖掉新的结果 —— 只认最后一次发起。
  const seqRef = useRef(0);

  const compile = useCallback(async (job: CompileJob, fallbackTopModule?: string) => {
    const mySeq = ++seqRef.current;
    setCompiling(true);
    setProblems([]);
    const fileList = job.files.map((f) => ({ name: f.name, content: f.content }));
    const topModule = job.topModule || fallbackTopModule || undefined;
    setYosysLog(`Compiling '${topModule || job.entryName}' with ${fileList.length} file(s)...\n`);

    // R152 绑定权威：宿主侧绑定解析失败（未录入 / 解不到 / `.djs` 转换失败）⇒ 直接拦下、发 Problems，
    // 不再走接口预检（否则同一缺失模块会二次报"未定义"）。这是"配置里没有就不能编译"的编译侧落点。
    const bindingErrors = job.bindingErrors || [];
    if (bindingErrors.length > 0) {
      const anchors = job.bindingAnchors || [];
      const parsed: ProblemItem[] = bindingErrors.map((message, i) => ({
        fileName: anchors[i]?.file || job.entryName,
        line: anchors[i]?.line ?? null,
        message,
        severity: 'error' as const,
      }));
      setProblems(parsed);
      hostFire('Failed to publish problems', (h) => h.publishProblems(parsed));
      setYosysLog((prev) => prev + '\n' + bindingErrors.map((m) => `[Error] ${m}`).join('\n') + '\n');
      // R160（批1问题N）：编译拦下＝画布⛔ 再挂上一轮的旧图（真机实锤：broken.v 报错，
      //   画布仍显 top.v 的电路＝"这破图是 broken.v 的？"误导）。与 catch 支同形清台。
      setCircuitJson(null); setSrcFileMap({}); setNetlistVerilog(null);
      setCompiling(false);
      return;
    }

    // 接口预检（与旧 useCompilePipeline 同形同话术）：行号用 validator 的结构化字段，
    // 给不出行的文件级错误就明确不跳（ProblemItem.line=null）。
    const validationErrors = validateModuleInterfaces(fileList);
    if (validationErrors.length > 0) {
      let log = '========== Module Interface Validation Errors ==========\n\n';
      for (const err of validationErrors) {
        log += `[Error] ${err.message}\n  File: ${err.fileName}\n`;
        if (err.instanceName) log += `  Instance: ${err.instanceName}\n`;
        log += `  Module: ${err.moduleName}\n  Detail: ${err.detail}\n\n`;
      }
      log += `Total: ${validationErrors.length} error(s).\n========================================================\n`;
      const parsed: ProblemItem[] = validationErrors.map((err) => ({
        fileName: err.fileName,
        line: err.line,
        message: err.message,
        severity: 'error' as const,
      }));
      setProblems(parsed);
      hostFire('Failed to publish problems', (h) => h.publishProblems(parsed));
      setYosysLog((prev) => prev + '\n' + log);
      hostFire('Failed to append output', (h) => h.appendOutput(log));
      setCircuitJson(null); setSrcFileMap({}); setNetlistVerilog(null);   // R160 问题N：同上，拦下即清台
      setCompiling(false);
      return;
    }

    try {
      const result = await compileVerilog(fileList, topModule);
      if (mySeq !== seqRef.current) return;
      setCircuitJson(result.circuitJson);
      setSrcFileMap(result.srcFileMap ?? {});
      setNetlistVerilog(result.netlistVerilog);
      setYosysLog((prev) => prev + '\n' + result.yosysLog);
      hostFire('Failed to append output', (h) => h.appendOutput(result.yosysLog));
      if (result.netConflicts?.length) {
        // 多驱动冲突：已剥掉多余驱动照常出图，但必须说出来（行号给不出就 null）
        const parsed: ProblemItem[] = result.netConflicts.map((c) => ({
          fileName: c.module, line: null, severity: 'warning' as const,
          message: `net「${c.net}」有 ${c.drivers.length} 个驱动（${c.drivers.join(' + ')}），已保留 ${c.drivers[0]}，其余驱动未画入`,
        }));
        setProblems(parsed);
        hostFire('Failed to publish problems', (h) => h.publishProblems(parsed));
      } else {
        setProblems([]);
        // R160（批1问题K）：⛔ 只清本地 state——上送空清单才会踢宿主 diag().clear()，
        //   否则上一轮编译的错误永远挂在 Problems（真机实锤：画布已出新图，面板仍挂旧错）。
        hostFire('Failed to publish problems', (h) => h.publishProblems([]));
      }
      setCompiling(false);
    } catch (err: any) {
      if (mySeq !== seqRef.current) return;
      const log = err instanceof MissingModulesError ? err.yosysLog
        : err instanceof YosysCompileError ? err.yosysLog
        : String(err?.message || err || '');
      const parsed: ProblemItem[] = err instanceof MissingModulesError
        ? err.missingModules.map((m) => ({
            fileName: job.entryName, line: null, severity: 'error' as const,
            message: `缺少子模块 ${m}：在工作区补一个定义它的 .v 再保存`,
          }))
        : [{
            fileName: job.entryName, line: null, severity: 'error' as const,
            message: err?.message || '编译失败',
          }];
      setProblems(parsed);
      hostFire('Failed to publish problems', (h) => h.publishProblems(parsed));
      setYosysLog((prev) => prev + '\n' + (log || 'Unknown error'));
      hostFire('Failed to append output', (h) => h.appendOutput(log || 'Unknown error'));
      setCircuitJson(null);
      setSrcFileMap({});
      setNetlistVerilog(null);
      setCompiling(false);
    }
  }, []);

  return { compiling, circuitJson, srcFileMap, netlistVerilog, problems, yosysLog, compile };
}
