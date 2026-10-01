import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import Canvas from './components/Canvas';
import type { CanvasHandle } from './components/Canvas';
import SandboxCanvas from './components/SandboxCanvas';
import type { SandboxHandle } from './components/SandboxCanvas';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/CodeEditor';
import type { CodeEditorHandle } from './components/CodeEditor';
import TabBar from './components/TabBar';
import ContextMenu from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import MissingModulesDialog from './components/MissingModulesDialog';
import ModulePanel from './components/ModulePanel';
import OutputPanel from './components/OutputPanel';
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
  Files, Boxes, Network, Sun, Moon, LockOpen, Lock, Play, Pause, StepForward, AudioWaveform,
  Library, Save, Hammer, Code, ArrowLeft, Cpu, TriangleAlert, SlidersHorizontal, Columns2, Box,
} from 'lucide-react';
import type { VerilogExample } from './lib/examples';
import { SHORTCUTS, matchesCombo } from './lib/shortcuts';
import { compileVerilog, MissingModulesError, YosysCompileError, parseVerilogInstances, validateModuleInterfaces, buildViewJson } from './lib/verilog';
import { fileStore, type FileEntry } from './store/fileStore';
import { themeStore } from './store/themeStore';
import { settingsStore, type ViewMode } from './store/settingsStore';
import { projectConfigStore } from './store/projectConfigStore';
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
  const sandboxRef = useRef<SandboxHandle>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Missing modules dialog state
  const [missingModules, setMissingModules] = useState<string[] | null>(null);

  // Output panel state
  const [yosysLog, setYosysLog] = useState('');
  const [outputPanelVisible, setOutputPanelVisible] = useState(false);
  // Structured problems for the Problems tab (validation errors + parseable compile errors)
  const [problems, setProblems] = useState<{ fileName: string; line: number; message: string; severity: 'error' | 'warning' }[]>([]);

  // IDE panel state: 'files' | 'modules' | 'hierarchy'
  const [leftPanel, setLeftPanel] = useState<'files' | 'modules' | 'hierarchy'>('files');

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

  // Command palette (Ctrl+Shift+P)
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);

  // First-run onboarding
  const [onboardingVisible, setOnboardingVisible] = useState(() => {
    try { return !localStorage.getItem('verilog-viz-onboarded'); } catch { return false; }
  });

  // Simulation control state (digitaljs engine)
  const [simLocked, setSimLocked] = useState(false); // default: interactive (unchanged from prior behavior); lock is opt-in
  const [simPaused, setSimPaused] = useState(false);
  const [debugTick, setDebugTick] = useState(0);
      const MIN_SPEED_MS = 5, MAX_SPEED_MS = 200, DEFAULT_SPEED_MS = 10;
  const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS);
  const codeEditorRef = useRef<CodeEditorHandle>(null);

  // Hierarchy drill-down: path of module names currently displayed ([] = top).
  const [viewPath, setViewPath] = useState<string[]>([]);

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
    setMessage('Compiling...');
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

      // Structured problems for the Problems tab — parse line number from detail
      const parsed = validationErrors.map((err) => {
        const m = err.detail.match(/第(\d+)行/);
        return {
          fileName: err.fileName,
          line: m ? parseInt(m[1], 10) : 1,
          message: err.message,
          severity: 'error' as const,
        };
      });
      setProblems(parsed);

      fileStore.updateFile(targetFileId, {
        status: 'error', errorMessage: `Interface validation failed: ${validationErrors.length} error(s)`,
        missingModules: undefined, circuitJson: null,
      });
      setStatus('error');
      setMessage(`Interface validation failed: ${validationErrors.length} error(s)`);
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
      setMessage('Compiled successfully!');
      setMissingModules(null);
      setProblems([]);
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
          status: 'error', errorMessage: err.message || 'Compilation failed',
          missingModules: undefined,
        });
        setStatus('error'); setMessage(err.message || 'Compilation failed');
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
    setMessage(ok ? 'SVG exported.' : 'Export cancelled or no circuit.');
  }, [activeFile]);

  const handleExportPNG = useCallback(async () => {
    const name = activeFile?.name || 'circuit';
    const baseName = name.replace(/\.(v|sv|vh)$/, '');
    const ok = await exportPNG(canvasContainerRef.current, baseName);
    setMessage(ok ? 'PNG exported.' : 'Export cancelled or no circuit.');
  }, [activeFile]);

  const handleExportJSON = useCallback(async () => {
    const name = activeFile?.name || 'circuit';
    const baseName = name.replace(/\.(v|sv|vh)$/, '');
    const ok = await exportCircuitJSON(activeFile?.circuitJson || null, baseName);
    setMessage(ok ? 'Circuit JSON exported.' : 'Export cancelled or no circuit data.');
  }, [activeFile]);

  const handleExportVerilog = useCallback(async () => {
    if (!activeFile) return;
    const ok = await exportVerilogCode(activeFile.content, activeFile.name);
    setMessage(ok ? 'Verilog source exported.' : 'Export cancelled or no code.');
  }, [activeFile]);

  const handleExportNetlist = useCallback(async () => {
    if (!activeFile) return;
    if (!activeFile.netlistVerilog) {
      setMessage('No synthesized netlist — compile the file first.');
      return;
    }
    const ok = await exportNetlistVerilog(activeFile.netlistVerilog, activeFile.name);
    setMessage(ok ? 'Synthesized netlist exported.' : 'Export cancelled.');
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
        setStatus('compiling'); setMessage('Importing files...');
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
      title: 'New File',
      label: 'File name (subdir/my_module.v allowed)',
      defaultValue: 'my_module.v',
      confirmLabel: 'Create',
      validate: V_NAME_VALIDATE,
    });
    if (!trimmed) return;
    const entry = fileStore.createFile(trimmed);
    openFileInTab(entry.id);
    setSelectedIds(new Set([entry.id]));
    setViewMode('code');
    setStatus('idle');
    setMessage('New file created. Edit and compile to render.');
  }, [openFileInTab, askPrompt]);

  const handleCreateFolder = useCallback(async () => {
    const name = await askPrompt({
      title: 'New Folder', label: 'Folder name', defaultValue: 'my_folder', confirmLabel: 'Create',
    });
    if (!name) return;
    fileStore.createFolder(name);
    setMessage(`Folder '${name}' created.`);
  }, [askPrompt]);

  const handleRefresh = useCallback(async () => {
    setMessage('Refreshing from disk...');
    await fileStore.refresh();
    setMessage('Files synced from disk.');
  }, []);

  const handleSelectFile = useCallback((id: string) => {
    openFileInTab(id);
    setSelectedIds(new Set([id]));
    setViewMode(defaultViewMode);
    const file = fileStore.getById(id);
    if (!file) return;
    if (file.status === 'compiled' && file.circuitJson) {
      setStatus('done'); setMessage('Loaded from cache.');
      setSimPaused(false); // canvas remounts with the new circuit — start fresh
    } else if (file.status === 'missing_deps') {
      setStatus('error'); setMessage(file.errorMessage || 'Missing module implementations');
      if (file.missingModules) setMissingModules(file.missingModules);
    } else if (file.status === 'error') {
      setStatus('error'); setMessage(file.errorMessage || 'Compilation error');
    } else {
      setStatus('idle'); setMessage('Pending compilation. Press F5 to compile.');
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
    setMessage(`Moved ${fileIds.length} file(s) to ${targetFolder || 'root'}.`);
  }, []);
  const handleMoveFolder = useCallback((folderPath: string, newPath: string) => {
    fileStore.moveFolder(folderPath, newPath);
    setMessage(`Moved folder to '${newPath}'.`);
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
    setMessage(`Deleted ${ids.length} file(s).`);
  }, [activeFileId]);

  const handleCopy = useCallback((ids?: string[]) => {
    const copyIds = ids || Array.from(selectedIds);
    if (copyIds.length === 0) return;
    setClipboard({ type: 'files', ids: copyIds });
    setMessage(`${copyIds.length} file(s) copied to clipboard.`);
  }, [selectedIds]);

  const handleCut = useCallback((ids?: string[]) => {
    const cutIds = ids || Array.from(selectedIds);
    if (cutIds.length === 0) return;
    setClipboard({ type: 'cut', data: { type: 'files', ids: cutIds } });
    setMessage(`${cutIds.length} file(s) cut to clipboard.`);
  }, [selectedIds]);

  const handleCopyFolder = useCallback((folderPath: string) => {
    setClipboard({ type: 'folder', path: folderPath });
    setMessage(`Folder '${folderPath}' copied to clipboard.`);
  }, []);
  const handleCutFolder = useCallback((folderPath: string) => {
    setClipboard({ type: 'cut', data: { type: 'folder', path: folderPath } });
    setMessage(`Folder '${folderPath}' cut to clipboard.`);
  }, []);

  const handlePaste = useCallback((targetFolder?: string) => {
    if (!clipboard) { setMessage('Clipboard is empty.'); return; }
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
      setMessage(`${isCut ? 'Moved' : 'Copied'} ${data.ids.length} file(s)${targetFolder ? ' to ' + targetFolder : ''}.`);
    } else if (data.type === 'folder') {
      if (isCut) {
        const folderName = data.path.split('/').pop() || data.path;
        const newPath = targetFolder ? targetFolder + '/' + folderName : folderName;
        fileStore.moveFolder(data.path, newPath);
        setMessage(`Moved folder '${data.path}' to '${newPath}'.`);
      } else {
        fileStore.copyFolder(data.path, targetFolder);
        setMessage(`Copied folder '${data.path}'${targetFolder ? ' to ' + targetFolder : ''}.`);
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
    setStatus('idle'); setMessage('File saved.');
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
    setMessage(`Bound '${missingModule}' to source file. Recompile to apply.`);
  }, []);

  const handleBindingConfirm = useCallback((bindings: Record<string, string>) => {
    if (!bindingDialogFile) return;
    for (const [moduleName, fileId] of Object.entries(bindings)) {
      fileStore.setModuleBinding(bindingDialogFile.id, moduleName, fileId);
    }
    setMessage('Module bindings saved. Recompile to apply.');
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
      setMessage(next ? 'View mode — clicks on switches/buttons are ignored. Unlock to simulate.' : 'Interactive mode — click switches to simulate.');
      return next;
    });
  }, []);

  const handleToggleSimPause = useCallback(() => {
    setSimPaused((prev) => {
      const next = !prev;
      setMessage(next ? 'Simulation paused.' : 'Simulation running.');
      return next;
    });
  }, []);

  const handleSpeedChange = useCallback((ms: number) => {
    setSpeedMs(ms);
  }, []);

  // ============ Circuit -> source jump (double-click a cell) ============

  const [pendingJump, setPendingJump] = useState<{ fileId: string; line: number } | null>(null);

  const handleSourceJump = useCallback((srcName: string, line: number) => {
    const map = activeFile?.srcFileMap;
    const fileName = map?.[srcName];
    if (!fileName) {
      setMessage('This element has no source location mapping.');
      return;
    }
    const target = fileStore.getAll().find((f) => f.name === fileName);
    if (!target) {
      setMessage(`Source file "${fileName}" is no longer in the project.`);
      return;
    }
    openFileInTab(target.id);
    setViewMode('code');
    setPendingJump({ fileId: target.id, line });
    setMessage(`Jumped to ${fileName}:${line}`);
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
      ? `Highlighted ${n} element(s) from line ${pending.line}.`
      : `No top-level element on line ${pending.line} (may be inside a subcircuit).`);
  }, []);

  const handleCanvasRunningChange = useCallback((running: boolean) => {
    if (running && status !== 'compiling') {
      // engine started (possibly after a prior refused attempt) — clear stale error
      if (status === 'error' && /floating|looped|not started/i.test(message)) {
        setStatus('done');
        setMessage('Simulation running.');
      }
    } else if (!running && !simPaused) {
      setStatus('error');
      setMessage('Circuit has floating/looped wires — simulation not started.');
    }
  }, [simPaused, status, message]);

  // ============ Context Menus ============

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    const selCount = selectedIds.size;
    const multiSelected = selCount > 1;
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: multiSelected
        ? [
            { label: 'Copy', action: () => handleCopy() },
            { label: 'Cut', action: () => handleCut() },
            { label: `Delete ${selCount} Files`, danger: true, action: () => handleDeleteFiles(Array.from(selectedIds)) },
            { label: '---', disabled: true, action: () => {} },
            { label: 'Compile', action: async () => { openFileInTab(file.id); await tryCompileAll(file.id); } },
            { label: 'Bind...', action: () => setBindingDialogFile(file) },
            { label: 'Rename', action: async () => { const newName = await askPrompt({ title: 'Rename File', defaultValue: file.name, confirmLabel: 'Rename', validate: V_NAME_VALIDATE }); if (newName) handleRenameFile(file.id, newName); } },
          ]
        : [
            { label: 'Open', action: () => handleSelectFile(file.id) },
            { label: 'View Code', action: () => { handleSelectFile(file.id); setViewMode('code'); } },
            { label: 'Compile', action: async () => { openFileInTab(file.id); await tryCompileAll(file.id); } },
            { label: 'Bind...', action: () => setBindingDialogFile(file) },
            { label: '---', disabled: true, action: () => {} },
            { label: 'Copy', action: () => handleCopy([file.id]) },
            { label: 'Cut', action: () => handleCut([file.id]) },
            { label: 'Rename', action: async () => { const newName = await askPrompt({ title: 'Rename File', defaultValue: file.name, confirmLabel: 'Rename', validate: V_NAME_VALIDATE }); if (newName) handleRenameFile(file.id, newName); } },
            { label: 'Delete', danger: true, action: () => handleDeleteFile(file.id) },
          ],
    });
  }, [handleSelectFile, handleRenameFile, handleDeleteFile, handleDeleteFiles, tryCompileAll, handleCopy, handleCut, selectedIds, openFileInTab, askPrompt]);

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'New File', action: () => handleCreateFile() },
        { label: 'New Folder', action: () => handleCreateFolder() },
        { label: 'Import File...', action: () => handleImportFile() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Paste', action: () => handlePasteFromClipboard() },
        { label: 'Refresh from Disk', action: () => handleRefresh() },
      ],
    });
  }, [handleCreateFile, handleCreateFolder, handleImportFile, handlePasteFromClipboard, handleRefresh]);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderPath: string) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'New File...', action: async () => {
          const name = await askPrompt({
            title: `New File in ${folderPath}`, label: 'File name', defaultValue: 'my_module.v',
            confirmLabel: 'Create', validate: V_NAME_VALIDATE,
          });
          if (!name) return;
          const fullPath = folderPath + '/' + name;
          const entry = fileStore.createFile(fullPath);
          openFileInTab(entry.id);
          setViewMode('code');
          setStatus('idle'); setMessage('New file created.');
        }},
        { label: 'New Folder...', action: async () => {
          const name = await askPrompt({ title: 'New Subfolder', label: 'Folder name', defaultValue: 'child', confirmLabel: 'Create' });
          if (!name) return;
          fileStore.createFolder(folderPath + '/' + name);
          setMessage(`Folder '${name}' created.`);
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: 'Copy Folder', action: () => handleCopyFolder(folderPath) },
        { label: 'Cut Folder', action: () => handleCutFolder(folderPath) },
        { label: 'Paste', action: () => handlePaste(folderPath) },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Rename Folder', action: async () => {
          const newName = await askPrompt({ title: 'Rename Folder', defaultValue: folderPath.split('/').pop() || folderPath, confirmLabel: 'Rename' });
          if (!newName) return;
          const parts = folderPath.split('/');
          parts[parts.length - 1] = newName;
          fileStore.moveFolder(folderPath, parts.join('/'));
          setMessage(`Folder renamed to '${newName}'.`);
        }},
        { label: 'Delete Folder', danger: true, action: async () => {
          const ok = await askConfirm({
            title: 'Delete Folder', danger: true, confirmLabel: 'Delete',
            message: `Delete folder '${folderPath}' and all its contents?`,
            detail: 'Files inside will be removed from the project.',
          });
          if (ok) {
            fileStore.deleteFolder(folderPath);
            setMessage(`Folder '${folderPath}' deleted.`);
          }
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: 'Refresh from Disk', action: () => handleRefresh() },
      ],
    });
  }, [handleCopyFolder, handleCutFolder, handlePaste, openFileInTab, handleRefresh, askPrompt, askConfirm]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const cell = canvasRef.current?.probeCellAt(e.clientX, e.clientY);
    const drillItems = (cell?.drillable && cell.celltype)
      ? [
          { label: `↵ Enter ${cell.celltype}`, action: () => setViewPath((p) => [...p, cell.celltype]) },
          { label: '---', disabled: true, action: () => {} },
        ]
      : [];
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        ...drillItems,
        { label: 'Reset Zoom', action: () => canvasRef.current?.resetZoom() },
        { label: 'Fit to Window', action: () => canvasRef.current?.fitToWindow() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Export SVG', action: () => handleExportSVG() },
        { label: 'Export PNG', action: () => handleExportPNG() },
        { label: 'Export Circuit JSON', action: () => handleExportJSON() },
        { label: 'Export Synthesized Netlist', action: () => handleExportNetlist() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Compile', action: () => handleCompile() },
        { label: 'Import Verilog File...', action: () => handleImportFile() },
      ],
    });
  }, [handleCompile, handleImportFile, handleExportSVG, handleExportPNG, handleExportJSON, handleExportNetlist]);

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
      { id: 'view.examples', label: 'Open example circuits gallery', run: () => setExamplesVisible(true) },
      { id: 'view.toggleTheme', label: 'Toggle dark / light theme', run: handleToggleTheme },
      { id: 'view.resetZoom', label: 'Reset circuit zoom', run: () => canvasRef.current?.resetZoom() },
      { id: 'view.fitWindow', label: 'Fit circuit to window', run: () => canvasRef.current?.fitToWindow() },
      { id: 'view.exportSVG', label: 'Export circuit as SVG', run: handleExportSVG },
      { id: 'view.exportPNG', label: 'Export circuit as PNG', run: handleExportPNG },
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
            <span style={{
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
          <ActivityButton icon={<Files size={19} />} label="Files"
            active={leftPanel === 'files' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'files' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('files'); setSidebarCollapsed(false); }
            }}
          />
          <ActivityButton icon={<Boxes size={19} />} label="Modules"
            active={leftPanel === 'modules' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'modules' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('modules'); setSidebarCollapsed(false); }
            }}
          />
          <ActivityButton icon={<Network size={19} />} label="Hierarchy"
            active={leftPanel === 'hierarchy' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'hierarchy' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('hierarchy'); setSidebarCollapsed(false); }
            }}
          />
          <div style={{ flex: 1 }} />
          <ActivityButton icon={theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />} label="Theme"
            active={false} onClick={handleToggleTheme}
          />
        </div>

        {/* Left Panel */}
        {!sidebarCollapsed && (
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
          {/* Tab Bar */}
          <TabBar
            openFiles={openFiles}
            activeFileId={activeFileId}
            fileNameMap={fileNameMap}
            dirtyMap={dirtyMap}
            onSelectTab={openFileInTab}
            onCloseTab={closeTab}
            onReorderTabs={reorderTabs}
            rightSlot={<>            {/* Simulation controls — only meaningful with a rendered circuit */}
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
                    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                    background: simLocked ? 'var(--surface-hover)' : 'var(--success)',
                    color: simLocked ? 'var(--text-secondary)' : '#fff',
                  }}
                >{simLocked ? <><Lock size={13} /> View</> : <><LockOpen size={13} /> Simulate</>}</button>
                <button
                  onClick={handleToggleSimPause}
                  title={simPaused ? 'Resume simulation' : 'Pause simulation'}
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '4px 9px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    background: 'transparent', color: 'var(--text)',
                  }}
                >{simPaused ? <Play size={13} /> : <Pause size={13} />}</button>
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
                ><StepForward size={13} /> Step</button>
                {simPaused && debugTick > 0 && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', fontWeight: 600, padding: '0 4px' }}>
                    tick={debugTick}
                  </span>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
                  SPEED
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
                  title="Toggle live waveform of named nets"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                    background: waveOpen ? 'var(--accent)' : 'transparent',
                    color: waveOpen ? '#fff' : 'var(--text)',
                  }}
                ><AudioWaveform size={13} /> Wave</button>
                <button
                  onClick={() => setInputsOpen((v) => !v)}
                  title="Toggle input switches panel"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
                    background: inputsOpen ? 'var(--accent)' : 'transparent',
                    color: inputsOpen ? '#fff' : 'var(--text)',
                  }}
                ><SlidersHorizontal size={13} /> Inputs</button>
              </div>
            )}
            <button
              onClick={() => setExamplesVisible(true)}
              title="Open example circuits"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0 14px', height: 30, border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                fontSize: 'var(--fs-md)', background: 'var(--surface)', color: 'var(--text)',
                flexShrink: 0,
              }}
            ><Library size={14} /> Examples</button>
            {activeFile && (
              <>
                <button onClick={handleSave} title="Save (Ctrl+S)" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 30, border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  fontSize: 'var(--fs-md)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 500,
                }}><Save size={14} /> Save</button>
                <button onClick={handleCompile} disabled={status === 'compiling'} title="Compile (F5)" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: 30, border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: status === 'compiling' ? 'default' : 'pointer', fontSize: 'var(--fs-md)',
                  background: status === 'compiling' ? 'var(--text-muted)' : 'var(--accent)',
                  color: '#fff', fontWeight: 600,
                }}>{status === 'compiling' ? 'Compiling...' : <><Hammer size={14} /> Compile</>}</button>
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
                  title="Switch to circuit view (glows elements defined at the cursor line)"
                  style={{
                    background: viewMode === 'circuit' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'circuit' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Network size={13} /> Circuit</button>
                <button onClick={() => setViewMode('code')} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  style={{
                    background: viewMode === 'code' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'code' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Code size={13} /> Code</button>
                <button onClick={() => setViewMode('split')} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  title="Split: code left, circuit right"
                  style={{
                    background: viewMode === 'split' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'split' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Columns2 size={13} /> Split</button>
                <button onClick={() => setViewMode('sandbox')} className="inline-flex items-center gap-1.5 px-3.5 h-[26px] border-0 rounded-md cursor-pointer font-medium transition-all"
                  title="Sandbox: build circuits from scratch"
                  style={{
                    background: viewMode === 'sandbox' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'sandbox' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}><Box size={13} /> Sandbox</button>
              </div>
            )}</>}
          />

          {/* Content: Canvas or Code Editor */}
          <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden"
            onContextMenu={handleCanvasContextMenu}>
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
                  title="Back to top module"
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
                    <div className="text-lg font-medium" style={{ color: 'var(--text)' }}>No file selected</div>
                    <div className="flex gap-3">
                      <button onClick={handleImportFile} className="px-6 py-2.5 text-sm font-semibold rounded-lg border-0 cursor-pointer text-white transition-all hover:opacity-90 hover:shadow-lg"
                        style={{ background: 'var(--accent)' }}>Import .v File</button>
                      <button onClick={() => setExamplesVisible(true)} className="px-6 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:border-[var(--border)]"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>Open Example</button>
                      <button onClick={handleCreateFile} className="px-6 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:border-[var(--border)]"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>New File</button>
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
                        />
                      ) : (
                        <div style={{
                          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
                        }}>Press F5 to compile →</div>
                      )}
                    </div>
                  </div>
                );
              }

              if (viewMode === 'sandbox') {
                return <SandboxCanvas ref={sandboxRef} theme={theme} />;
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
                      : activeFile.status === 'error' ? 'Compilation error' : 'Not compiled'}
                  </div>
                  <div className="text-sm max-w-[420px] text-center leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {activeFile.errorMessage || 'Press F5 to compile. Check Output panel for details.'}
                  </div>
                  <button onClick={handleCompile} disabled={status === 'compiling'} className="mt-2 px-6 py-2.5 text-sm font-semibold rounded-lg border-0 cursor-pointer text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: status === 'compiling' ? 'var(--text-muted)' : 'var(--accent)',
                    }}>{status === 'compiling' ? 'Compiling...' : 'Compile (F5)'}</button>
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
              onClose={() => setWaveOpen(false)}
            />
          )}

          {/* Input switches panel (circuit view only) */}
          {inputsOpen && viewMode === 'circuit' && activeFile?.circuitJson && (
            <InputPanel canvasRef={canvasRef} open={inputsOpen} onClose={() => setInputsOpen(false)} />
          )}
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
          if (!target) { setMessage(`File "${fileName}" not found.`); return; }
          openFileInTab(target.id);
          setViewMode('code');
          setPendingJump({ fileId: target.id, line });
          setMessage(`Jumped to ${fileName}:${line}`);
        }}
      />

      {/* Bottom Status Bar */}
      <div className="flex items-center h-8 px-4 gap-4 text-[0.9rem]"
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
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span>Font: {editorFontSize}px</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ cursor: 'pointer' }}
          onClick={() => {
            const next = settingsStore.getDefaultViewMode() === 'circuit' ? 'code' : 'circuit';
            settingsStore.setDefaultViewMode(next);
          }}
          title="Click to toggle default view">Default: {defaultViewMode === 'circuit' ? 'Circuit' : 'Code'}</span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span style={{ cursor: 'pointer', color: outputPanelVisible ? 'var(--accent)' : 'var(--text-secondary)' }}
          onClick={() => setOutputPanelVisible((v) => !v)}
          title="Toggle Output Panel (Ctrl+J)">Output</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)' }}>
          Ctrl+S Save · F5 Compile · Ctrl+Shift+F Search
        </span>
      </div>

      {/* Custom Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
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
function ActivityButton({ icon, label, active, onClick }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={label} className={`activity-btn${active ? ' active' : ''}`}>
      {icon}
    </button>
  );
}