import { useState, useCallback, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import Canvas from './components/Canvas';
import type { CanvasHandle } from './components/Canvas';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/CodeEditor';
import ContextMenu from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import MissingModulesDialog from './components/MissingModulesDialog';
import ModulePanel from './components/ModulePanel';
import OutputPanel from './components/OutputPanel';
import BindingDialog from './components/BindingDialog';
import { compileVerilog, MissingModulesError, YosysCompileError, parseVerilogInstances, validateModuleInterfaces } from './lib/verilog';
import { fileStore, type FileEntry } from './store/fileStore';
import { themeStore } from './store/themeStore';
import { settingsStore, type ViewMode } from './store/settingsStore';

type Status = 'idle' | 'compiling' | 'done' | 'error';

type ClipboardEntry = 
  | { type: 'files'; ids: string[] }
  | { type: 'folder'; path: string }
  | { type: 'cut'; data: { type: 'files'; ids: string[] } | { type: 'folder'; path: string } }
  | null;

export default function App() {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('circuit');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<ClipboardEntry>(null);
  const lastClickedIndex = useRef<number>(-1);
  const canvasRef = useRef<CanvasHandle>(null);

  // Missing modules dialog state
  const [missingModules, setMissingModules] = useState<string[] | null>(null);

  // Output panel state
  const [yosysLog, setYosysLog] = useState('');
  const [outputPanelVisible, setOutputPanelVisible] = useState(false);

  // IDE panel state: 'files' | 'modules'
  const [leftPanel, setLeftPanel] = useState<'files' | 'modules'>('files');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Binding dialog state
  const [bindingDialogFile, setBindingDialogFile] = useState<FileEntry | null>(null);

  // Sidebar resize state
  const SIDEBAR_WIDTH_KEY = 'verilog-viz-sidebar-width';
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (n >= 180 && n <= 500) return n;
      }
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
      // Save to localStorage
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

  // Flat file list for range selection (Shift+click)
  const flatFiles = useMemo(() => {
    const result: FileEntry[] = [...files];
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [files]);

  const activeFile = activeFileId ? fileStore.getById(activeFileId) : undefined;

  // Load project files on startup (no auto-compile)
  useEffect(() => {
    fileStore.loadFromProjectDir();
  }, []);

  // Disable browser default context menu globally
  useEffect(() => {
    const preventDefaultContext = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener('contextmenu', preventDefaultContext);
    return () => document.removeEventListener('contextmenu', preventDefaultContext);
  }, []);

  // ============ Dependency Resolution ============

  /** Resolve all dependency files for a target file using moduleBindings and definedModules */
  function resolveDependencies(targetFileId: string): FileEntry[] {
    const allFiles = fileStore.getAll();
    const targetFile = allFiles.find((f) => f.id === targetFileId);
    if (!targetFile) return [];

    const included = new Set<string>([targetFileId]);
    const result: FileEntry[] = [targetFile];

    // Build a module-to-file map
    const moduleToFile = new Map<string, FileEntry>();
    for (const f of allFiles) {
      if (f.definedModules) {
        for (const mod of f.definedModules) {
          moduleToFile.set(mod, f);
        }
      }
    }

    // Queue of files to process
    const queue = [targetFile];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Find modules instantiated by this file
      const instances = parseVerilogInstances(current.content);

      for (const modName of instances) {
        // Check manual bindings first
        const boundFileId = current.moduleBindings?.[modName];
        if (boundFileId) {
          const boundFile = allFiles.find((f) => f.id === boundFileId);
          if (boundFile && !included.has(boundFile.id)) {
            included.add(boundFile.id);
            result.push(boundFile);
            queue.push(boundFile);
          }
          continue;
        }

        // Check auto-resolution via definedModules
        const definingFile = moduleToFile.get(modName);
        if (definingFile && !included.has(definingFile.id)) {
          included.add(definingFile.id);
          result.push(definingFile);
          queue.push(definingFile);
        }
      }
    }

    return result;
  }

  // ============ Compilation ============

  /** Compile the target file with its resolved dependencies */
  const tryCompileAll = useCallback(
    async (targetFileId: string) => {
      const allFiles = fileStore.getAll();
      if (allFiles.length === 0) return;

      const targetFile = fileStore.getById(targetFileId);
      if (!targetFile) return;

      setStatus('compiling');
      setMessage('Compiling...');
      setYosysLog('');

      // Resolve which files are needed for this target
      const dependencyFiles = resolveDependencies(targetFileId);
      const fileList = dependencyFiles.map((f) => ({ name: f.name, content: f.content }));

      // Determine top module: use the first defined module of the target file
      const topModule = targetFile.definedModules?.[0];

      setYosysLog(`Compiling '${topModule || targetFile.name}' with ${dependencyFiles.length} file(s)...\n`);

      // ===== Pre-compilation validation =====
      const validationErrors = validateModuleInterfaces(fileList);
      if (validationErrors.length > 0) {
        let log = '========== 模块接口验证错误 ==========\n\n';
        for (const err of validationErrors) {
          log += `[错误] ${err.message}\n`;
          log += `  文件: ${err.fileName}\n`;
          if (err.instanceName) {
            log += `  实例: ${err.instanceName}\n`;
          }
          log += `  模块: ${err.moduleName}\n`;
          log += `  详情: ${err.detail}\n`;
          log += '\n';
        }
        log += `共 ${validationErrors.length} 个验证错误。请修复后重新编译。\n`;
        log += '========================================\n';

        fileStore.updateFile(targetFileId, {
          status: 'error',
          errorMessage: `接口验证失败: ${validationErrors.length} 个错误`,
          missingModules: undefined,
          circuitJson: null,
        });
        setStatus('error');
        setMessage(`接口验证失败: ${validationErrors.length} 个错误`);
        setYosysLog((prev) => prev + '\n' + log);
        setOutputPanelVisible(true);
        return;
      }

      try {
        const result = await compileVerilog(fileList, topModule);

        // Store circuitJson on the target file only
        fileStore.updateFile(targetFileId, {
          circuitJson: result.circuitJson,
          status: 'compiled',
          errorMessage: undefined,
          missingModules: undefined,
        });

        setStatus('done');
        setMessage('Compiled successfully!');
        setMissingModules(null);
        setYosysLog((prev) => prev + '\n' + result.yosysLog);
        setOutputPanelVisible(true);
      } catch (err: any) {
        const log = err instanceof MissingModulesError ? err.yosysLog :
                    err instanceof YosysCompileError ? err.yosysLog :
                    '';

        if (err instanceof MissingModulesError) {
          // Mark the target file as missing_deps
          fileStore.updateFile(targetFileId, {
            status: 'missing_deps',
            errorMessage: err.message,
            missingModules: err.missingModules,
            circuitJson: null,
          });
          setMissingModules(err.missingModules);
          setStatus('error');
          setMessage(err.message);
          setYosysLog((prev) => prev + '\n' + log);
          setOutputPanelVisible(true);
        } else {
          fileStore.updateFile(targetFileId, {
            status: 'error',
            errorMessage: err.message || 'Compilation failed',
            missingModules: undefined,
          });
          setStatus('error');
          setMessage(err.message || 'Compilation failed');
          setYosysLog((prev) => prev + '\n' + (log || err.message || 'Unknown error'));
          setOutputPanelVisible(true);
          console.error(err);
        }
      }
    },
    []
  );

  // ============ File Operations ============

  const handleImportFile = useCallback(async () => {
    try {
      setStatus('idle');
      setMessage('');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.v,.sv,.vh';
      input.multiple = true;

      input.onchange = async (e: Event) => {
        const fileList = (e.target as HTMLInputElement).files;
        if (!fileList || fileList.length === 0) return;

        setStatus('compiling');
        setMessage('Importing files...');

        let primaryId: string | null = null;

        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const text = await file.text();
          // Try to get the full path from the file object (Tauri provides this)
          const fullPath = (file as any).path || file.name;
          const entry = fileStore.addFile(file.name, text, fullPath);
          if (i === 0) {
            primaryId = entry.id;
          }
        }

        if (primaryId) {
          setActiveFileId(primaryId);
          setViewMode(defaultViewMode);
          await tryCompileAll(primaryId);
        }
      };

      input.click();
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message);
    }
  }, [tryCompileAll, defaultViewMode]);

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
    setActiveFileId(entry.id);
    setSelectedIds(new Set([entry.id]));
    setViewMode('code');
    setStatus('idle');
    setMessage('New file created. Edit and compile to render.');
  }, []);

  const handleCreateFolder = useCallback(() => {
    const name = prompt('Enter folder name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    fileStore.createFolder(trimmed);
    setMessage(`Folder '${trimmed}' created.`);
  }, []);

  const handleSelectFile = useCallback((id: string) => {
    setActiveFileId(id);
    setSelectedIds(new Set([id]));
    setViewMode(defaultViewMode);
    const file = fileStore.getById(id);
    if (!file) return;

    if (file.status === 'compiled' && file.circuitJson) {
      setStatus('done');
      setMessage('Loaded from cache.');
    } else if (file.status === 'missing_deps') {
      setStatus('error');
      setMessage(file.errorMessage || 'Missing module implementations');
      if (file.missingModules) setMissingModules(file.missingModules);
    } else if (file.status === 'error') {
      setStatus('error');
      setMessage(file.errorMessage || 'Compilation error');
    } else {
      setStatus('idle');
      setMessage('Pending compilation. Press F5 to compile.');
    }
  }, [defaultViewMode]);

  const handleMultiSelect = useCallback((id: string, ctrl: boolean, shift: boolean) => {
    setActiveFileId(id);

    if (shift) {
      // Range select from last clicked file to this one
      const currentIndex = flatFiles.findIndex((f) => f.id === id);
      const prevIndex = lastClickedIndex.current;
      if (prevIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(prevIndex, currentIndex);
        const end = Math.max(prevIndex, currentIndex);
        const rangeIds = new Set<string>();
        for (let i = start; i <= end; i++) {
          rangeIds.add(flatFiles[i].id);
        }
        setSelectedIds(rangeIds);
      } else {
        setSelectedIds(new Set([id]));
      }
      lastClickedIndex.current = currentIndex;
    } else if (ctrl) {
      // Toggle selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastClickedIndex.current = flatFiles.findIndex((f) => f.id === id);
    } else {
      // Single select
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
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (activeFileId === id) {
      setActiveFileId(null);
      setStatus('idle');
      setMessage('');
      setMissingModules(null);
    }
  }, [activeFileId]);

  const handleDeleteFiles = useCallback((ids: string[]) => {
    for (const id of ids) {
      fileStore.deleteFile(id);
    }
    setSelectedIds(new Set());
    if (ids.includes(activeFileId || '')) {
      setActiveFileId(null);
      setStatus('idle');
      setMessage('');
      setMissingModules(null);
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
    if (!clipboard) {
      setMessage('Clipboard is empty.');
      return;
    }

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
      setMessage(`${isCut ? 'Moved' : 'Copied'} ${data.ids.length} file(s) ${targetFolder ? 'to ' + targetFolder : ''}.`);
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

    if (isCut) {
      setClipboard(null);
    }
  }, [clipboard]);

  const handlePasteFromClipboard = useCallback(() => {
    handlePaste();
  }, [handlePaste]);

  const handleRenameFile = useCallback((id: string, name: string) => {
    fileStore.renameFile(id, name);
  }, []);

  // ============ Save vs Compile ============

  /** Save file content to disk only (Ctrl+S) */
  const handleSave = useCallback(() => {
    if (!activeFileId) return;
    const file = fileStore.getById(activeFileId);
    if (!file) return;
    fileStore.saveContent(activeFileId, file.content);
    setStatus('idle');
    setMessage('File saved.');
  }, [activeFileId]);

  /** Compile current file (F5) */
  const handleCompile = useCallback(async () => {
    if (!activeFileId) return;
    await tryCompileAll(activeFileId);
  }, [activeFileId, tryCompileAll]);

  // ============ Code Editor ============

  const handleCodeChange = useCallback(
    (code: string) => {
      if (activeFileId) {
        fileStore.updateFile(activeFileId, { content: code });
      }
    },
    [activeFileId]
  );

  // ============ Module Binding ============

  const handleBindModule = useCallback(
    (fileId: string, missingModule: string, sourceFileId: string) => {
      fileStore.setModuleBinding(fileId, missingModule, sourceFileId);
      setMessage(`Bound '${missingModule}' to source file. Recompile to apply.`);
    },
    []
  );

  const handleBindingConfirm = useCallback(
    (bindings: Record<string, string>) => {
      if (!bindingDialogFile) return;
      for (const [moduleName, fileId] of Object.entries(bindings)) {
        fileStore.setModuleBinding(bindingDialogFile.id, moduleName, fileId);
      }
      setMessage('Module bindings saved. Recompile to apply.');
      setBindingDialogFile(null);
    },
    [bindingDialogFile]
  );

  // ============ Theme ============

  const handleToggleTheme = useCallback(() => {
    themeStore.toggle();
  }, []);

  const handleCanvasError = useCallback((msg: string) => {
    setStatus('error');
    setMessage(msg);
  }, []);

  // ============ Context Menus ============

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    const selCount = selectedIds.size;
    const multiSelected = selCount > 1;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: multiSelected
        ? [
            { label: 'Copy', action: () => handleCopy() },
            { label: 'Cut', action: () => handleCut() },
            { label: `Delete ${selCount} Files`, danger: true, action: () => handleDeleteFiles(Array.from(selectedIds)) },
            { label: '---', disabled: true, action: () => {} },
            { label: 'Compile', action: async () => { setActiveFileId(file.id); await tryCompileAll(file.id); } },
            { label: 'Bind...', action: () => setBindingDialogFile(file) },
            { label: 'Rename', action: () => {
              const newName = prompt('Rename file:', file.name);
              if (newName && newName.trim()) handleRenameFile(file.id, newName.trim());
            }},
          ]
        : [
            { label: 'Open', action: () => handleSelectFile(file.id) },
            { label: 'View Code', action: () => { handleSelectFile(file.id); setViewMode('code'); } },
            { label: 'Compile', action: async () => { setActiveFileId(file.id); await tryCompileAll(file.id); } },
            { label: 'Bind...', action: () => setBindingDialogFile(file) },
            { label: '---', disabled: true, action: () => {} },
            { label: 'Copy', action: () => handleCopy([file.id]) },
            { label: 'Cut', action: () => handleCut([file.id]) },
            {
              label: 'Rename',
              action: () => {
                const newName = prompt('Rename file:', file.name);
                if (newName && newName.trim()) handleRenameFile(file.id, newName.trim());
              },
            },
            { label: 'Delete', danger: true, action: () => handleDeleteFile(file.id) },
          ],
    });
  }, [handleSelectFile, handleRenameFile, handleDeleteFile, handleDeleteFiles, tryCompileAll, handleCopy, handleCut, selectedIds]);

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New File', action: () => handleCreateFile() },
        { label: 'New Folder', action: () => handleCreateFolder() },
        { label: 'Import File...', action: () => handleImportFile() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Paste', action: () => handlePasteFromClipboard() },
      ],
    });
  }, [handleCreateFile, handleCreateFolder, handleImportFile, handlePasteFromClipboard]);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New File...', action: () => {
          const name = prompt('Enter file name (e.g. my_module.v):');
          if (!name || !name.trim()) return;
          const trimmed = name.trim();
          const fullPath = folderPath + '/' + trimmed;
          const fileName = fullPath.split('/').pop() || trimmed;
          if (!fileName.endsWith('.v') && !fileName.endsWith('.sv') && !fileName.endsWith('.vh')) {
            alert('Only .v, .sv, or .vh files are supported for compilation.');
            return;
          }
          const entry = fileStore.createFile(fullPath);
          setActiveFileId(entry.id);
          setViewMode('code');
          setStatus('idle');
          setMessage('New file created. Edit and compile to render.');
        }},
        { label: 'New Folder...', action: () => {
          const name = prompt('Enter folder name:');
          if (!name || !name.trim()) return;
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
          if (!newName || !newName.trim()) return;
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
      ],
    });
  }, [handleCopyFolder, handleCutFolder, handlePaste]);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Reset Zoom', action: () => canvasRef.current?.resetZoom() },
        { label: 'Fit to Window', action: () => canvasRef.current?.fitToWindow() },
        { label: '---', disabled: true, action: () => {} },
        { label: 'Compile', action: () => handleCompile() },
        { label: 'Import Verilog File...', action: () => handleImportFile() },
      ],
    });
  }, [handleCompile, handleImportFile]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ============ Keyboard Shortcuts ============

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleImportFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      } else if (e.key === 'F5') {
        e.preventDefault();
        handleCompile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleCreateFile();
      } else if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault();
        handleDeleteFiles(Array.from(selectedIds));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        handleCopy();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        handleCut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        handlePasteFromClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        setOutputPanelVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleImportFile, handleSave, handleCompile, handleCreateFile, handleDeleteFiles, handleCopy, handleCut, handlePasteFromClipboard, selectedIds]);

  // ============ Render Helpers ============

  const statusColor =
    status === 'error' ? 'var(--danger)' :
    status === 'done' ? 'var(--success)' :
    status === 'compiling' ? '#ff9800' : 'var(--text-dim)';

  const hasMissingDeps = files.some((f) => f.status === 'missing_deps');

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Menu Bar */}
      <MenuBar
        onImportFile={handleImportFile}
        onToggleTheme={handleToggleTheme}
        onResetZoom={() => canvasRef.current?.resetZoom()}
        onFitToWindow={() => canvasRef.current?.fitToWindow()}
        onCreateFile={handleCreateFile}
        currentTheme={theme}
      />

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar (IDE-style left icon bar) */}
        <div
          style={{
            width: 44,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 6,
            paddingBottom: 6,
            background: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border-subtle)',
            flexShrink: 0,
            gap: 2,
          }}
        >
          <ActivityButton
            icon="▦"
            label="Files"
            active={leftPanel === 'files' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'files' && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setLeftPanel('files');
                setSidebarCollapsed(false);
              }
            }}
          />
          <ActivityButton
            icon="◫"
            label="Modules"
            active={leftPanel === 'modules' && !sidebarCollapsed}
            onClick={() => {
              if (leftPanel === 'modules' && !sidebarCollapsed) {
                setSidebarCollapsed(true);
              } else {
                setLeftPanel('modules');
                setSidebarCollapsed(false);
              }
            }}
          />
          <div style={{ flex: 1 }} />
          <ActivityButton
            icon={theme === 'dark' ? '◎' : '◉'}
            label="Theme"
            active={false}
            onClick={handleToggleTheme}
          />
        </div>

        {/* Left Panel: Files or Modules */}
        {!sidebarCollapsed && (
          <div
            style={{
              width: sidebarWidth,
              minWidth: 180,
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--sidebar-bg)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {leftPanel === 'files' ? (
              <Sidebar
                files={files}
                folders={folders}
                activeFileId={activeFileId}
                selectedIds={selectedIds}
                onSelectFile={handleSelectFile}
                onMultiSelect={handleMultiSelect}
                onRenameFile={handleRenameFile}
                onImportFile={handleImportFile}
                onContextMenu={handleFileContextMenu}
                onEmptyContextMenu={handleEmptyAreaContextMenu}
                onFolderContextMenu={handleFolderContextMenu}
                collapsed={false}
                onToggleCollapse={() => setSidebarCollapsed(true)}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onMoveFiles={handleMoveFiles}
                onMoveFolder={handleMoveFolder}
              />
            ) : (
              <ModulePanel
                files={files}
                onSelectFile={handleSelectFile}
                onBindModule={handleBindModule}
                onRecompile={handleCompile}
                isCompiling={status === 'compiling'}
              />
            )}

            {/* Resize handle */}
            <div
              onMouseDown={handleSidebarDragStart}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 4,
                height: '100%',
                cursor: 'col-resize',
                background: isDraggingSidebar ? 'var(--accent)' : 'transparent',
                zIndex: 10,
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                if (!isDraggingSidebar) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }
              }}
            />
          </div>
        )}

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 14px',
              background: 'var(--toolbar-bg)',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
              minHeight: 38,
            }}
          >
            <div
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: statusColor, flexShrink: 0,
                boxShadow: `0 0 6px ${statusColor}`,
              }}
            />
            <span
              style={{
                fontSize: '0.88rem', color: 'var(--text)', flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', fontWeight: 500,
              }}
            >
              {activeFile ? `${activeFile.name} — ${message || 'Ready'}` : message || 'Verilog Visualizer'}
            </span>
            {activeFile && (
              <>
                <button
                  onClick={handleSave}
                  title="Save (Ctrl+S)"
                  style={{
                    padding: '4px 14px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    fontSize: '0.82rem', background: 'var(--surface)',
                    color: 'var(--text)', fontWeight: 500,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
                  }}
                >
                  Save
                </button>
                <button
                  onClick={handleCompile}
                  disabled={status === 'compiling'}
                  title="Compile (F5)"
                  style={{
                    padding: '4px 14px', border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: status === 'compiling' ? 'default' : 'pointer',
                    fontSize: '0.82rem',
                    background: status === 'compiling'
                      ? 'var(--text-muted)'
                      : 'var(--accent)',
                    color: '#fff', fontWeight: 600,
                  }}
                  onMouseEnter={(e) => {
                    if (status !== 'compiling') {
                      (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (status !== 'compiling') {
                      (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
                    }
                  }}
                >
                  {status === 'compiling' ? 'Compiling...' : 'Compile'}
                </button>
                {hasMissingDeps && (
                  <button
                    onClick={handleCompile}
                    disabled={status === 'compiling'}
                    style={{
                      padding: '4px 14px', border: 'none',
                      borderRadius: 'var(--radius-md)',
                      cursor: status === 'compiling' ? 'default' : 'pointer',
                      fontSize: '0.82rem',
                      background: 'var(--warning)',
                      color: '#000', fontWeight: 600,
                    }}
                  >
                    Fix Dependencies
                  </button>
                )}
              </>
            )}
            {activeFile && (
              <div
                style={{
                  display: 'flex', gap: 1, marginLeft: 8,
                  background: 'var(--surface)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  padding: 1,
                }}
              >
                <button
                  onClick={() => setViewMode('circuit')}
                  style={{
                    padding: '3px 10px', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontSize: '0.77rem', fontWeight: 500,
                    background: viewMode === 'circuit'
                      ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'circuit'
                      ? '#fff' : 'var(--text-secondary)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Circuit
                </button>
                <button
                  onClick={() => setViewMode('code')}
                  style={{
                    padding: '3px 10px', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    fontSize: '0.77rem', fontWeight: 500,
                    background: viewMode === 'code'
                      ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'code'
                      ? '#fff' : 'var(--text-secondary)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  Code
                </button>
              </div>
            )}
          </div>

          {/* Content: Canvas or Code Editor */}
          <div
            style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            onContextMenu={handleCanvasContextMenu}
          >
            {(() => {
              if (!activeFile) {
                return (
                  <div style={{
                    display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center',
                    height: '100%', color: 'var(--text-secondary)',
                    userSelect: 'none', gap: 16,
                  }}>
                    <div style={{
                      fontSize: '4rem', opacity: 0.15,
                      fontWeight: 300, lineHeight: 1,
                    }}>◈</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 500, color: 'var(--text)' }}>
                      No file selected
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={handleImportFile} style={{
                        padding: '8px 22px',
                        background: 'var(--accent)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        cursor: 'pointer', fontSize: '0.92rem',
                        fontWeight: 600,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
                      }}
                      >Import .v File</button>
                      <button onClick={handleCreateFile} style={{
                        padding: '8px 22px',
                        background: 'var(--surface)', color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer', fontSize: '0.92rem',
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
                      }}
                      >New File</button>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
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
                    onRecompile={handleCompile}
                    onSave={handleSave}
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
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  justifyContent: 'center', alignItems: 'center',
                  height: '100%', color: 'var(--text-secondary)',
                  userSelect: 'none', gap: 14,
                }}>
                  <div style={{ fontSize: '3rem', opacity: 0.15, fontWeight: 300 }}>
                    {activeFile.status === 'missing_deps' ? '△' : '◈'}
                  </div>
                  <div style={{ fontSize: '1.08rem', fontWeight: 500, color: 'var(--text)' }}>
                    {activeFile.status === 'missing_deps'
                      ? 'Missing dependencies'
                      : activeFile.status === 'error'
                      ? 'Compilation error'
                      : 'Not compiled'}
                  </div>
                  <div style={{
                    fontSize: '0.88rem', color: 'var(--text-secondary)',
                    maxWidth: 420, textAlign: 'center',
                  }}>
                    {activeFile.errorMessage || 'Press F5 to compile. Check Output panel for details.'}
                  </div>
                  <button onClick={handleCompile} disabled={status === 'compiling'} style={{
                    marginTop: 6, padding: '8px 22px',
                    background: status === 'compiling'
                      ? 'var(--text-muted)' : 'var(--accent)',
                    color: '#fff', border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', fontSize: '0.92rem',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => {
                    if (status !== 'compiling') {
                      (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (status !== 'compiling') {
                      (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
                    }
                  }}
                  >
                    {status === 'compiling' ? 'Compiling...' : 'Compile (F5)'}
                  </button>
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
      <div style={{
        display: 'flex', alignItems: 'center', height: 24,
        padding: '0 14px',
        background: 'var(--statusbar-bg)', color: 'var(--text-secondary)',
        fontSize: '0.74rem', flexShrink: 0, gap: 14,
        borderTop: '1px solid var(--border-subtle)',
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
          title="Click to toggle default view"
        >
          Default: {defaultViewMode === 'circuit' ? 'Circuit' : 'Code'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>|</span>
        <span
          style={{ cursor: 'pointer', color: outputPanelVisible ? 'var(--accent)' : 'var(--text-secondary)' }}
          onClick={() => setOutputPanelVisible((v) => !v)}
          title="Toggle Output Panel (Ctrl+J)"
        >
          {outputPanelVisible ? 'Output' : 'Output'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)' }}>
          Ctrl+S Save · F5 Compile · Ctrl+J Output
        </span>
      </div>

      {/* Custom Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}

      {/* Missing Modules Dialog */}
      {missingModules && missingModules.length > 0 && (
        <MissingModulesDialog
          missingModules={missingModules}
          onImport={handleImportFile}
          onRecompile={handleCompile}
          onClose={() => setMissingModules(null)}
          isCompiling={status === 'compiling'}
        />
      )}

      {/* Binding Dialog */}
      {bindingDialogFile && (
        <BindingDialog
          file={bindingDialogFile}
          allFiles={files}
          onConfirm={handleBindingConfirm}
          onCancel={() => setBindingDialogFile(null)}
        />
      )}
    </div>
  );
}

/** IDE-style activity bar button */
function ActivityButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 38,
        height: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.15rem',
        background: active ? 'var(--accent-muted)' : 'transparent',
        border: 'none',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        borderRadius: 0,
        transition: 'all var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
          (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }
      }}
    >
      {icon}
    </button>
  );
}