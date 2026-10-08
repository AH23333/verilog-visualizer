import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import Canvas from './components/Canvas';
import type { CanvasHandle } from './components/Canvas';
import SandboxCanvas from './components/SandboxCanvas';
import SandboxExpandModal from './components/SandboxExpandModal';
import SettingsPanel from './components/SettingsPanel';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/CodeEditor';
import type { CodeEditorHandle } from './components/CodeEditor';
import TabBar from './components/TabBar';
import ContextMenu from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import MissingModulesDialog from './components/MissingModulesDialog';
import ModulePanel from './components/ModulePanel';
import OutputPanel, { type Problem } from './components/OutputPanel';
import BindingDialog from './components/BindingDialog';
import HierarchyViewer from './components/HierarchyViewer';
import SearchDialog from './components/SearchDialog';
import ShortcutsHelpDialog from './components/ShortcutsHelpDialog';
import ExamplesDialog from './components/ExamplesDialog';
import CommandPalette from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import OnboardingDialog from './components/OnboardingDialog';
import WaveformPanel from './components/WaveformPanel';
import InputPanel from './components/InputPanel';
import WindowControls from './components/WindowControls';
import PromptDialog, { type PromptOptions } from './components/PromptDialog';
import ConfirmDialog, { type ConfirmOptions } from './components/ConfirmDialog';
import {
  Files, Boxes, Box, Network, Sun, Moon, LockOpen, Lock, Play, Pause, AudioWaveform,
  Library, Save, Hammer, Code, ArrowLeft, Cpu, TriangleAlert, Copy, SlidersHorizontal,
  StepForward, Columns2,
} from 'lucide-react';
import type { VerilogExample } from './lib/examples';
import { SHORTCUTS, matchesCombo } from './lib/shortcuts';
import { compileVerilog, MissingModulesError, YosysCompileError, parseVerilogInstances, validateModuleInterfaces, buildViewJson } from './lib/verilog';
import { fileStore, type FileEntry } from './store/fileStore';
import { themeStore } from './store/themeStore';
import { settingsStore, type ViewMode } from './store/settingsStore';
import { projectConfigStore } from './store/projectConfigStore';
import { sandboxStore } from './store/sandboxStore';
import { collectToFolder, stripBoundInlineJson } from './lib/gateSystem';
import { exportSVG, exportPNG, exportCircuitJSON, exportVerilogCode, exportNetlistVerilog } from './lib/exportUtils';

type Status = 'idle' | 'compiling' | 'done' | 'error';

type ClipboardEntry = 
  | { type: 'files'; ids: string[] }
  | { type: 'folder'; path: string }
  | { type: 'cut'; data: { type: 'files'; ids: string[] } | { type: 'folder'; path: string } }
  | null;

