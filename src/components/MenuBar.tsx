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
  onOpenSettings?: () => void;
}

interface MenuState {
  label: string;
  items: { label: string; action: () => void; shortcut?: string }[];
}

export default function MenuBar({ onImportFile, onToggleTheme, onResetZoom, onFitToWindow, onCreateFile, currentTheme, onExportSVG, onExportPNG, onExportJSON, onExportVerilog, onExportNetlist, onGlobalSearch, hasCircuit: _hasCircuit, onSave, onCompile, onUndo, onRedo, onFind, onToggleSidebar, onOpenExamples, onShowShortcuts, onOpenSettings }: MenuBarProps) {
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
      label: '文件',
      items: [
        { label: '新建文件...', shortcut: 'Ctrl+N', action: () => { onCreateFile(); setOpenMenu(null); } },
        { label: '导入 Verilog 文件...', shortcut: 'Ctrl+O', action: () => { onImportFile(); setOpenMenu(null); } },
        { label: '示例...', action: () => { onOpenExamples?.(); setOpenMenu(null); } },
        { label: '保存', shortcut: 'Ctrl+S', action: () => { onSave?.(); setOpenMenu(null); } },
        { label: '编译', shortcut: 'F5', action: () => { onCompile?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', shortcut: 'Ctrl+Z', action: () => { onUndo?.(); setOpenMenu(null); } },
        { label: '重做', shortcut: 'Ctrl+Y', action: () => { onRedo?.(); setOpenMenu(null); } },
        { label: '查找 / 替换', shortcut: 'Ctrl+F', action: () => { onFind?.(); setOpenMenu(null); } },
        { label: '全局搜索', shortcut: 'Ctrl+Shift+F', action: () => { onGlobalSearch?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: '导出',
      items: [
        { label: '导出 SVG', action: () => { onExportSVG?.(); setOpenMenu(null); } },
        { label: '导出 PNG', action: () => { onExportPNG?.(); setOpenMenu(null); } },
        { label: '导出电路 JSON', action: () => { onExportJSON?.(); setOpenMenu(null); } },
        { label: '导出 Verilog 源码', action: () => { onExportVerilog?.(); setOpenMenu(null); } },
        { label: '导出综合网表', action: () => { onExportNetlist?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: '视图',
      items: [
        { label: '显示 / 隐藏侧栏', shortcut: 'Ctrl+B', action: () => { onToggleSidebar?.(); setOpenMenu(null); } },
        { label: '重置缩放', shortcut: 'Ctrl+0', action: () => { onResetZoom(); setOpenMenu(null); } },
        { label: '适应窗口', action: () => { onFitToWindow(); setOpenMenu(null); } },
        { label: currentTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题', action: () => { onToggleTheme(); setOpenMenu(null); } },
      ],
    },
    {
      label: '设置',
      items: [
        { label: '打开设置面板...', action: () => { onOpenSettings?.(); setOpenMenu(null); } },
        { label: `编辑器字号：${editorFontSize}px`, action: () => {} },
        { label: '增大字号', shortcut: 'Ctrl+=', action: () => { settingsStore.increaseFontSize(); } },
        { label: '减小字号', shortcut: 'Ctrl+-', action: () => { settingsStore.decreaseFontSize(); } },
        { label: '重置字号', shortcut: 'Ctrl+0', action: () => { settingsStore.resetFontSize(); } },
        { label: `默认视图：${settingsStore.getDefaultViewMode() === 'circuit' ? '电路图' : '代码'}`, action: () => {
          const current = settingsStore.getDefaultViewMode();
          settingsStore.setDefaultViewMode(current === 'circuit' ? 'code' : 'circuit');
        }},
        { label: '显示 / 隐藏侧栏', shortcut: 'Ctrl+B', action: () => { onToggleSidebar?.(); setOpenMenu(null); } },
      ],
    },
    {
      label: '帮助',
      items: [
        { label: '快捷键一览', shortcut: 'Ctrl+/', action: () => { onShowShortcuts?.(); setOpenMenu(null); } },
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