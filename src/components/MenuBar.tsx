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
}

interface MenuState {
  label: string;
  items: { label: string; action: () => void; shortcut?: string }[];
}

export default function MenuBar({ onImportFile, onToggleTheme, onResetZoom, onFitToWindow, onCreateFile, currentTheme }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Subscribe to font size changes
  const editorFontSize = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.getFontSize()
  );

  // Close menu on outside click
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
        {
          label: 'New File...',
          shortcut: 'Ctrl+N',
          action: () => { onCreateFile(); setOpenMenu(null); },
        },
        {
          label: 'Import Verilog File...',
          shortcut: 'Ctrl+O',
          action: () => { onImportFile(); setOpenMenu(null); },
        },
        {
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: () => { setOpenMenu(null); },
        },
        {
          label: 'Compile',
          shortcut: 'F5',
          action: () => { setOpenMenu(null); },
        },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => setOpenMenu(null),
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => setOpenMenu(null),
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Reset Zoom',
          shortcut: 'Ctrl+0',
          action: () => { onResetZoom(); setOpenMenu(null); },
        },
        {
          label: 'Fit to Window',
          action: () => { onFitToWindow(); setOpenMenu(null); },
        },
        {
          label: currentTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
          action: () => { onToggleTheme(); setOpenMenu(null); },
        },
      ],
    },
    {
      label: 'Settings',
      items: [
        {
          label: `Editor Font Size: ${editorFontSize}px`,
          action: () => {},
          shortcut: undefined,
        },
        {
          label: 'Increase Font Size',
          shortcut: 'Ctrl+=',
          action: () => { settingsStore.increaseFontSize(); },
        },
        {
          label: 'Decrease Font Size',
          shortcut: 'Ctrl+-',
          action: () => { settingsStore.decreaseFontSize(); },
        },
        {
          label: 'Reset Font Size',
          shortcut: 'Ctrl+0',
          action: () => { settingsStore.resetFontSize(); },
        },
        {
          label: `Default View: ${settingsStore.getDefaultViewMode() === 'circuit' ? 'Circuit' : 'Code'}`,
          action: () => {
            const current = settingsStore.getDefaultViewMode();
            settingsStore.setDefaultViewMode(current === 'circuit' ? 'code' : 'circuit');
          },
        },
        {
          label: 'Toggle Sidebar',
          shortcut: 'Ctrl+B',
          action: () => setOpenMenu(null),
        },
      ],
    },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        background: 'var(--menu-bg)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        userSelect: 'none',
        paddingLeft: 4,
      }}
    >
      {menus.map((menu) => (
        <div key={menu.label} style={{ position: 'relative' }}>
          <button
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu !== null && setOpenMenu(menu.label)}
            style={{
              height: 31,
              padding: '0 10px',
              background: openMenu === menu.label ? 'var(--menu-hover)' : 'transparent',
              color: 'var(--text)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                minWidth: 220,
                background: 'var(--dropdown-bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                padding: '4px 0',
                zIndex: 1000,
              }}
            >
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    width: '100%',
                    padding: '6px 16px',
                    background: 'transparent',
                    color: 'var(--text)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'var(--menu-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.92rem', marginLeft: 24 }}>
                      {item.shortcut}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}