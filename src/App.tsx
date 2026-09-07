import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import Canvas from './components/Canvas';
import type { CanvasHandle } from './components/Canvas';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/CodeEditor';
import TabBar from './components/TabBar';
import ContextMenu from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import MissingModulesDialog from './components/MissingModulesDialog';
import ModulePanel from './components/ModulePanel';
import OutputPanel from './components/OutputPanel';
import BindingDialog from './components/BindingDialog';
import HierarchyViewer from './components/HierarchyViewer';
import SearchDialog from './components/SearchDialog';
import { compileVerilog, MissingModulesError, YosysCompileError, parseVerilogInstances, validateModuleInterfaces } from './lib/verilog';
import { fileStore, type FileEntry } from './store/fileStore';
import { themeStore } from './store/themeStore';
import { settingsStore, type ViewMode } from './store/settingsStore';
import { projectConfigStore } from './store/projectConfigStore';
import { exportSVG, exportPNG, exportCircuitJSON, exportVerilogCode } from './lib/exportUtils';

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
        circuitJson: result.circuitJson, status: 'compiled',
        errorMessage: undefined, missingModules: undefined,
      });
      setStatus('done');
      setMessage('Compiled successfully!');
      setMissingModules(null);
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

  const handleCreateFile = useCallback(() => {
    const name = prompt('Enter file name (e.g. my_module.v or subdir/my_module.v):');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const fileName = trimmed.split('/').pop() || trimmed;
    if (!fileName.endsWith('.v') && !fileName.endsWith('.sv') && !fileName.endsWith('.vh')) {
      alert('Only .v, .sv, or .vh files are supported for compilation.');
      return;
    }
    const entry = fileStore.createFile(trimmed);
    openFileInTab(entry.id);
    setSelectedIds(new Set([entry.id]));
    setViewMode('code');
    setStatus('idle');
    setMessage('New file created. Edit and compile to render.');
  }, [openFileInTab]);

  const handleCreateFolder = useCallback(() => {
    const name = prompt('Enter folder name:');
    if (!name || !name.trim()) return;
    fileStore.createFolder(name.trim());
    setMessage(`Folder '${name.trim()}' created.`);
  }, []);

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

  const handleCodeChange = useCallback((code: string) => {
    if (activeFileId) {
      fileStore.updateFile(activeFileId, { content: code });
      setDirtyMap((prev) => ({ ...prev, [activeFileId]: true }));
    }
  }, [activeFileId]);

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
            { label: 'Rename', action: () => { const newName = prompt('Rename file:', file.name); if (newName?.trim()) handleRenameFile(file.id, newName.trim()); } },
          ]
        : [
            { label: 'Open', action: () => handleSelectFile(file.id) },
            { label: 'View Code', action: () => { handleSelectFile(file.id); setViewMode('code'); } },
            { label: 'Compile', action: async () => { openFileInTab(file.id); await tryCompileAll(file.id); } },
            { label: 'Bind...', action: () => setBindingDialogFile(file) },
            { label: '---', disabled: true, action: () => {} },
            { label: 'Copy', action: () => handleCopy([file.id]) },
            { label: 'Cut', action: () => handleCut([file.id]) },
            { label: 'Rename', action: () => { const newName = prompt('Rename file:', file.name); if (newName?.trim()) handleRenameFile(file.id, newName.trim()); } },
            { label: 'Delete', danger: true, action: () => handleDeleteFile(file.id) },
          ],
    });
  }, [handleSelectFile, handleRenameFile, handleDeleteFile, handleDeleteFiles, tryCompileAll, handleCopy, handleCut, selectedIds, openFileInTab]);

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
        { label: 'New File...', action: () => {
          const name = prompt('Enter file name (e.g. my_module.v):');
          if (!name?.trim()) return;
          const fullPath = folderPath + '/' + name.trim();
          const fileName = fullPath.split('/').pop() || name.trim();
          if (!fileName.endsWith('.v') && !fileName.endsWith('.sv') && !fileName.endsWith('.vh')) {
            alert('Only .v, .sv, or .vh files are supported.');
            return;
          }
          const entry = fileStore.createFile(fullPath);
          openFileInTab(entry.id);
          setViewMode('code');
          setStatus('idle'); setMessage('New file created.');
        }},
        { label: 'New Folder...', action: () => {
          const name = prompt('Enter folder name:');
          if (!name?.trim()) return;
          fileStore.createFolder(folderPath + '/' + name.trim());
          setMessage(`Folder '${name.trim()}' created.`);
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: 'Copy Folder', action: () => handleCopyFolder(folderPath) },
        { label: 'Cut Folder', action: () => handleCutFolder(folderPath) },
        { label: 'Paste', action: () => handlePaste(folderPath) },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Rename Folder', action: () => {
          const newName = prompt('Rename folder:', folderPath.split('/').pop() || folderPath);
          if (!newName?.trim()) return;
          const parts = folderPath.split('/');
          parts[parts.length - 1] = newName.trim();
          fileStore.moveFolder(folderPath, parts.join('/'));
          setMessage(`Folder renamed to '${newName.trim()}'.`);
        }},
        { label: 'Delete Folder', danger: true, action: () => {
          if (confirm(`Delete folder '${folderPath}' and all its contents?`)) {
            fileStore.deleteFolder(folderPath);
            setMessage(`Folder '${folderPath}' deleted.`);
          }
        }},
        { label: '---', disabled: true, action: () => {} },
        { label: 'Refresh from Disk', action: () => handleRefresh() },
      ],
    });
  }, [handleCopyFolder, handleCutFolder, handlePaste, openFileInTab, handleRefresh]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Reset Zoom', action: () => canvasRef.current?.resetZoom() },
        { label: 'Fit to Window', action: () => canvasRef.current?.fitToWindow() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Export SVG', action: () => handleExportSVG() },
        { label: 'Export PNG', action: () => handleExportPNG() },
        { label: 'Export Circuit JSON', action: () => handleExportJSON() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Compile', action: () => handleCompile() },
        { label: 'Import Verilog File...', action: () => handleImportFile() },
      ],
    });
  }, [handleCompile, handleImportFile, handleExportSVG, handleExportPNG, handleExportJSON]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ============ Keyboard Shortcuts ============

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault(); handleImportFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault(); setSidebarCollapsed((c) => !c);
      } else if (e.key === 'F5') {
        e.preventDefault(); handleCompile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault(); handleCreateFile();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault(); setSearchDialogVisible((v) => !v);
      } else if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault(); handleDeleteFiles(Array.from(selectedIds));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault(); handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault(); handleCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault(); handlePasteFromClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault(); setOutputPanelVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleImportFile, handleSave, handleCompile, handleCreateFile, handleDeleteFiles, handleCopy, handleCut, handlePasteFromClipboard, selectedIds]);

  // ============ Render Helpers ============

  const statusColor =
    status === 'error' ? 'var(--danger)' :
    status === 'done' ? 'var(--success)' :
    status === 'compiling' ? '#ff9800' : 'var(--text-muted)';

  const hasMissingDeps = files.some((f) => f.status === 'missing_deps');

  return (
    <div className="w-screen h-screen flex flex-col bg-[var(--bg)]">
      {/* Menu Bar */}
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
        onGlobalSearch={() => setSearchDialogVisible(true)}
        hasCircuit={activeFile?.circuitJson != null}
      />

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-[48px] flex flex-col items-center pt-2 pb-2 gap-1 flex-shrink-0"
          style={{
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border-subtle)',
          }}>
          <ActivityButton icon="▦" label="Files"
            active={leftPanel === 'files' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'files' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('files'); setSidebarCollapsed(false); }
            }}
          />
          <ActivityButton icon="◫" label="Modules"
            active={leftPanel === 'modules' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'modules' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('modules'); setSidebarCollapsed(false); }
            }}
          />
          <ActivityButton icon="⊞" label="Hierarchy"
            active={leftPanel === 'hierarchy' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'hierarchy' && !sidebarCollapsed) { setSidebarCollapsed(true); }
              else { setLeftPanel('hierarchy'); setSidebarCollapsed(false); }
            }}
          />
          <div style={{ flex: 1 }} />
          <ActivityButton icon={theme === 'dark' ? '◎' : '◉'} label="Theme"
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
          />

          {/* Toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px',
            background: 'var(--toolbar-bg)', borderBottom: '1px solid var(--border)',
            flexShrink: 0, minHeight: 50,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: statusColor, flexShrink: 0,
              boxShadow: `0 0 6px ${statusColor}`,
            }} />
            <span style={{
              fontSize: '1.05rem', color: 'var(--text)', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500,
            }}>
              {activeFile ? `${activeFile.name} — ${message || 'Ready'}` : message || 'Verilog Visualizer'}
            </span>
            {activeFile && (
              <>
                <button onClick={handleSave} title="Save (Ctrl+S)" style={{
                  padding: '8px 20px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  fontSize: '1rem', background: 'var(--surface)', color: 'var(--text)', fontWeight: 500,
                }}>Save</button>
                <button onClick={handleCompile} disabled={status === 'compiling'} title="Compile (F5)" style={{
                  padding: '8px 20px', border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: status === 'compiling' ? 'default' : 'pointer', fontSize: '1rem',
                  background: status === 'compiling' ? 'var(--text-muted)' : 'var(--accent)',
                  color: '#fff', fontWeight: 600,
                }}>{status === 'compiling' ? 'Compiling...' : 'Compile'}</button>
                {hasMissingDeps && (
                  <button onClick={handleCompile} disabled={status === 'compiling'} style={{
                    padding: '8px 20px', border: 'none', borderRadius: 'var(--radius-md)',
                    cursor: status === 'compiling' ? 'default' : 'pointer', fontSize: '1rem',
                    background: 'var(--warning)', color: '#000', fontWeight: 600,
                  }}>Fix Dependencies</button>
                )}
              </>
            )}
            {activeFile && (
              <div style={{
                display: 'flex', gap: 4, marginLeft: 14, background: 'var(--surface)',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: 4,
              }}>
                <button onClick={() => setViewMode('circuit')} className="px-6 py-2.5 border-0 rounded-md cursor-pointer font-medium transition-all"
                  style={{
                    background: viewMode === 'circuit' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'circuit' ? '#fff' : 'var(--text-secondary)',
                    fontSize: '1.05rem',
                  }}>Circuit</button>
                <button onClick={() => setViewMode('code')} className="px-6 py-2.5 border-0 rounded-md cursor-pointer font-medium transition-all"
                  style={{
                    background: viewMode === 'code' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'code' ? '#fff' : 'var(--text-secondary)',
                    fontSize: '1.05rem',
                  }}>Code</button>
              </div>
            )}
          </div>

          {/* Content: Canvas or Code Editor */}
          <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden"
            onContextMenu={handleCanvasContextMenu}>
            {(() => {
              if (!activeFile) {
                return (
                  <div className="flex flex-col justify-center items-center h-full gap-6 select-none"
                    style={{ color: 'var(--text-secondary)' }}>
                    <div className="text-6xl font-light opacity-10 leading-none">◈</div>
                    <div className="text-lg font-medium" style={{ color: 'var(--text)' }}>No file selected</div>
                    <div className="flex gap-3">
                      <button onClick={handleImportFile} className="px-6 py-2.5 text-sm font-semibold rounded-lg border-0 cursor-pointer text-white transition-all hover:opacity-90 hover:shadow-lg"
                        style={{ background: 'var(--accent)' }}>Import .v File</button>
                      <button onClick={handleCreateFile} className="px-6 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:border-[var(--border)]"
                        style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>New File</button>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Ctrl+O to import · Ctrl+N to create · F5 to compile
                    </div>
                  </div>
                );
              }

              if (viewMode === 'code') {
                return (
                  <CodeEditor
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
                    circuitJson={activeFile.circuitJson}
                    theme={theme}
                    onError={handleCanvasError}
                  />
                );
              }

              return (
                <div className="flex flex-col justify-center items-center h-full gap-5 select-none"
                  style={{ color: 'var(--text-secondary)' }}>
                  <div className="text-5xl font-light opacity-10">
                    {activeFile.status === 'missing_deps' ? '△' : '◈'}
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
        </div>
      </div>

      {/* Output Panel */}
      <OutputPanel
        log={yosysLog}
        visible={outputPanelVisible}
        onToggle={() => setOutputPanelVisible((v) => !v)}
        onClose={() => setOutputPanelVisible(false)}
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
    </div>
  );
}

/** IDE-style activity bar button */
function ActivityButton({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={label} style={{
      width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.15rem', background: active ? 'var(--accent-muted)' : 'transparent',
      border: 'none', borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      cursor: 'pointer', color: active ? 'var(--accent)' : 'var(--text-muted)',
      borderRadius: 0, transition: 'all var(--transition-fast)',
    }}
      onMouseEnter={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; } }}
      onMouseLeave={(e) => { if (!active) { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
    >{icon}</button>
  );
}