export default function App() {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('circuit');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null);
  const lastClickedIndex = useRef<number>(-1);
  const canvasRef = useRef<CanvasHandle>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Missing modules dialog state
  const [missingModules, setMissingModules] = useState<string[] | null>(null);

  // Output panel state
  const [yosysLog, setYosysLog] = useState('');
  const [outputPanelVisible, setOutputPanelVisible] = useState(false);
  // Structured problems for the Problems tab (validation errors + parseable compile errors)
  const [problems, setProblems] = useState<Problem[]>([]);

  // IDE panel state: 'files' | 'modules' | 'hierarchy'
  const [leftPanel, setLeftPanel] = useState<'files' | 'modules' | 'hierarchy'>('files');
  // 沙盒模式的左栏面板（与 IDE 分开记）：默认是「部件」，进沙盒就能直接拖器件
  const [sandboxPanel, setSandboxPanel] = useState<'files' | 'modules' | 'hierarchy'>('modules');
  // 进入沙盒前的视图 —— 退出沙盒时回到它（没有它用户会困在沙盒里）
  const preViewModeRef = useRef<ViewMode>('circuit');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; items: ContextMenuItem[];
  } | null>(null);

  // Binding dialog state
  const [bindingDialogFile, setBindingDialogFile] = useState<FileEntry | null>(null);

  // Search dialog state
  const [searchDialogVisible, setSearchDialogVisible] = useState(false);

  // Shortcuts help / examples dialogs
  const [shortcutsHelpVisible, setShortcutsHelpVisible] = useState(false);
  const [examplesVisible, setExamplesVisible] = useState(false);
  const [exampleLoading, setExampleLoading] = useState(false);
  // Settings panel (外观 / 沙盒 / 快捷键)
  const [settingsVisible, setSettingsVisible] = useState(false);

  // Command palette (Ctrl+Shift+P)
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);

  // First-run onboarding
  const [onboardingVisible, setOnboardingVisible] = useState(() => {
    try { return !localStorage.getItem('verilog-viz-onboarded'); } catch { return false; }
  });

  // Simulation control state (digitaljs engine)
  const [simLocked, setSimLocked] = useState(false); // default: interactive (unchanged from prior behavior); lock is opt-in
  const [simPaused, setSimPaused] = useState(false);
  // "引擎因悬空/成环没起来"要是一颗**状态**，不能靠回头读自己写的那句文案认事
  // （V2b 把那句翻成中文后，原先那条英文正则就永远不命中 ⇒ 错误态清不掉）
  const [simBlocked, setSimBlocked] = useState(false);
  const [debugTick, setDebugTick] = useState(0);
      const MIN_SPEED_MS = 5, MAX_SPEED_MS = 200, DEFAULT_SPEED_MS = 10;
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS);
  const codeEditorRef = useRef<CodeEditorHandle>(null);

  // Hierarchy drill-down: path of module names currently displayed ([] = top).
  const [viewPath, setViewPath] = useState<string[]>([]);
  // R40 子部件「快捷查看展开图」（编译模式）：只读预览，可逐层钻取，不提供
  // 拖动 / 开关交互。拦截 digitaljs 内置 open:subcircuit 弹窗后由它接管。
  const [previewSub, setPreviewSub] = useState<{ circuit: any; name: string } | null>(null);
  // Esc 关闭只读预览（沙盒侧由 SandboxCanvas 的全局 Esc 处理，编译模式在这里补）
  useEffect(() => {
    if (!previewSub) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewSub(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewSub]);

  // Waveform panel
  const [waveOpen, setWaveOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  // Split-view left pane width fraction (0.25–0.75)
  const [splitRatio, setSplitRatio] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('verilog-viz-split-ratio') || '0.5'); return isNaN(v) ? 0.5 : Math.min(0.75, Math.max(0.25, v)); } catch { return 0.5; }
  });
  const splitDragRef = useRef<{ startX: number; startRatio: number } | null>(null);
  const [waveEpoch, setWaveEpoch] = useState(0);
  const waveGetChannels = useCallback(() => canvasRef.current?.getWaveChannels() ?? [], []);
  const waveGetSample = useCallback(() => canvasRef.current?.getWaveSample() ?? null, []);

  // ---- in-app modal input/confirm (replaces native prompt/confirm) ----
  type PromptReq = PromptOptions & { resolve: (v: string | null) => void };
  type ConfirmReq = ConfirmOptions & { resolve: (ok: boolean) => void };
  const [promptReq, setPromptReq] = useState<PromptReq | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const askPrompt = useCallback((opts: PromptOptions) =>
    new Promise<string | null>((resolve) => setPromptReq({ ...opts, resolve })), []);
  const askConfirm = useCallback((opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setConfirmReq({ ...opts, resolve })), []);
  const V_NAME_VALIDATE = (v: string) => {
    const fileName = v.split('/').pop() || v;
    return /\.(v|sv|vh)$/i.test(fileName) ? null : 'Only .v, .sv, or .vh files are supported.';
  };

  // Sidebar resize state
  const SIDEBAR_WIDTH_KEY = 'verilog-viz-sidebar-width';
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) { const n = parseInt(saved, 10); if (n >= 180 && n <= 500) return n; }
    } catch {}
    return 240;
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Sidebar drag handlers
  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDraggingSidebar) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(180, Math.min(500, dragStartWidth.current + delta));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSidebar, sidebarWidth]);

  // Subscribe to stores
  const files = useSyncExternalStore(fileStore.subscribe, () => fileStore.getAll());
  const folders = useSyncExternalStore(fileStore.subscribe, () => fileStore.getFolders());
  const theme = useSyncExternalStore(themeStore.subscribe, () => themeStore.get());
  const editorFontSize = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getFontSize());
  const defaultViewMode = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getDefaultViewMode());

  // Flat file list for range selection
  const flatFiles = useMemo(() => {
    const result: FileEntry[] = [...files];
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [files]);

  // Build fileNameMap for tabs
  const fileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of files) { map[f.id] = f.name; }
    return map;
  }, [files]);

  const activeFile = activeFileId ? fileStore.getById(activeFileId) : undefined;

  // Current renderable JSON for the drilled view (top when viewPath is empty).
  const viewJson = useMemo(
    () => buildViewJson(activeFile?.circuitJson, viewPath),
    [activeFile?.circuitJson, viewPath],
  );
  // A new compile (or file switch) changes circuitJson identity → drop back to top.
  useEffect(() => { setViewPath([]); }, [activeFile?.circuitJson]);
  // Displayed circuit changed (recompile / drill) → clear waveform history.
  useEffect(() => { setWaveEpoch((e) => e + 1); }, [viewJson]);

  // Load project files and config on startup
  useEffect(() => {
    fileStore.loadFromProjectDir();
    projectConfigStore.load().then((cfg) => {
      if (cfg.defaultView) setViewMode(cfg.defaultView);
    });
  }, []);

  // Disable browser default context menu globally
  useEffect(() => {
    const preventDefaultContext = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener('contextmenu', preventDefaultContext);
    return () => document.removeEventListener('contextmenu', preventDefaultContext);
  }, []);

  // ============ Tab Management ============

  const openFileInTab = useCallback((fileId: string) => {
    setOpenFiles((prev) => {
      if (prev.includes(fileId)) return prev;
      return [...prev, fileId];
    });
    setActiveFileId(fileId);
  }, []);

  const closeTab = useCallback((fileId: string) => {
    setOpenFiles((prev) => {
      const idx = prev.indexOf(fileId);
      const next = prev.filter((id) => id !== fileId);
      if (fileId === activeFileId) {
        if (next.length > 0) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveFileId(next[newIdx]);
        } else {
          setActiveFileId(null);
        }
      }
      return next;
    });
  }, [activeFileId]);

  const reorderTabs = useCallback((newOrder: string[]) => {
    setOpenFiles(newOrder);
  }, []);

  // ============ Dependency Resolution ============

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

  // ============ Compilation ============

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

  // ============ Export ============

  const handleExportSVG = useCallback(async () => {
    const name = activeFile?.name || 'circuit';
    const baseName = name.replace(/\.(v|sv|vh)$/, '');
    const ok = await exportSVG(canvasContainerRef.current, baseName);
    setMessage(ok ? 'SVG 已导出。' : '导出已取消，或画布上没有电路。');
  }, [activeFile]);

  const handleExportPNG = useCallback(async () => {
    const name = activeFile?.name || 'circuit';
    const baseName = name.replace(/\.(v|sv|vh)$/, '');
    const ok = await exportPNG(canvasContainerRef.current, baseName);
    setMessage(ok ? 'PNG 已导出。' : '导出已取消，或画布上没有电路。');
  }, [activeFile]);

  const handleExportJSON = useCallback(async () => {
    const name = activeFile?.name || 'circuit';
    const baseName = name.replace(/\.(v|sv|vh)$/, '');
    const ok = await exportCircuitJSON(activeFile?.circuitJson || null, baseName);
    setMessage(ok ? '电路 JSON 已导出。' : '导出已取消，或没有电路数据。');
  }, [activeFile]);

  const handleExportVerilog = useCallback(async () => {
    if (!activeFile) return;
    const ok = await exportVerilogCode(activeFile.content, activeFile.name);
    setMessage(ok ? 'Verilog 源码已导出。' : '导出已取消，或没有代码。');
  }, [activeFile]);

  const handleExportNetlist = useCallback(async () => {
    if (!activeFile) return;
    if (!activeFile.netlistVerilog) {
      setMessage('还没有综合出的网表——请先编译该文件。');
      return;
    }
    const ok = await exportNetlistVerilog(activeFile.netlistVerilog, activeFile.name);
    setMessage(ok ? '综合网表已导出。' : '导出已取消。');
  }, [activeFile]);

  // ============ File Operations ============

  const handleImportFile = useCallback(async () => {
    try {
      setStatus('idle'); setMessage('');
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.v,.sv,.vh'; input.multiple = true;
      input.onchange = async (e: Event) => {
        const fileList = (e.target as HTMLInputElement).files;
        if (!fileList || fileList.length === 0) return;
        setStatus('compiling'); setMessage('正在导入文件…');
        let primaryId: string | null = null;
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const text = await file.text();
          const fullPath = (file as any).path || file.name;
          const entry = fileStore.addFile(file.name, text, fullPath);
          if (i === 0) primaryId = entry.id;
        }
        if (primaryId) {
          openFileInTab(primaryId);
          setViewMode(defaultViewMode);
          await tryCompileAll(primaryId);
        }
      };
      input.click();
    } catch (err: any) {
      setStatus('error'); setMessage(err.message);
    }
  }, [tryCompileAll, defaultViewMode, openFileInTab]);

  const handleCreateFile = useCallback(async () => {
    const trimmed = await askPrompt({
      title: '新建文件',
      label: '文件名（允许 subdir/my_module.v）',
      defaultValue: 'my_module.v',
      confirmLabel: '创建',
      validate: V_NAME_VALIDATE,
    });
    if (!trimmed) return;
    const entry = fileStore.createFile(trimmed);
    openFileInTab(entry.id);
    setSelectedIds(new Set([entry.id]));
    setViewMode('code');
    setStatus('idle');
    setMessage('已新建文件，编辑后按 F5 编译即可渲染。');
  }, [openFileInTab, askPrompt]);

  const handleCreateFolder = useCallback(async () => {
    const name = await askPrompt({
      title: '新建文件夹', label: '文件夹名称', defaultValue: 'my_folder', confirmLabel: '创建',
    });
    if (!name) return;
    fileStore.createFolder(name);
    setMessage(`已创建文件夹「${name}」。`);
  }, [askPrompt]);

  const handleRefresh = useCallback(async () => {
    setMessage('正在从磁盘刷新…');
    await fileStore.refresh();
    setMessage('已从磁盘同步文件。');
  }, []);

  const handleSelectFile = useCallback((id: string) => {
    openFileInTab(id);
    setSelectedIds(new Set([id]));
    setViewMode(defaultViewMode);
    const file = fileStore.getById(id);
    if (!file) return;
    if (file.status === 'compiled' && file.circuitJson) {
      setStatus('done'); setMessage('已从缓存载入。');
      setSimPaused(false); // canvas remounts with the new circuit — start fresh
    } else if (file.status === 'missing_deps') {
      setStatus('error'); setMessage(file.errorMessage || '缺少模块实现');
      if (file.missingModules) setMissingModules(file.missingModules);
    } else if (file.status === 'error') {
      setStatus('error'); setMessage(file.errorMessage || '编译出错');
    } else {
      setStatus('idle'); setMessage('尚未编译。按 F5 开始编译。');
    }
  }, [defaultViewMode, openFileInTab]);

  const handleMultiSelect = useCallback((id: string, ctrl: boolean, shift: boolean) => {
    setActiveFileId(id);
    if (shift) {
      const currentIndex = flatFiles.findIndex((f) => f.id === id);
      const prevIndex = lastClickedIndex.current;
      if (prevIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(prevIndex, currentIndex);
        const end = Math.max(prevIndex, currentIndex);
        const rangeIds = new Set<string>();
        for (let i = start; i <= end; i++) rangeIds.add(flatFiles[i].id);
        setSelectedIds(rangeIds);
      } else {
        setSelectedIds(new Set([id]));
      }
      lastClickedIndex.current = currentIndex;
    } else if (ctrl) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      lastClickedIndex.current = flatFiles.findIndex((f) => f.id === id);
    } else {
      setSelectedIds(new Set([id]));
      lastClickedIndex.current = flatFiles.findIndex((f) => f.id === id);
    }
  }, [flatFiles]);

  const handleMoveFiles = useCallback((fileIds: string[], targetFolder: string) => {
    fileStore.moveFilesToFolder(fileIds, targetFolder);
    setMessage(`已移动 ${fileIds.length} 个文件到 ${targetFolder || '根目录'}。`);
  }, []);
  const handleMoveFolder = useCallback((folderPath: string, newPath: string) => {
    fileStore.moveFolder(folderPath, newPath);
    setMessage(`已把文件夹移动到「${newPath}」。`);
  }, []);

  const handleDeleteFile = useCallback((id: string) => {
    fileStore.deleteFile(id);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    if (activeFileId === id) {
      closeTab(id);
      setStatus('idle'); setMessage(''); setMissingModules(null);
    }
  }, [activeFileId, closeTab]);

  const handleDeleteFiles = useCallback((ids: string[]) => {
    for (const id of ids) fileStore.deleteFile(id);
    setSelectedIds(new Set());
    if (ids.includes(activeFileId || '')) {
      setOpenFiles((prev) => prev.filter((fid) => !ids.includes(fid)));
      setActiveFileId(null);
      setStatus('idle'); setMessage(''); setMissingModules(null);
    }
    setMessage(`已删除 ${ids.length} 个文件。`);
  }, [activeFileId]);

  const handleCopy = useCallback((ids?: string[]) => {
    const copyIds = ids || Array.from(selectedIds);
    if (copyIds.length === 0) return;
    setClipboard({ type: 'files', ids: copyIds });
    setMessage(`已复制 ${copyIds.length} 个文件到剪贴板。`);
  }, [selectedIds]);

  const handleCut = useCallback((ids?: string[]) => {
    const cutIds = ids || Array.from(selectedIds);
    if (cutIds.length === 0) return;
    setClipboard({ type: 'cut', data: { type: 'files', ids: cutIds } });
    setMessage(`已剪切 ${cutIds.length} 个文件，可直接粘贴。`);
  }, [selectedIds]);

  const handleCopyFolder = useCallback((folderPath: string) => {
    setClipboard({ type: 'folder', path: folderPath });
    setMessage(`已把文件夹「${folderPath}」复制到剪贴板。`);
  }, []);
  const handleCutFolder = useCallback((folderPath: string) => {
    setClipboard({ type: 'cut', data: { type: 'folder', path: folderPath } });
    setMessage(`已把文件夹「${folderPath}」剪切到剪贴板。`);
  }, []);

  const handlePaste = useCallback((targetFolder?: string) => {
    if (!clipboard) { setMessage('剪贴板是空的。'); return; }
    const isCut = clipboard.type === 'cut';
    const data = isCut ? clipboard.data : clipboard;
    if (data.type === 'files') {
      for (const id of data.ids) {
        const file = fileStore.getById(id);
        if (!file) continue;
        if (isCut) {
          const fileName = file.name.split('/').pop() || file.name;
          const newPath = targetFolder ? targetFolder + '/' + fileName : fileName;
          fileStore.moveFile(id, newPath);
        } else {
          fileStore.copyFile(id, targetFolder);
        }
      }
      setMessage(`已${isCut ? '移动' : '复制'} ${data.ids.length} 个文件${targetFolder ? '到 ' + targetFolder : ''}。`);
    } else if (data.type === 'folder') {
      if (isCut) {
        const folderName = data.path.split('/').pop() || data.path;
        const newPath = targetFolder ? targetFolder + '/' + folderName : folderName;
        fileStore.moveFolder(data.path, newPath);
        setMessage(`已把文件夹「${data.path}」移动到「${newPath}」。`);
      } else {
        fileStore.copyFolder(data.path, targetFolder);
        setMessage(`已复制文件夹「${data.path}」${targetFolder ? '到 ' + targetFolder : ''}。`);
      }
    }
    if (isCut) setClipboard(null);
  }, [clipboard]);

  const handlePasteFromClipboard = useCallback(() => { handlePaste(); }, [handlePaste]);
  const handleRenameFile = useCallback((id: string, name: string) => { fileStore.renameFile(id, name); }, []);

  // ============ Save vs Compile ============

  const handleSave = useCallback(() => {
    if (!activeFileId) return;
    const file = fileStore.getById(activeFileId);
    if (!file) return;
    fileStore.saveContent(activeFileId, file.content);
    setDirtyMap((prev) => ({ ...prev, [activeFileId]: false }));
    setStatus('idle'); setMessage('已保存文件。');
  }, [activeFileId]);

  const handleCompile = useCallback(async () => {
    if (!activeFileId) return;
    await tryCompileAll(activeFileId);
  }, [activeFileId, tryCompileAll]);

  // ============ Code Editor ============

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCodeChange = useCallback((code: string) => {
    if (activeFileId) {
      fileStore.updateFile(activeFileId, { content: code });
      setDirtyMap((prev) => ({ ...prev, [activeFileId]: true }));
      // Debounced auto-save (2s after last keystroke)
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        try {
          fileStore.saveContent(activeFileId, code);
          setDirtyMap((prev) => ({ ...prev, [activeFileId]: false }));
        } catch { /* auto-save best-effort */ }
      }, 2000);
    }
  }, [activeFileId]);

  // ============ Split-view drag splitter ============
  const onSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const startX = e.clientX;
    const startRatio = splitRatio;
    splitDragRef.current = { startX, startRatio };
    const onMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return;
      const rect = container.getBoundingClientRect();
      const dx = ev.clientX - splitDragRef.current.startX;
      const next = splitDragRef.current.startRatio + dx / rect.width;
      setSplitRatio(Math.min(0.75, Math.max(0.25, next)));
    };
    const onUp = () => {
      const finalRatio = splitDragRef.current?.startRatio ?? startRatio;
      splitDragRef.current = null;
      localStorage.setItem('verilog-viz-split-ratio', String(finalRatio));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitRatio]);

  // ============ Module Binding ============

  const handleBindModule = useCallback((fileId: string, missingModule: string, sourceFileId: string) => {
    fileStore.setModuleBinding(fileId, missingModule, sourceFileId);
    setMessage(`已把模块「${missingModule}」绑定到源文件，重新编译后生效。`);
  }, []);

  const handleBindingConfirm = useCallback((bindings: Record<string, string>) => {
    if (!bindingDialogFile) return;
    for (const [moduleName, fileId] of Object.entries(bindings)) {
      fileStore.setModuleBinding(bindingDialogFile.id, moduleName, fileId);
    }
    setMessage('模块绑定已保存，重新编译后生效。');
    setBindingDialogFile(null);
  }, [bindingDialogFile]);

  // ============ Theme ============

  const handleToggleTheme = useCallback(() => { themeStore.toggle(); }, []);
  const handleCanvasError = useCallback((msg: string) => { setStatus('error'); setMessage(msg); }, []);

  // ============ Sidebar / dialogs callbacks ============

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);

  const handleOpenExample = useCallback(async (example: VerilogExample) => {
    setExampleLoading(true);
    try {
      // Reuse an existing same-named example file instead of piling up duplicates;
      // refresh its content if the shipped example source changed between versions.
      const existing = fileStore.getAll().find((f) => f.name === example.fileName);
      if (existing && existing.content !== example.source) {
        fileStore.saveContent(existing.id, example.source);
      }
      const entry = existing ?? fileStore.addFile(example.fileName, example.source, example.fileName);
      openFileInTab(entry.id);
      setViewMode(defaultViewMode);
      setExamplesVisible(false);
      await tryCompileAll(entry.id);
    } finally {
      setExampleLoading(false);
    }
  }, [openFileInTab, defaultViewMode, tryCompileAll]);

  // ============ Sim control callbacks ============

  const handleToggleSimLock = useCallback(() => {
    setSimLocked((prev) => {
      const next = !prev;
      setMessage(next ? '浏览模式——点击开关/按钮不会改变电路，解锁后才能仿真。' : '交互模式——点击开关即可仿真。');
      return next;
    });
  }, []);

  const handleToggleSimPause = useCallback(() => {
    setSimPaused((prev) => {
      const next = !prev;
      setMessage(next ? '仿真已暂停。' : '仿真运行中。');
      return next;
    });
  }, []);

  const handleSpeedChange = useCallback((ms: number) => {
    setSpeedMs(ms);
  }, []);

  // ============ 问题 6：一键复制主模式编译出的电路到沙盒二次编辑 ============
  const handleCopyToSandbox = useCallback(async () => {
    if (!activeFile?.circuitJson) { setMessage('先编译出电路，再复制到沙盒。'); return; }
    const graphJson = canvasRef.current?.getGraphJson();
    if (!graphJson) { setMessage('无法导出当前电路图。'); return; }
    const base = (activeFile.name || 'circuit').replace(/\.(v|sv|vh)$/i, '');
    // R39 文件夹组织 + 可编辑子部件（用户方案）：
    //  1) 为本次复制建一个同名文件夹，把主电路与**全部递归子部件**收进去，
    //     文件树不再被摊平的一堆 .djs/.gate 搞乱；
    //  2) 子级部件递归复制为该文件夹下的**可编辑 .djs 部件文件**
    //     （cells 画布格式，打开即可编辑/连线/仿真），按 celltype 名绑定；
    //  3) 主电路快照里的子模块实例按 celltype 名称绑定（同文件夹优先解析），
    //     持久化时剥离内嵌快照 —— 单一真源。
    const folder = base;
    sandboxStore.createFolder(folder);
    const f = sandboxStore.create(`${folder}/${base}_sandbox`);
    // 子部件要逐个跑一遍布局并等 elk 写回坐标（实测 0.4–0.8s/个），期间必须当场
    // 给反馈 —— 否则点了「复制到沙盒」几秒内界面毫无反应，看起来像没生效。
    const modCount = Object.keys((activeFile.circuitJson as any)?.subcircuits || {}).length;
    if (modCount) setMessage(`正在固化 ${modCount} 个子部件的编译布局…`);
    let bound = 0;
    let boundErr = '';
    try { bound = await collectToFolder(activeFile.circuitJson, folder); } catch (e) { boundErr = String((e as Error)?.message || e); }
    let storedJson = graphJson;
    try { storedJson = stripBoundInlineJson(graphJson, folder); } catch { /* ignore */ }
    sandboxStore.save(f.id, storedJson);
    sandboxStore.setActiveId(f.id);
    // R35：同时暂存到「复制剪贴板」——用户也可以不打开自动建好的文件，
    // 而是在任意沙盒文件里右键「粘贴复制的电路」原样插入（带子模块内部电路）。
    try { localStorage.setItem('verilog-viz-import-clipboard', graphJson); } catch { /* ignore */ }
    preViewModeRef.current = viewMode;
    setSandboxPanel('files');
    setViewMode('sandbox');
    // R34：子模块（Subcircuit）的内部电路已随序列化一并携带，不再丢部件/线路
    let mods = 0;
    try { mods = (JSON.parse(storedJson)?.cells || []).filter((c: any) => c.type === 'Subcircuit').length; } catch { /* ignore */ }
    // 子部件固化失败不能默默吞掉：那时主电路已经建好、部件却缺几个，
    // 用户只会看到「实例展不开」，且不知道是这一步没成。
    const warn = boundErr
      ? `⚠ 子部件布局固化中断（${boundErr.slice(0, 60)}），已入库 ${bound} 个；缺失的部件实例展不开，可对该模块单独「保存为部件」补齐。`
      : '';
    setMessage(`${warn}已把「${activeFile.name}」的电路复制到沙盒文件夹「${folder}/」：主电路「${f.name.split('/').pop()}」${mods ? `含 ${mods} 个子模块实例；` : ''}${bound ? `${bound} 个子级部件已递归复制为该文件夹下的可编辑电路并按名绑定，` : ''}所有电路（含子部件）均可直接打开编辑；也可在任意沙盒文件中右键「粘贴复制的电路」。`);
  }, [activeFile, viewMode]);

  // ============ Circuit -> source jump (double-click a cell) ============

  const [pendingJump, setPendingJump] = useState<{ fileId: string; line: number } | null>(null);

  const handleSourceJump = useCallback((srcName: string, line: number) => {
    const map = activeFile?.srcFileMap;
    const fileName = map?.[srcName];
    if (!fileName) {
      setMessage('这个元件没有源码位置映射。');
      return;
    }
    const target = fileStore.getAll().find((f) => f.name === fileName);
    if (!target) {
      setMessage(`源文件「${fileName}」已不在本工程里。`);
      return;
    }
    openFileInTab(target.id);
    setViewMode('code');
    setPendingJump({ fileId: target.id, line });
    setMessage(`已跳到 ${fileName}:${line}`);
  }, [activeFile, openFileInTab]);

  // Run the pending jump after CodeEditor has received the new file content.
  // Child effects (editor content sync) run before this parent effect, so jumpToLine
  // always sees the up-to-date document.
  useEffect(() => {
    if (pendingJump && viewMode === 'code' && activeFileId === pendingJump.fileId) {
      codeEditorRef.current?.jumpToLine(pendingJump.line);
      setPendingJump(null);
    }
  }, [pendingJump, viewMode, activeFileId]);

  // ---- code -> circuit: switch to Circuit view and glow the elements defined at
  // the editor cursor line (reverse direction of double-click jump) ----
  const pendingSrcGlowRef = useRef<{ path: string; line: number } | null>(null);

  const switchToCircuit = useCallback(() => {
    // only meaningful when a compiled circuit will actually render
    if (!activeFile?.circuitJson) {
      pendingSrcGlowRef.current = null;
      setViewMode('circuit');
      return;
    }
    const line = codeEditorRef.current?.getCursorLine() ?? null;
    const map = activeFile.srcFileMap;
    if (line && map) {
      const fsPath = Object.keys(map).find((k) => map[k] === activeFile.name);
      if (fsPath) pendingSrcGlowRef.current = { path: fsPath, line };
    }
    setViewMode('circuit');
  }, [activeFile]);

  const handleCanvasReady = useCallback(() => {
    const pending = pendingSrcGlowRef.current;
    if (!pending) return;
    pendingSrcGlowRef.current = null;
    const n = canvasRef.current?.highlightSource(pending.path, pending.line) ?? 0;
    setMessage(n > 0
      ? `已从第 ${pending.line} 行高亮 ${n} 个元件。`
      : `第 ${pending.line} 行顶层没有对应元件（可能在子电路内部）。`);
  }, []);

  const handleCanvasRunningChange = useCallback((running: boolean) => {
    if (running && status !== 'compiling') {
      setSimBlocked(false);
      // 只清"引擎没起来"那一颗留下的残留错误态；编译错误（接口校验、缺模块）不许被引擎
      // 报一句"在跑"就抹掉——那会让人以为电路是好的。所以这里必须看 simBlocked 这颗状态。
      if (status === 'error' && simBlocked) {
        setStatus('done');
        setMessage('仿真运行中。');
      }
    } else if (!running && !simPaused) {
      setSimBlocked(true);
      setStatus('error');
      setMessage('电路存在悬空/成环的连线——未启动仿真。');
    }
  }, [simPaused, status, simBlocked]);

  // ============ Context Menus ============

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    const selCount = selectedIds.size;
    const multiSelected = selCount > 1;
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: multiSelected
        ? [
            { label: '复制', action: () => handleCopy() },
            { label: '剪切', action: () => handleCut() },
            { label: `Delete ${selCount} Files`, danger: true, action: () => handleDeleteFiles(Array.from(selectedIds)) },
            { label: '---', disabled: true, action: () => {} },
            { label: '编译', action: async () => { openFileInTab(file.id); await tryCompileAll(file.id); } },
            { label: '绑定...', action: () => setBindingDialogFile(file) },
            { label: '重命名', action: async () => { const newName = await askPrompt({ title: '重命名文件', defaultValue: file.name, confirmLabel: '重命名', validate: V_NAME_VALIDATE }); if (newName) handleRenameFile(file.id, newName); } },
          ]
        : [
            { label: '打开', action: () => handleSelectFile(file.id) },
            { label: '查看代码', action: () => { handleSelectFile(file.id); setViewMode('code'); } },
            { label: '编译', action: async () => { openFileInTab(file.id); await tryCompileAll(file.id); } },
            { label: '绑定...', action: () => setBindingDialogFile(file) },
            { label: '---', disabled: true, action: () => {} },
            { label: '复制', action: () => handleCopy([file.id]) },
            { label: '剪切', action: () => handleCut([file.id]) },
            { label: '重命名', action: async () => { const newName = await askPrompt({ title: '重命名文件', defaultValue: file.name, confirmLabel: '重命名', validate: V_NAME_VALIDATE }); if (newName) handleRenameFile(file.id, newName); } },
            { label: '删除', danger: true, action: () => handleDeleteFile(file.id) },
          ],
    });
  }, [handleSelectFile, handleRenameFile, handleDeleteFile, handleDeleteFiles, tryCompileAll, handleCopy, handleCut, selectedIds, openFileInTab, askPrompt]);

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: '新建文件', action: () => handleCreateFile() },
        { label: '新建文件夹', action: () => handleCreateFolder() },
        { label: '导入文件...', action: () => handleImportFile() },
        { label: '---', disabled: true, action: () => {} },
        { label: '粘贴', action: () => handlePasteFromClipboard() },
        { label: '从磁盘刷新', action: () => handleRefresh() },
      ],
    });
  }, [handleCreateFile, handleCreateFolder, handleImportFile, handlePasteFromClipboard, handleRefresh]);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderPath: string) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: '新建文件...', action: async () => {
          const name = await askPrompt({
            title: `新建文件 in ${folderPath}`, label: '文件名', defaultValue: 'my_module.v',
            confirmLabel: '创建', validate: V_NAME_VALIDATE,
          });
          if (!name) return;
          const fullPath = folderPath + '/' + name;
          const entry = fileStore.createFile(fullPath);
          openFileInTab(entry.id);
          setViewMode('code');
          setStatus('idle'); setMessage('已新建文件。');
        }},
        { label: '新建文件夹...', action: async () => {
          const name = await askPrompt({ title: '新建子文件夹', label: '文件夹名称', defaultValue: 'child', confirmLabel: '创建' });
          if (!name) return;
          fileStore.createFolder(folderPath + '/' + name);
          setMessage(`已创建文件夹「${name}」。`);
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: '复制文件夹', action: () => handleCopyFolder(folderPath) },
        { label: '剪切文件夹', action: () => handleCutFolder(folderPath) },
        { label: '粘贴', action: () => handlePaste(folderPath) },
        { label: '---', disabled: true, action: () => {} },
        { label: '重命名文件夹', action: async () => {
          const newName = await askPrompt({ title: '重命名文件夹', defaultValue: folderPath.split('/').pop() || folderPath, confirmLabel: '重命名' });
          if (!newName) return;
          const parts = folderPath.split('/');
          parts[parts.length - 1] = newName;
          fileStore.moveFolder(folderPath, parts.join('/'));
          setMessage(`文件夹已重命名为「${newName}」。`);
        }},
        { label: '删除文件夹', danger: true, action: async () => {
          // R102：汉化 + 与沙盒模式的弹窗信息保持一致（标题/正文/详情/按钮同一套话术）
          const n = fileStore.countFilesUnder(folderPath);
          const ok = await askConfirm({
            title: '删除文件夹', danger: true, confirmLabel: '删除',
            message: `确定删除文件夹「${folderPath}」吗？`,
            detail: n ? `文件夹内的 ${n} 个文件（含子文件夹）会一并删除，此操作无法撤销。` : '文件夹内的文件会一并删除，此操作无法撤销。',
          });
          if (ok) {
            fileStore.deleteFolder(folderPath);
            setMessage(`已删除文件夹「${folderPath}」。`);
          }
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: '从磁盘刷新', action: () => handleRefresh() },
      ],
    });
  }, [handleCopyFolder, handleCutFolder, handlePaste, openFileInTab, handleRefresh, askPrompt, askConfirm]);

  const openCanvasMenuAt = useCallback((x: number, y: number) => {
    const cell = canvasRef.current?.probeCellAt(x, y);
    const drillItems = (cell?.drillable && cell.celltype)
      ? [
          { label: `↵ Enter ${cell.celltype}`, action: () => setViewPath((p) => [...p, cell.celltype]) },
          { label: '---', disabled: true, action: () => {} },
        ]
      : [];
    setContextMenu({
      x, y,
      items: [
        ...drillItems,
        // 视图那一组与沙盒画布菜单同序同词（放大/缩小/适应窗口/重置缩放）——
        // 此前编译模式只有后两项，用户在编译图里没法用菜单缩放。
        { label: '放大', hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1.2) },
        { label: '缩小', hint: 'Ctrl+滚轮', action: () => canvasRef.current?.zoomBy(1 / 1.2) },
        { label: '适应窗口', hint: 'Shift+F', action: () => canvasRef.current?.fitToWindow() },
        { label: '重置缩放', action: () => canvasRef.current?.resetZoom() },
        { label: '---', disabled: true, action: () => {} },
        { label: '导出 SVG', action: () => handleExportSVG() },
        { label: '导出 PNG', action: () => handleExportPNG() },
        { label: '导出电路 JSON', action: () => handleExportJSON() },
        { label: '导出综合网表', action: () => handleExportNetlist() },
        { label: '---', disabled: true, action: () => {} },
        { label: '编译', action: () => handleCompile() },
        { label: '导入 Verilog 文件...', action: () => handleImportFile() },
      ],
    });
  }, [handleCompile, handleImportFile, handleExportSVG, handleExportPNG, handleExportJSON, handleExportNetlist]);

  // 右键在画布上是**平移**手势（Canvas 的 handleMouseDown），所以菜单不能在
  // 按下瞬间弹（浏览器就是在那一刻发 contextmenu，于是「一拖动就出菜单」）。
  // 这里按「按下 → 抬起，且中途没移动」判定成一次真正的右键点击再弹。
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let press: { x: number; y: number; moved: boolean } | null = null;
    const onDown = (e: MouseEvent) => { if (e.button === 2) press = { x: e.clientX, y: e.clientY, moved: false }; };
    const onMove = (e: MouseEvent) => {
      if (!press) return;
      // R102：阈值 4px → 10px。真实用户右键时手几乎一定有 1–5px 抖动，4px 太紧 ⇒
      // 菜单「丢了」（用户报"画布空白处右键丢失右键菜单"）。10px 仍远小于拖拽平移
      // 的位移量，不会把"右键拖动画布"误判成点击。
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press.moved = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 2 || !press) return;
      const moved = press.moved;
      press = null;
      if (!moved) openCanvasMenuAt(e.clientX, e.clientY);
    };
    // 捕获阶段：joint 的 paper 会在自己的处理里吞掉冒泡阶段的鼠标事件
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('mousemove', onMove, true);
    el.addEventListener('mouseup', onUp, true);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('mousemove', onMove, true);
      el.removeEventListener('mouseup', onUp, true);
    };
  }, [openCanvasMenuAt]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ============ Keyboard Shortcuts (registry-driven, see src/lib/shortcuts.ts) ============

  useEffect(() => {
    // Ids that must still fire while an input/editor has focus.
    const EDITOR_SAFE = new Set([
      'file.import', 'file.new', 'file.save', 'file.compile',
      'view.sidebar', 'view.output', 'search.global',
    ]);

    const isEditableTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el || typeof el.closest !== 'function') return false;
      if (el.closest('.cm-editor')) return true;                    // CodeMirror
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // If CodeMirror (or any focused widget) already consumed this exact key press
      // (its keymaps run with preventDefault before bubbling to the window), do NOT
      // double-fire the same command.
      if (e.defaultPrevented) return;

      const editable = isEditableTarget(e.target);

      for (const s of SHORTCUTS) {
        if (!matchesCombo(e, s.combo)) continue;

        const id = s.id;
        if (editable && !EDITOR_SAFE.has(id)) return; // canvas/list shortcuts yield to the editor

        const run = (): boolean => {
          switch (id) {
            case 'file.import': handleImportFile(); return true;
            case 'file.new': handleCreateFile(); return true;
            case 'file.save': handleSave(); return true;
            case 'file.compile': handleCompile(); return true;
            case 'view.sidebar': handleToggleSidebar(); return true;
            case 'view.output': setOutputPanelVisible((v) => !v); return true;
            case 'view.shortcutsHelp': setShortcutsHelpVisible((v) => !v); return true;
            case 'view.commandPalette': setCommandPaletteVisible(true); return true;
            case 'sim.stepOnce': canvasRef.current?.stepOnce(); return true;
            case 'search.global': setSearchDialogVisible((v) => !v); return true;
            case 'edit.selected.copy': if (selectedIds.size > 0) { handleCopy(); return true; } return false;
            case 'edit.selected.cut': if (selectedIds.size > 0) { handleCut(); return true; } return false;
            case 'edit.selected.paste': handlePasteFromClipboard(); return true;
            case 'edit.selected.delete': if (selectedIds.size > 0) { handleDeleteFiles(Array.from(selectedIds)); return true; } return false;
            case 'canvas.fit': canvasRef.current?.fitToWindow(); return true;
            case 'editor.undo': codeEditorRef.current?.undo(); return true;
            case 'editor.redo': codeEditorRef.current?.redo(); return true;
            case 'editor.find': codeEditorRef.current?.openFind(); return true;
            case 'editor.zoomIn': settingsStore.increaseFontSize(); return true;
            case 'editor.zoomOut': settingsStore.decreaseFontSize(); return true;
            case 'editor.zoomReset': settingsStore.resetFontSize(); return true;
            default: return false; // combos without an app handler (e.g. Alt+F4) fall through
          }
        };

        if (run()) e.preventDefault();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleImportFile, handleSave, handleCompile, handleCreateFile, handleDeleteFiles, handleCopy, handleCut, handlePasteFromClipboard, handleToggleSidebar, selectedIds]);

  // ============ Command Palette ============
  // Commands exposed to Ctrl+Shift+P. Built from the same handlers the
  // keyboard shortcut switch invokes — single source of truth for both.
  const commands: Command[] = useMemo(() => {
    const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));
    const list: Command[] = [];
    const push = (id: string, run: () => void) => {
      const s = byId.get(id);
      if (s && !s.combo.includes('Wheel')) list.push({ id, label: s.label, combo: s.combo, run });
    };
    push('file.import', handleImportFile);
    push('file.new', handleCreateFile);
    push('file.save', handleSave);
    push('file.compile', handleCompile);
    push('view.sidebar', handleToggleSidebar);
    push('view.output', () => setOutputPanelVisible((v) => !v));
    push('view.shortcutsHelp', () => setShortcutsHelpVisible((v) => !v));
    push('search.global', () => setSearchDialogVisible((v) => !v));
    push('sim.stepOnce', () => canvasRef.current?.stepOnce());
    push('canvas.fit', () => canvasRef.current?.fitToWindow());
    // Extra commands not on the global shortcut table
    list.push(
      { id: 'view.examples', label: '打开示例电路 gallery', run: () => setExamplesVisible(true) },
      { id: 'view.toggleTheme', label: '切换深色 / 浅色主题', run: handleToggleTheme },
      { id: 'view.resetZoom', label: '重置电路缩放', run: () => canvasRef.current?.resetZoom() },
      { id: 'view.fitWindow', label: '电路适应窗口', run: () => canvasRef.current?.fitToWindow() },
      { id: 'view.exportSVG', label: '导出电路为 SVG', run: handleExportSVG },
      { id: 'view.exportPNG', label: '导出电路为 PNG', run: handleExportPNG },
    );
    return list;
  }, [handleImportFile, handleCreateFile, handleSave, handleCompile, handleToggleSidebar,
      handleToggleTheme, handleExportSVG, handleExportPNG]);

  // ============ Render Helpers ============

  const statusColor =
    status === 'error' ? 'var(--danger)' :
    status === 'done' ? 'var(--success)' :
    status === 'compiling' ? '#ff9800' : 'var(--text-muted)';

  const hasMissingDeps = files.some((f) => f.status === 'missing_deps');

  return (
    <div className="w-screen h-screen flex flex-col bg-[var(--bg)]">
      {/* Top title bar — full width, always on top (VS Code style) */}
      <div
        data-tauri-drag-region
        style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 40, flexShrink: 0,
        padding: '0 0 0 4px',
        background: 'var(--toolbar-bg)', borderBottom: '1px solid var(--border)',
      }}>
        <MenuBar
          onImportFile={handleImportFile}
          onToggleTheme={handleToggleTheme}
          onResetZoom={() => canvasRef.current?.resetZoom()}
          onFitToWindow={() => canvasRef.current?.fitToWindow()}
          onCreateFile={handleCreateFile}
          currentTheme={theme}
          onExportSVG={handleExportSVG}
          onExportPNG={handleExportPNG}
          onExportJSON={handleExportJSON}
          onExportVerilog={handleExportVerilog}
          onExportNetlist={handleExportNetlist}
          onGlobalSearch={() => setSearchDialogVisible(true)}
          onSave={handleSave}
          onCompile={handleCompile}
          onUndo={() => codeEditorRef.current?.undo()}
          onRedo={() => codeEditorRef.current?.redo()}
          onFind={() => codeEditorRef.current?.openFind()}
          onToggleSidebar={handleToggleSidebar}
          onOpenExamples={() => setExamplesVisible(true)}
          onShowShortcuts={() => setShortcutsHelpVisible(true)}
          onOpenSettings={() => setSettingsVisible(true)}
          hasCircuit={activeFile?.circuitJson != null}
        />
        <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '0 1 auto' }}>
          <div
            className={status === 'compiling' ? 'status-compiling-dot' : ''}
            style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: statusColor,
              boxShadow: status === 'done' ? '0 0 6px rgba(34, 197, 94, 0.4)' : 'none',
            }}
          />
          <span style={{
            fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240,
          }}>
            {activeFile ? activeFile.name : 'Verilog Visualizer'}
          </span>
          {message && (
            <span data-status-message style={{
              fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {message}
            </span>
          )}
        </div>
        <div data-tauri-drag-region style={{ flex: 1, alignSelf: 'stretch' }} />
        <WindowControls />
      </div>

      {/* Body row: activity bar + sidebar + main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-[48px] flex flex-col items-center pt-2 pb-2 gap-1 flex-shrink-0"
          style={{
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border-subtle)',
          }}>
          {/* 三个面板按钮只切换左栏内容 —— 沙盒模式下同样留在沙盒（左栏由 SandboxCanvas
               渲染对应的沙盒视图：文件 / 部件 / 层次结构），不再切回 IDE 板块。
               沙盒与 IDE 各自记住自己的当前面板，互不干扰。 */}
          {(['files', 'modules', 'hierarchy'] as const).map(key => {
            const meta = {
              files: { icon: <Files size={19} />, label: '文件' },
              modules: { icon: <Boxes size={19} />, label: '模块' },
              hierarchy: { icon: <Network size={19} />, label: '层次结构' },
            }[key];
            const cur = viewMode === 'sandbox' ? sandboxPanel : leftPanel;
            return (
              <ActivityButton key={key} icon={meta.icon} label={meta.label} dataKey={key}
                active={cur === key && !sidebarCollapsed}
                onClick={() => {
                  // 沙盒模式下禁用「点当前面板=收起侧栏」——收起会连带 palette/右键目标
                  // 全部消失（用户实测问题 3/4/5 的连锁根因），面板切换照常。
                  if (cur === key && !sidebarCollapsed && viewMode !== 'sandbox') { setSidebarCollapsed(true); }
                  else {
                    if (viewMode === 'sandbox') setSandboxPanel(key); else setLeftPanel(key);
                    setSidebarCollapsed(false);
                  }
                }}
              />
            );
          })}
          <ActivityButton icon={<Box size={19} />} dataKey="sandbox"
            label={viewMode === 'sandbox' ? '沙盒（点击返回电路 / 代码视图）' : '沙盒'}
            active={viewMode === 'sandbox'}
            onClick={() => {
              // 再点一次退出沙盒，回到进入沙盒前的视图（否则沙盒里没有任何返回入口）
              if (viewMode === 'sandbox') setViewMode(preViewModeRef.current || 'circuit');
              else {
                preViewModeRef.current = viewMode;
                // 进入沙盒时保持用户当前所在的面板语境（文件→沙盒文件，模块→部件库，层次结构→层次）
                setSandboxPanel(leftPanel);
                setViewMode('sandbox');
              }
            }}
          />
          <div style={{ flex: 1 }} />
          <ActivityButton icon={theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />} label="主题"
            active={false} onClick={handleToggleTheme}
          />
        </div>

        {/* Left Panel — hidden in sandbox mode */}
        {!sidebarCollapsed && viewMode !== 'sandbox' && (
          <div className="flex-shrink-0 relative flex flex-col"
            style={{
              width: sidebarWidth, minWidth: 180,
              borderRight: '1px solid var(--border)',
              background: 'var(--sidebar-bg)',
            }}>
            {leftPanel === 'files' ? (
              <Sidebar
                files={files} folders={folders} activeFileId={activeFileId}
                selectedIds={selectedIds} onSelectFile={handleSelectFile}
                onMultiSelect={handleMultiSelect} onRenameFile={handleRenameFile}
                onImportFile={handleImportFile} onContextMenu={handleFileContextMenu}
                onEmptyContextMenu={handleEmptyAreaContextMenu}
                onFolderContextMenu={handleFolderContextMenu} collapsed={false}
                onToggleCollapse={() => setSidebarCollapsed(true)}
                onCreateFile={handleCreateFile} onCreateFolder={handleCreateFolder}
                onRefresh={handleRefresh}
                onMoveFiles={handleMoveFiles} onMoveFolder={handleMoveFolder}
              />
            ) : leftPanel === 'modules' ? (
              <ModulePanel
                files={files} onSelectFile={handleSelectFile}
                onBindModule={handleBindModule} onRecompile={handleCompile}
                isCompiling={status === 'compiling'}
              />
            ) : (
              <HierarchyViewer
                files={files} targetFileId={activeFileId}
                onSelectFile={handleSelectFile} theme={theme}
              />
            )}
            {/* Resize handle */}
            <div
              onMouseDown={handleSidebarDragStart}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 select-none transition-colors"
              style={{
                background: isDraggingSidebar ? 'var(--accent)' : 'transparent',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
              onMouseLeave={(e) => { if (!isDraggingSidebar) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            />
          </div>
        )}

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {viewMode === 'sandbox' ? (
            <SandboxCanvas theme={theme} onOpenSettings={() => setSettingsVisible(true)}
              leftPanel={sandboxPanel} sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
              onExitSandbox={() => setViewMode(preViewModeRef.current || 'circuit')} />
          ) : (<>
          {/* Tab Bar */}
          <TabBar
            openFiles={openFiles}
            activeFileId={activeFileId}
            fileNameMap={fileNameMap}
            dirtyMap={dirtyMap}
            onSelectTab={openFileInTab}
            onCloseTab={closeTab}
            onReorderTabs={reorderTabs}
            leftSlot={<>            {/* R103：功能按钮组搬**左侧**并与沙盒顶栏对齐（左对齐）；
                「仿真」文案改「运行」；暂停/继续与运行合并为一颗，避免出现两颗"运行"按钮。 */}
            {viewMode === 'circuit' && activeFile?.circuitJson && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                padding: '4px 10px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              }}>
                <button
                  onClick={handleToggleSimLock}
                  data-testid="sim-lock-toggle"
                  title={simLocked ? 'Unlock: allow clicking switches' : 'Lock: view-only canvas'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: 'none', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                    background: simLocked ? 'var(--surface-hover)' : 'var(--success)',
                    color: simLocked ? 'var(--text-secondary)' : '#fff',
                  }}
                >{simLocked ? <><Lock size={13} /> 查看</> : <><LockOpen size={13} /> 运行</>}</button>
                {/* R103：原来的「⏸/▶ 暂停·继续」与上面的「运行」并排会让人以为是两颗运行按钮。
                    改成**合并**：运行时显示「暂停」，暂停时显示「继续」——单态按钮，不并列。 */}
                <button
                  onClick={simPaused ? handleToggleSimPause : handleToggleSimPause}
                  data-testid="sim-pause-toggle"
                  title={simPaused ? '继续运行' : '暂停仿真（定格当前波形，R103）'}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '4px 9px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    background: simPaused ? 'var(--accent)' : 'transparent',
                    color: simPaused ? '#fff' : 'var(--text)',
                  }}
                >{simPaused ? <><Play size={13} /> 继续</> : <><Pause size={13} /> 暂停</>}</button>
                <button
                  onClick={() => canvasRef.current?.stepOnce()}
                  disabled={!simPaused}
                  title={simPaused ? 'Step one delta-cycle (F7)' : 'Pause first to step'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', border: '1px solid var(--accent)',
                    borderRadius: 'var(--radius-sm)', cursor: simPaused ? 'pointer' : 'not-allowed',
                    background: simPaused ? 'var(--accent)' : 'transparent',
                    color: simPaused ? '#fff' : 'var(--text-muted)',
                    fontSize: 'var(--fs-xs)', fontWeight: 600,
                    opacity: simPaused ? 1 : 0.4,
                  }}
                ><StepForward size={13} /> 单步</button>
                {simPaused && debugTick > 0 && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', fontWeight: 600, padding: '0 4px' }}>
                    tick={debugTick}
                  </span>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
                  速度
                  {/* range value = "fastness": low ms = fast engine tick */}
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={(MAX_SPEED_MS - speedMs) / (MAX_SPEED_MS - MIN_SPEED_MS)}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      handleSpeedChange(Math.round(MAX_SPEED_MS - t * (MAX_SPEED_MS - MIN_SPEED_MS)));
                    }}
                    style={{ width: 90, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ minWidth: 46, color: 'var(--text)' }}>{speedMs} ms</span>
                </label>
                <button
                  onClick={() => setWaveOpen((v) => !v)}
                  data-testid="wave-toggle"
                  title="切换命名信号的实时波形"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                    background: waveOpen ? 'var(--accent)' : 'transparent',
                    color: waveOpen ? '#fff' : 'var(--text)',
                  }}
                ><AudioWaveform size={13} /> 波形</button>
                <button
                  onClick={() => setInputsOpen((v) => !v)}
                  title="切换输入开关面板"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                    background: inputsOpen ? 'var(--accent)' : 'transparent',
                    color: inputsOpen ? '#fff' : 'var(--text)',
                  }}
                ><SlidersHorizontal size={13} /> 输入</button>
              </div>
            )}
            <button
              data-tool="examples"
                  onClick={() => setExamplesVisible(true)}
              title="打开示例电路"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0 14px', height: 30, border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                fontSize: 'var(--fs-md)', background: 'var(--surface)', color: 'var(--text)',
                flexShrink: 0,
              }}
            ><Library size={14} /> 示例</button>
            {viewMode === 'circuit' && activeFile?.circuitJson && (
              <button
                onClick={handleCopyToSandbox}
                title="把当前电路复制到沙盒，进行自由二次编辑"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 30, border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  fontSize: 'var(--fs-md)', background: 'var(--surface)', color: 'var(--text)',
                  flexShrink: 0,
                }}
              ><Copy size={14} /> 复制到沙盒</button>
            )}
            {activeFile && (
              <>
                <button onClick={handleSave} title="保存 (Ctrl+S)" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 30, border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  fontSize: 'var(--fs-md)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 500,
                }}><Save size={14} /> 保存</button>
                <button onClick={handleCompile} disabled={status === 'compiling'} title="编译 (F5)" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 30, border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: status === 'compiling' ? 'default' : 'pointer', fontSize: 'var(--fs-md)',
                  background: status === 'compiling' ? 'var(--text-muted)' : 'var(--accent)',
                  color: '#fff', fontWeight: 600,
                }}>{status === 'compiling' ? '编译中…' : <><Hammer size={14} /> 编译</>}</button>
                {hasMissingDeps && (
                  <button onClick={handleCompile} disabled={status === 'compiling'} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '0 14px', height: 30, border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: status === 'compiling' ? 'default' : 'pointer', fontSize: 'var(--fs-md)',
                    background: 'var(--warning)', color: '#000', fontWeight: 600,
                  }}><TriangleAlert size={14} /> Fix Dependencies</button>
                )}
              </>
            )}
            {activeFile && (
              <div style={{
                display: 'flex', gap: 2, marginLeft: 14, background: 'var(--surface)',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: 3,
              }}>
                <button onClick={switchToCircuit} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  title="切换到电路视图（高亮光标行定义的元件）"
                  style={{
                    background: viewMode === 'circuit' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'circuit' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Network size={13} /> 电路图</button>
                <button onClick={() => setViewMode('code')} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  style={{
                    background: viewMode === 'code' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'code' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Code size={13} /> 代码</button>
                <button onClick={() => setViewMode('split')} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  title="分屏：左侧代码，右侧电路"
                  style={{
                    background: viewMode === 'split' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'split' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Columns2 size={13} /> 分屏</button>
              </div>
            )}</>}
          />

          {/* Content: Canvas or Code Editor */}
          <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden"
            onContextMenu={(e) => { e.preventDefault(); /* 菜单改由「右键没移动」判定后弹，见 openCanvasMenuAt */ }}>
            {/* R102：输入/输出面板**移到画布右侧浮层**（原来是最右侧独立栏，与沙盒位置不一致）。
                位置、尺寸、配色与沙盒的 IOPanel 完全一致。 */}
            {inputsOpen && viewMode === 'circuit' && activeFile?.circuitJson && (
              <div className="absolute top-12 right-2 bottom-2 z-30 flex" style={{ pointerEvents: 'auto' }}>
                <InputPanel canvasRef={canvasRef} open={inputsOpen} onClose={() => setInputsOpen(false)} />
              </div>
            )}
            {/* Sub-module breadcrumb — only while drilled in, circuit view */}
            {viewMode === 'circuit' && viewPath.length > 0 && activeFile?.circuitJson && (
              <div
                className="absolute top-2 left-2 z-20 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[var(--fs-md)] select-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                <button
                  onClick={() => setViewPath([])}
                  className="border-0 cursor-pointer p-0.5 rounded hover:opacity-80"
                  style={{ background: 'transparent', color: 'var(--accent)', display: 'inline-flex' }}
                  title="返回顶层模块"
                ><ArrowLeft size={14} /></button>
                <button
                  onClick={() => setViewPath([])}
                  className="border-0 cursor-pointer px-1 py-0.5 rounded hover:opacity-80"
                  style={{ background: 'transparent', color: 'var(--text)', fontSize: 'var(--fs-md)', fontWeight: 600 }}
                >
                  {(activeFile.circuitJson as any)?.name || activeFile.name.replace(/\.(v|sv|vh)$/, '')}
                </button>
                {viewPath.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span style={{ color: 'var(--text-muted)' }}>›</span>
                    <button
                      onClick={() => setViewPath(viewPath.slice(0, i + 1))}
                      className="border-0 cursor-pointer px-1 py-0.5 rounded hover:opacity-80"
                      style={{
                        background: 'transparent', fontSize: 'var(--fs-md)',
                        fontWeight: i === viewPath.length - 1 ? 600 : 400,
                        color: i === viewPath.length - 1 ? 'var(--text)' : 'var(--accent)',
                      }}
                    >{seg}</button>
                  </span>
                ))}
              </div>
            )}
            {(() => {
              if (!activeFile) {
                return (
                  <div className="flex flex-col justify-center items-center h-full gap-6 select-none"
                    style={{ color: 'var(--text-secondary)' }}>
                    <div style={{ opacity: 0.12 }}><Cpu size={64} strokeWidth={1} style={{ color: 'var(--text)' }} /></div>
                    <div className="text-lg font-medium" style={{ color: 'var(--text)' }}>未选择文件</div>
                    <div className="flex gap-3">
                      <button onClick={handleImportFile} className="px-6 py-2.5 text-sm font-semibold rounded-lg border-0 cursor-pointer text-white transition-all hover:opacity-90 hover:shadow-lg"
                        style={{ background: 'var(--accent)' }}>导入 .v 文件</button>
                      <button onClick={() => setExamplesVisible(true)} className="px-6 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:border-[var(--border)]"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>打开示例</button>
                      <button onClick={handleCreateFile} className="px-6 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:border-[var(--border)]"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>新建文件</button>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Ctrl+O to import · Ctrl+N to create · F5 to compile · Ctrl+/ for shortcuts
                    </div>
                  </div>
                );
              }

              if (viewMode === 'split') {
                return (
                  <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                    <div style={{ width: `${splitRatio * 100}%`, borderRight: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                      <CodeEditor
                        ref={codeEditorRef}
                        code={activeFile.content}
                        fileName={activeFile.name}
                        theme={theme}
                        onCodeChange={handleCodeChange}
                        onSave={handleSave}
                        onRecompile={handleCompile}
                        isCompiling={status === 'compiling'}
                        onCursorLineChange={(line) => {
                          if (!activeFile?.circuitJson) return;
                          const map = activeFile.srcFileMap;
                          if (!map) return;
                          const fsPath = Object.keys(map).find((k) => map[k] === activeFile.name);
                          if (fsPath) canvasRef.current?.highlightSource(fsPath, line);
                        }}
                      />
                    </div>
                    <div
                      onMouseDown={onSplitDividerMouseDown}
                      style={{
                        width: 5, cursor: 'col-resize', flexShrink: 0,
                        background: 'var(--border-subtle)',
                        position: 'relative', zIndex: 10,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--border-subtle)'; }}
                    />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      {activeFile.circuitJson ? (
                        <Canvas
                          ref={canvasRef}
                          circuitJson={viewJson ?? activeFile.circuitJson}
                          theme={theme}
                          onError={handleCanvasError}
                          locked={simLocked}
                          paused={simPaused}
                          speedMs={speedMs}
                          onRunningChange={handleCanvasRunningChange}
                          onSourceJump={handleSourceJump}
                          onReady={handleCanvasReady}
                          onTick={(t) => setDebugTick(t)}
                          onPreviewSubcircuit={(cj, nm) => setPreviewSub({ circuit: cj, name: nm })}
                        />
                      ) : (
                        <div style={{
                          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
                        }}>按 F5 开始编译 →</div>
                      )}
                    </div>
                  </div>
                );
              }

              if (viewMode === 'code') {
                return (
                  <CodeEditor
                    ref={codeEditorRef}
                    code={activeFile.content}
                    fileName={activeFile.name}
                    theme={theme}
                    onCodeChange={handleCodeChange}
                    onSave={handleSave}
                    onRecompile={handleCompile}
                    isCompiling={status === 'compiling'}
                  />
                );
              }

              if (activeFile.circuitJson) {
                return (
                  <Canvas
                    ref={canvasRef}
                    circuitJson={viewJson ?? activeFile.circuitJson}
                    theme={theme}
                    onError={handleCanvasError}
                    locked={simLocked}
                    paused={simPaused}
                    speedMs={speedMs}
                    onRunningChange={handleCanvasRunningChange}
                    onSourceJump={handleSourceJump}
                    onReady={handleCanvasReady}
                    onTick={(t) => setDebugTick(t)}
                    onPreviewSubcircuit={(cj, nm) => setPreviewSub({ circuit: cj, name: nm })}
                  />
                );
              }

              return (
                <div className="flex flex-col justify-center items-center h-full gap-5 select-none"
                  style={{ color: 'var(--text-secondary)' }}>
                    <div style={{ opacity: 0.15, display: 'flex' }}>
                      {activeFile.status === 'missing_deps'
                        ? <TriangleAlert size={48} strokeWidth={1} style={{ color: 'var(--text)' }} />
                        : <Cpu size={48} strokeWidth={1} style={{ color: 'var(--text)' }} />}
                    </div>
                  <div className="text-base font-medium" style={{ color: 'var(--text)' }}>
                    {activeFile.status === 'missing_deps' ? 'Missing dependencies'
                      : activeFile.status === 'error' ? '编译出错' : '尚未编译'}
                  </div>
                  <div className="text-sm max-w-[420px] text-center leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {activeFile.errorMessage || '按 F5 开始编译；细节见「输出」面板。'}
                  </div>
                  <button onClick={handleCompile} disabled={status === 'compiling'} className="mt-2 px-6 py-2.5 text-sm font-semibold rounded-lg border-0 cursor-pointer text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: status === 'compiling' ? 'var(--text-muted)' : 'var(--accent)',
                    }}>{status === 'compiling' ? 'Compiling...' : '编译 (F5)'}</button>
                </div>
              );
            })()}
          </div>

          {/* Waveform panel (circuit view only) */}
          {waveOpen && viewMode === 'circuit' && activeFile?.circuitJson && (
            <WaveformPanel
              getChannels={waveGetChannels}
              getSample={waveGetSample}
              resetKey={String(waveEpoch)}
              running={!simPaused && !simLocked}
              onClose={() => setWaveOpen(false)}
            />
          )}

          {/* R40 子部件「快捷查看展开图」（编译模式）：只读预览，可逐层钻取。
              拦截了 digitaljs 内置的 open:subcircuit 弹窗（可拖动/可点开关）。 */}
          {previewSub && (
            <SandboxExpandModal
              cell={null}
              initialCircuit={previewSub.circuit}
              initialName={previewSub.name}
              theme={theme}
              onClose={() => setPreviewSub(null)}
            />
          )}

          {/* Input switches panel：R102 已移入画布容器右侧（见上方 canvasContainerRef 内）*/}
          </>)}
        </div>
      </div>

      {/* Output Panel */}
      <OutputPanel
        log={yosysLog}
        problems={problems}
        visible={outputPanelVisible}
        onToggle={() => setOutputPanelVisible((v) => !v)}
        onClose={() => setOutputPanelVisible(false)}
        onJumpToProblem={(fileName, line) => {
          const target = fileStore.getAll().find((f) => f.name === fileName);
          if (!target) { setMessage(`找不到文件「${fileName}」。`); return; }
          openFileInTab(target.id);
          setViewMode('code');
          setPendingJump({ fileId: target.id, line });
          setMessage(`已跳到 ${fileName}:${line}`);
        }}
      />

      {/* Bottom Status Bar */}
      <div className="flex items-center h-8 px-4 gap-4 text-[var(--fs-md)]"
        style={{
          background: 'var(--statusbar-bg)',
          color: 'var(--text-secondary)',
          borderTop: '1px solid var(--border)',
        }}>
        <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        {folders.length > 0 && (
          <>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span>{folders.length} folder{folders.length !== 1 ? 's' : ''}</span>
          </>
        )}
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span>{theme === 'dark' ? '深色' : '浅色'}</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span>Font: {editorFontSize}px</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ cursor: 'pointer' }}
          onClick={() => {
            const next = settingsStore.getDefaultViewMode() === 'circuit' ? 'code' : 'circuit';
            settingsStore.setDefaultViewMode(next);
          }}
          title="点击切换默认视图">Default: {defaultViewMode === 'circuit' ? 'Circuit' : 'Code'}</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ cursor: 'pointer', color: outputPanelVisible ? 'var(--accent)' : 'var(--text-secondary)' }}
          onClick={() => setOutputPanelVisible((v) => !v)}
          title="切换输出面板 (Ctrl+J)">输出</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)' }}>
          Ctrl+S 保存 · F5 编译 · Ctrl+Shift+F 搜索
        </span>
      </div>

      {/* Custom Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

      {/* Settings Panel */}
      {settingsVisible && (
        <SettingsPanel theme={theme} onToggleTheme={handleToggleTheme} onClose={() => setSettingsVisible(false)} />
      )}

      {/* Missing Modules Dialog */}
      {missingModules && missingModules.length > 0 && (
        <MissingModulesDialog
          missingModules={missingModules} onImport={handleImportFile}
          onRecompile={handleCompile} onClose={() => setMissingModules(null)}
          isCompiling={status === 'compiling'}
        />
      )}

      {/* Binding Dialog */}
      {bindingDialogFile && (
        <BindingDialog
          file={bindingDialogFile} allFiles={files}
          onConfirm={handleBindingConfirm} onCancel={() => setBindingDialogFile(null)}
        />
      )}

      {/* Global Search Dialog */}
      {searchDialogVisible && (
        <SearchDialog
          files={files} theme={theme}
          onClose={() => setSearchDialogVisible(false)}
          onOpenFile={(fileId, _line) => {
            openFileInTab(fileId);
            setViewMode('code');
            setSearchDialogVisible(false);
          }}
        />
      )}

      {/* Keyboard Shortcuts Help */}
      {shortcutsHelpVisible && (
        <ShortcutsHelpDialog onClose={() => setShortcutsHelpVisible(false)} />
      )}

      {/* In-app prompt / confirm (replace native dialogs) */}
      {promptReq && (
        <PromptDialog
          title={promptReq.title} label={promptReq.label} defaultValue={promptReq.defaultValue}
          placeholder={promptReq.placeholder} confirmLabel={promptReq.confirmLabel} validate={promptReq.validate}
          onAccept={(v) => { promptReq.resolve(v); setPromptReq(null); }}
          onCancel={() => { promptReq.resolve(null); setPromptReq(null); }}
        />
      )}
      {confirmReq && (
        <ConfirmDialog
          title={confirmReq.title} message={confirmReq.message} detail={confirmReq.detail}
          confirmLabel={confirmReq.confirmLabel} danger={confirmReq.danger}
          onAccept={() => { confirmReq.resolve(true); setConfirmReq(null); }}
          onCancel={() => { confirmReq.resolve(false); setConfirmReq(null); }}
        />
      )}

      {/* Example Circuits Gallery */}
      {examplesVisible && (
        <ExamplesDialog
          loading={exampleLoading}
          onClose={() => setExamplesVisible(false)}
          onOpen={handleOpenExample}
        />
      )}

      {/* Command Palette (Ctrl+Shift+P) */}
      {commandPaletteVisible && (
        <CommandPalette commands={commands} onClose={() => setCommandPaletteVisible(false)} />
      )}

      {/* First-run onboarding */}
      {onboardingVisible && (
        <OnboardingDialog
          onClose={() => setOnboardingVisible(false)}
          onOpenExample={() => setExamplesVisible(true)}
        />
      )}
    </div>
  );
}

/** IDE-style activity bar button */
function ActivityButton({ icon, label, active, onClick, dataKey }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void; dataKey?: string;
}) {
  return (
    // data-activity 是稳定标识：沙盒按钮的 title 会随状态变化（提示「点击返回」），
    // 自动化测试与快捷键逻辑不能靠 title 定位
    <button onClick={onClick} title={label} data-activity={dataKey ?? label}
      className={`activity-btn${active ? ' active' : ''}`}>
      {icon}
    </button>
  );
}