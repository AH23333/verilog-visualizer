import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import Canvas from './components/Canvas';
import type { CanvasHandle } from './components/Canvas';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import CodeEditor from './components/CodeEditor';
import ContextMenu from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import { compileVerilog } from './lib/verilog';
import { fileStore, type FileEntry } from './store/fileStore';
import { themeStore } from './store/themeStore';
import { settingsStore } from './store/settingsStore';

type Status = 'idle' | 'compiling' | 'done' | 'error';
type ViewMode = 'circuit' | 'code';

export default function App() {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('circuit');
  const canvasRef = useRef<CanvasHandle>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Subscribe to file store changes
  const files = useSyncExternalStore(
    fileStore.subscribe,
    () => fileStore.getAll()
  );

  // Subscribe to theme changes
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    () => themeStore.get()
  );

  // Subscribe to font size changes
  const editorFontSize = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getFontSize()
  );

  const activeFile = activeFileId ? fileStore.getById(activeFileId) : undefined;

  // Load project files on startup
  useEffect(() => {
    fileStore.loadFromProjectDir();
  }, []);

  // Disable browser default context menu globally
  useEffect(() => {
    const preventDefaultContext = (e: MouseEvent) => {
      // Only prevent if our custom menu isn't open
      // (contextMenu state might not be updated yet, so we check the DOM)
      e.preventDefault();
    };
    document.addEventListener('contextmenu', preventDefaultContext);
    return () => document.removeEventListener('contextmenu', preventDefaultContext);
  }, []);

  const handleImportFile = useCallback(async () => {
    try {
      setStatus('idle');
      setMessage('');

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.v,.sv,.vh';

      input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        setStatus('compiling');
        setMessage('Compiling Verilog...');

        try {
          const text = await file.text();

          // Add to file store (will also save to project directory)
          const entry = fileStore.addFile(file.name, text);
          setActiveFileId(entry.id);

          // Compile
          const json = await compileVerilog(text);

          fileStore.updateFile(entry.id, {
            circuitJson: json,
            status: 'compiled',
          });

          setStatus('done');
          setMessage('Done! Click switches to interact.');
        } catch (err: any) {
          const currentFiles = fileStore.getAll();
          const lastFile = currentFiles[currentFiles.length - 1];
          if (lastFile && lastFile.status === 'pending') {
            fileStore.updateFile(lastFile.id, {
              status: 'error',
              errorMessage: err.message || 'Compilation failed',
            });
          }
          setStatus('error');
          setMessage(err.message || 'Compilation failed');
          console.error(err);
        }
      };

      input.click();
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message);
    }
  }, []);

  const handleSelectFile = useCallback(async (id: string) => {
    setActiveFileId(id);
    setViewMode('circuit');
    const file = fileStore.getById(id);
    if (!file) return;

    if (file.status === 'compiled' && file.circuitJson) {
      setStatus('done');
      setMessage('Loaded from project.');
    } else if (file.status === 'error') {
      setStatus('error');
      setMessage(file.errorMessage || 'Compilation error');
    } else {
      // Auto-compile pending files (loaded from project dir on startup)
      setStatus('compiling');
      setMessage('Compiling Verilog...');
      try {
        const json = await compileVerilog(file.content);
        fileStore.updateFile(id, {
          circuitJson: json,
          status: 'compiled',
          errorMessage: undefined,
        });
        setStatus('done');
        setMessage('Done! Click switches to interact.');
      } catch (err: any) {
        fileStore.updateFile(id, {
          status: 'error',
          errorMessage: err.message || 'Compilation failed',
        });
        setStatus('error');
        setMessage(err.message || 'Compilation failed');
      }
    }
  }, []);

  const handleDeleteFile = useCallback((id: string) => {
    fileStore.deleteFile(id);
    if (activeFileId === id) {
      setActiveFileId(null);
      setStatus('idle');
      setMessage('');
    }
  }, [activeFileId]);

  const handleRenameFile = useCallback((id: string, name: string) => {
    fileStore.renameFile(id, name);
  }, []);

  const handleToggleTheme = useCallback(() => {
    themeStore.toggle();
  }, []);

  const handleCanvasError = useCallback((msg: string) => {
    setStatus('error');
    setMessage(msg);
  }, []);

  // Code editor: update file content in store
  const handleCodeChange = useCallback(
    (code: string) => {
      if (activeFileId) {
        fileStore.updateFile(activeFileId, { content: code });
      }
    },
    [activeFileId]
  );

  // Recompile from edited code
  const handleRecompile = useCallback(async () => {
    const file = activeFileId ? fileStore.getById(activeFileId) : undefined;
    if (!file) return;

    setStatus('compiling');
    setMessage('Recompiling Verilog...');
    try {
      const json = await compileVerilog(file.content);
      fileStore.updateFile(file.id, {
        circuitJson: json,
        status: 'compiled',
        errorMessage: undefined,
      });
      setStatus('done');
      setMessage('Recompiled successfully!');
      setViewMode('circuit');
    } catch (err: any) {
      fileStore.updateFile(file.id, {
        status: 'error',
        errorMessage: err.message || 'Compilation failed',
      });
      setStatus('error');
      setMessage(err.message || 'Compilation failed');
    }
  }, [activeFileId]);

  // File context menu (right-click on sidebar file)
  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Open',
          action: () => handleSelectFile(file.id),
        },
        {
          label: 'View Code',
          action: () => {
            handleSelectFile(file.id);
            setViewMode('code');
          },
        },
        {
          label: 'Rename',
          action: () => {
            // Trigger rename via a simple approach
            const newName = prompt('Rename file:', file.name);
            if (newName && newName.trim()) {
              handleRenameFile(file.id, newName.trim());
            }
          },
        },
        {
          label: 'Delete',
          danger: true,
          action: () => handleDeleteFile(file.id),
        },
      ],
    });
  }, [handleSelectFile, handleRenameFile, handleDeleteFile]);

  // Canvas context menu
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Reset Zoom',
          action: () => canvasRef.current?.resetZoom(),
        },
        {
          label: 'Fit to Window',
          action: () => canvasRef.current?.fitToWindow(),
        },
        { label: '---', disabled: true, action: () => {} },
        {
          label: 'Import Verilog File...',
          action: () => handleImportFile(),
        },
      ],
    });
  }, [handleImportFile]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleImportFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleImportFile]);

  const statusColor =
    status === 'error' ? 'var(--danger)' :
    status === 'done' ? 'var(--success)' :
    status === 'compiling' ? '#ff9800' : 'var(--text-dim)';

  return (
    <div
      style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* Menu Bar */}
      <MenuBar
        onImportFile={handleImportFile}
        onToggleTheme={handleToggleTheme}
        onResetZoom={() => canvasRef.current?.resetZoom()}
        onFitToWindow={() => canvasRef.current?.fitToWindow()}
        currentTheme={theme}
      />

      {/* Main area: Sidebar + Canvas */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <Sidebar
          files={files}
          activeFileId={activeFileId}
          onSelectFile={handleSelectFile}
          onRenameFile={handleRenameFile}
          onImportFile={handleImportFile}
          onContextMenu={handleFileContextMenu}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />

        {/* Canvas area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Status bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 16px',
              background: 'var(--toolbar-bg)',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
              fontSize: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: statusColor,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--text)' }}>
                {activeFile
                  ? `${activeFile.name} — ${message || 'Ready'}`
                  : message || 'Select a Verilog file to begin'}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            {activeFile && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setViewMode('circuit')}
                  style={{
                    padding: '2px 10px',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    background: viewMode === 'circuit' ? 'var(--accent)' : 'var(--input-bg)',
                    color: viewMode === 'circuit' ? '#fff' : 'var(--text)',
                  }}
                >
                  Circuit
                </button>
                <button
                  onClick={() => setViewMode('code')}
                  style={{
                    padding: '2px 10px',
                    border: 'none',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    background: viewMode === 'code' ? 'var(--accent)' : 'var(--input-bg)',
                    color: viewMode === 'code' ? '#fff' : 'var(--text)',
                  }}
                >
                  Code
                </button>
              </div>
            )}
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              Right-click drag to pan · Scroll to zoom · Ctrl+O to import
            </span>
          </div>

          {/* Canvas / Code Editor */}
          <div
            style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            onContextMenu={handleCanvasContextMenu}
          >
            {(() => {
              if (!activeFile) {
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '100%',
                      color: 'var(--text-dim)',
                      fontSize: '1.23rem',
                      userSelect: 'none',
                      gap: 12,
                    }}
                  >
                    <div style={{ fontSize: '3.69rem', opacity: 0.3 }}>📄</div>
                    <div>No circuit loaded</div>
                    <button
                      onClick={handleImportFile}
                      style={{
                        marginTop: 8,
                        padding: '8px 24px',
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: '1.08rem',
                        fontWeight: 500,
                      }}
                    >
                      Import .v File
                    </button>
                    <div style={{ fontSize: '0.92rem', opacity: 0.5 }}>
                      or press Ctrl+O to browse
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
                    onRecompile={handleRecompile}
                    isCompiling={status === 'compiling'}
                  />
                );
              }

              if (activeFile.circuitJson) {
                return (
                  <Canvas ref={canvasRef} circuitJson={activeFile.circuitJson} theme={theme} onError={handleCanvasError} />
                );
              }

              return (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    color: 'var(--text-dim)',
                    fontSize: '1.23rem',
                    userSelect: 'none',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: '3.69rem', opacity: 0.3 }}>📄</div>
                  <div>No circuit loaded</div>
                  <button
                    onClick={handleImportFile}
                    style={{
                      marginTop: 8,
                      padding: '8px 24px',
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: '1.08rem',
                      fontWeight: 500,
                    }}
                  >
                    Import .v File
                  </button>
                  <div style={{ fontSize: '0.92rem', opacity: 0.5 }}>
                    or press Ctrl+O to browse
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 24,
          padding: '0 12px',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: '0.92rem',
          flexShrink: 0,
          gap: 16,
        }}
      >
        <span>{files.length} file{files.length !== 1 ? 's' : ''} imported</span>
        <span>Theme: {theme === 'dark' ? 'Dark' : 'Light'}</span>
        <span>Font: {editorFontSize}px</span>
        <span style={{ flex: 1 }} />
        <span>Verilog Visualizer</span>
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
    </div>
  );
}