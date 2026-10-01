import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { type Theme } from '../store/themeStore';
import { settingsStore } from '../store/settingsStore';

interface MenuBarProps {
  onImportFile: () => void;
  onToggleTheme: () => void;
  onResetZoom: () => void;
  onFitToWindow: () => void;
  onCreateFile: () => void;
  currentTheme: Theme;
  onExportSVG?: () => void;
  onExportPNG?: () => void;
  onExportJSON?: () => void;
  onExportVerilog?: () => void;
  onExportNetlist?: () => void;
  onGlobalSearch?: () => void;
  hasCircuit?: boolean;
  /** Wired-up actions that previously were no-op menu labels */
  onSave?: () => void;
  onCompile?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onToggleSidebar?: () => void;
  onOpenExamples?: () => void;
  onShowShortcuts?: () => void;
}

interface MenuState {
  label: string;
  items: { label: string; action: () => void; shortcut?: string }[];
}

export default function MenuBar({ onImportFile, onToggleTheme, onResetZoom, onFitToWindow, onCreateFile, currentTheme, onExportSVG, onExportPNG, onExportJSON, onExportVerilog, onExportNetlist, onGlobalSearch, hasCircuit: _hasCircuit, onSave, onCompile, onUndo, onRedo, onFind, onToggleSidebar, onOpenExamples, onShowShortcuts }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const editorFontSize = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getFontSize()
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const menus: MenuState[] = [
    {
      label: 'File',
      items: [
        { label: 'New File...', shortcut: 'Ctrl+N', action: () => { onCreateFile(); setOpenMenu(null); } },
        { label: 'Import Verilog File...', shortcut: 'Ctrl+O', action: () => { onImportFile(); setOpenMenu(null); } },
        { label: 'Examples...', action: () => { onOpenExamples?.(); setOpenMenu(null); } },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => { onSave?.(); setOpenMenu(null); } },
        { label: 'Compile', shortcut: 'F5', action: () => { onCompile?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => { onUndo?.(); setOpenMenu(null); } },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => { onRedo?.(); setOpenMenu(null); } },
        { label: 'Find / Replace', shortcut: 'Ctrl+F', action: () => { onFind?.(); setOpenMenu(null); } },
        { label: 'Global Search', shortcut: 'Ctrl+Shift+F', action: () => { onGlobalSearch?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: 'Export',
      items: [
        { label: 'Export SVG', action: () => { onExportSVG?.(); setOpenMenu(null); } },
        { label: 'Export PNG', action: () => { onExportPNG?.(); setOpenMenu(null); } },
        { label: 'Export Circuit JSON', action: () => { onExportJSON?.(); setOpenMenu(null); } },
        { label: 'Export Verilog Source', action: () => { onExportVerilog?.(); setOpenMenu(null); } },
        { label: 'Export Synthesized Netlist', action: () => { onExportNetlist?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => { onToggleSidebar?.(); setOpenMenu(null); } },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => { onResetZoom(); setOpenMenu(null); } },
        { label: 'Fit to Window', action: () => { onFitToWindow(); setOpenMenu(null); } },
        { label: currentTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme', action: () => { onToggleTheme(); setOpenMenu(null); } },
      ],
    },
    {
      label: 'Settings',
      items: [
        { label: `Editor Font Size: ${editorFontSize}px`, action: () => {} },
        { label: 'Increase Font Size', shortcut: 'Ctrl+=', action: () => { settingsStore.increaseFontSize(); } },
        { label: 'Decrease Font Size', shortcut: 'Ctrl+-', action: () => { settingsStore.decreaseFontSize(); } },
        { label: 'Reset Font Size', shortcut: 'Ctrl+0', action: () => { settingsStore.resetFontSize(); } },
        { label: `Default View: ${settingsStore.getDefaultViewMode() === 'circuit' ? 'Circuit' : 'Code'}`, action: () => {
          const current = settingsStore.getDefaultViewMode();
          settingsStore.setDefaultViewMode(current === 'circuit' ? 'code' : 'circuit');
        }},
        { label: 'Toggle Sidebar', shortcut: 'Ctrl+B', action: () => { onToggleSidebar?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+/', action: () => { onShowShortcuts?.(); setOpenMenu(null); } },
      ],
    },
  ];

  return (
    <div
      ref={menuRef}
      className="flex items-center h-full flex-shrink-0 select-none gap-0.5"
      style={{ background: 'transparent' }}
    >
      {menus.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu !== null && setOpenMenu(menu.label)}
            className="h-[26px] px-2.5 border-0 rounded-md cursor-pointer transition-colors"
            style={{
              background: openMenu === menu.label ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 500,
            }}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div
              className="animate-fade-in absolute top-full left-0 min-w-[300px] py-2 rounded-lg z-[1000]"
              style={{
                background: 'var(--menu-bg)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              {menu.items.map((item, idx) => (
                item.label === '---' ? (
                  <div key={`sep-${idx}`} role="separator" style={{ height: 1, margin: '3px 8px', background: 'var(--border)' }} />
                ) : (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="flex justify-between items-center w-full px-3.5 py-1.5 border-0 cursor-pointer text-left transition-colors"
                  style={{
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--fs-md)',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--surface)';
                    (e.target as HTMLElement).style.color = 'var(--text)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                    (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span className="ml-10" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
                      {item.shortcut}
                    </span>
                  )}
                </button>
                )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}