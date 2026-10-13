// 编译管线 hook —— 从 App.tsx 整体迁出（卷四十 瘦身第四刀，纯搬家零改语义）。
//
// 迁出物：7 个管线状态（status/message/yosysLog/outputPanelVisible/problems/
// missingModules/simPaused）+ resolveDependencies + tryCompileAll。
// App 以同名解构接回 ⇒ **全部 ~40 处setMessage/setStatus 等消费点零改动**；
// tryCompileAll 的 5 个调用方、handleCompile 的 12+ 引用点签名不变。
// simPaused 归入本 hook 的理由：tryCompileAll 成功路径强制 setSimPaused(false)
// （fresh build 起跑），与 Canvas 的 paused prop 是同一条状态线。
import { useState, useCallback } from 'react';
import { compileVerilog, MissingModulesError, YosysCompileError, validateModuleInterfaces, parseVerilogInstances } from '../lib/verilog';
import { fileStore, type FileEntry } from '../store/fileStore';
import type { Problem } from '../components/OutputPanel';

export type Status = 'idle' | 'compiling' | 'done' | 'error';

export function useCompilePipeline() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [yosysLog, setYosysLog] = useState('');
  const [outputPanelVisible, setOutputPanelVisible] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [missingModules, setMissingModules] = useState<string[] | null>(null);
  const [simPaused, setSimPaused] = useState(false);

  // ============ Dependency Resolution（逐字随迁） ============

  function resolveDependencies(targetFileId: string): FileEntry[] {
    const allFiles = fileStore.getAll();
    const targetFile = allFiles.find((f) => f.id === targetFileId);
    if (!targetFile) return [];

    const included = new Set<string>([targetFileId]);
    const result: FileEntry[] = [targetFile];

    const moduleToFile = new Map<string, FileEntry>();
    for (const f of allFiles) {
      if (f.definedModules) {
        for (const mod of f.definedModules) { moduleToFile.set(mod, f); }
      }
    }

    const queue = [targetFile];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const instances = parseVerilogInstances(current.content);
      for (const modName of instances) {
        const boundFileId = current.moduleBindings?.[modName];
        if (boundFileId) {
          const boundFile = allFiles.find((f) => f.id === boundFileId);
          if (boundFile && !included.has(boundFile.id)) {
            included.add(boundFile.id); result.push(boundFile); queue.push(boundFile);
          }
          continue;
        }
        const definingFile = moduleToFile.get(modName);
        if (definingFile && !included.has(definingFile.id)) {
          included.add(definingFile.id); result.push(definingFile); queue.push(definingFile);
        }
      }
    }
    return result;
  }

  // ============ Compilation（逐字随迁） ============

  const tryCompileAll = useCallback(async (targetFileId: string) => {
    const allFiles = fileStore.getAll();
    if (allFiles.length === 0) return;
    const targetFile = fileStore.getById(targetFileId);
    if (!targetFile) return;

    setStatus('compiling');
    setMessage('正在编译…');
    setYosysLog('');

    const dependencyFiles = resolveDependencies(targetFileId);
    const fileList = dependencyFiles.map((f) => ({ name: f.name, content: f.content }));
    const topModule = targetFile.definedModules?.[0];

    setYosysLog(`Compiling '${topModule || targetFile.name}' with ${dependencyFiles.length} file(s)...\n`);

    const validationErrors = validateModuleInterfaces(fileList);
    if (validationErrors.length > 0) {
      let log = '========== Module Interface Validation Errors ==========\n\n';
      for (const err of validationErrors) {
        log += `[Error] ${err.message}\n  File: ${err.fileName}\n`;
        if (err.instanceName) log += `  Instance: ${err.instanceName}\n`;
        log += `  Module: ${err.moduleName}\n  Detail: ${err.detail}\n\n`;
      }
      log += `Total: ${validationErrors.length} error(s).\n`;
      log += '========================================================\n';

      // 行号直接用 validator 算好的**结构化字段**。⚠ 旧写法是从 `detail` 那句人话里
      // 正则回捞 `/第(\d+)行/`：等于把"跳去哪一行"寄生在文案上，而且捞到的还是
      // 那个"同模块多实例全同一行"的估值（V1）。给不出行的文件级错误就明确不跳。
      const parsed = validationErrors.map((err) => ({
        fileName: err.fileName,
        line: err.line,
        message: err.message,
        severity: 'error' as const,
      }));
      setProblems(parsed);

      fileStore.updateFile(targetFileId, {
        status: 'error', errorMessage: `接口校验未通过：${validationErrors.length} 处错误`,
        missingModules: undefined, circuitJson: null,
      });
      setStatus('error');
      setMessage(`接口校验未通过：${validationErrors.length} 处错误`);
      setYosysLog((prev) => prev + '\n' + log);
      setOutputPanelVisible(true);
      return;
    }

    try {
      const result = await compileVerilog(fileList, topModule);
      fileStore.updateFile(targetFileId, {
        circuitJson: result.circuitJson, netlistVerilog: result.netlistVerilog, srcFileMap: result.srcFileMap, status: 'compiled',
        errorMessage: undefined, missingModules: undefined,
      });
      setStatus('done');
      setMissingModules(null);
      setProblems([]);
      if (result.netConflicts?.length) {
        // 多驱动冲突：已剥掉多余驱动照常出图，但必须说出来 —— 画出来的不是原设计
        // ⚠ 行号给不出（冲突是 yosys 图上的 net，不是源码某一行）⇒ 明确 null，
        // 不再塞 `line: 1` 冒充"就在第一行"（点了会跳到文件头，看着像 bug）。
        setProblems(result.netConflicts.map((c) => ({
          fileName: c.module, line: null, severity: 'warning' as const,
          message: `net「${c.net}」有 ${c.drivers.length} 个驱动（${c.drivers.join(' + ')}），已保留 ${c.drivers[0]}，其余驱动未画入`,
        })));
        setMessage(`编译完成，但有 ${result.netConflicts.length} 处多驱动冲突已标出（见 PROBLEMS）`);
      } else {
        setMessage('编译成功！');
      }
      setSimPaused(false); // a fresh build always starts running
      setYosysLog((prev) => prev + '\n' + result.yosysLog);
      setOutputPanelVisible(true);
    } catch (err: any) {
      const log = err instanceof MissingModulesError ? err.yosysLog :
                  err instanceof YosysCompileError ? err.yosysLog : '';
      if (err instanceof MissingModulesError) {
        fileStore.updateFile(targetFileId, {
          status: 'missing_deps', errorMessage: err.message,
          missingModules: err.missingModules, circuitJson: null,
        });
        setMissingModules(err.missingModules);
        setStatus('error'); setMessage(err.message);
        setYosysLog((prev) => prev + '\n' + log);
        setOutputPanelVisible(true);
      } else {
        fileStore.updateFile(targetFileId, {
          status: 'error', errorMessage: err.message || '编译失败',
          missingModules: undefined,
        });
        setStatus('error'); setMessage(err.message || '编译失败');
        setYosysLog((prev) => prev + '\n' + (log || err.message || 'Unknown error'));
        setOutputPanelVisible(true);
        console.error(err);
      }
    }
  }, []);

  return {
    status, setStatus, message, setMessage, yosysLog, setYosysLog,
    outputPanelVisible, setOutputPanelVisible, problems, setProblems,
    missingModules, setMissingModules, simPaused, setSimPaused,
    resolveDependencies, tryCompileAll,
  };
}
