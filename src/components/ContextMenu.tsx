import { useEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  /** 菜单项文字；'---' 表示分隔线 */
  label: string;
  /** 右侧灰色快捷键提示 */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
  /**
   * 内联编辑项（避免用原生 prompt 弹窗）。提供后该项渲染为「标签 + 输入框」，
   * 回车提交。用于重命名 / 改位宽等需要输入参数的场景。
   */
  input?: {
    value: string;
    placeholder?: string;
    onCommit: (v: string) => void;
  };
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** 顶部小标题（可选） */
  title?: string;
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, title, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeRef.current();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };

    const timer = setTimeout(() => {
      // 必须用捕获阶段：画布里 jointjs 的 cell:pointerdown 会调用 evt.stopPropagation()，
      // 冒泡阶段挂在 document 上的监听器根本收不到画布上的左键按下，导致右键菜单
      // 弹出后在画布任意处左键都关不掉。捕获阶段先于目标触发，不受后代 stopPropagation 影响。
      document.addEventListener('mousedown', handleClick, true);
      document.addEventListener('pointerdown', handleClick, true);
      document.addEventListener('contextmenu', handleClick, true);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('pointerdown', handleClick, true);
      document.removeEventListener('contextmenu', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  // 原来按 items.length × 52 估算高度来上移菜单 —— 项数一多（部件库 45+ 项、还有
  // 二级「放置部件」）估算值超过视口高度，adjustedY 变成负数，菜单整块跑到屏幕上方、
  // 大半项点不到。改为：先夹紧到视口内，再用 maxHeight + 滚动条处理超长菜单。
  const MENU_W = 280;
  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - 8));
  const maxHeight = Math.max(140, window.innerHeight - adjustedY - 12);

  return (
    <div
      ref={menuRef}
      data-context-menu=""
      className="animate-scale-in fixed z-[2000] min-w-[280px] py-2 select-none rounded-lg"
      style={{
        left: adjustedX,
        top: adjustedY,
        maxHeight,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        background: 'var(--menu-bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {title && (
        <div
          className="px-3.5 pb-1.5 pt-0.5"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}
        >
          {title}
        </div>
      )}
      {items.map((item, i) => {
        if (item.label === '---') {
          return <div key={i} role="separator" style={{ height: 1, margin: '3px 8px', background: 'var(--border)' }} />;
        }
        if (item.input) {
          return (
            <div key={i} className="flex items-center gap-2 px-3.5 py-1.5">
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-md)', minWidth: 56 }}>{item.label}</span>
              <input
                autoFocus
                defaultValue={item.input.value}
                placeholder={item.input.placeholder}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    item.input!.onCommit((e.target as HTMLInputElement).value);
                    onClose();
                  } else if (e.key === 'Escape') {
                    onClose();
                  }
                }}
                className="flex-1 min-w-0 px-1.5 py-0.5 rounded border"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  borderColor: 'var(--border)',
                  fontSize: 'var(--fs-md)',
                }}
              />
            </div>
          );
        }
        return (
          <button
            key={i}
            onClick={() => {
              if (!item.disabled) {
                item.action?.();
                onClose();
              }
            }}
            disabled={item.disabled}
            className="flex w-full items-center justify-between gap-4 px-3.5 py-1.5 text-left border-0 transition-colors rounded-none"
            style={{
              background: 'transparent',
              color: item.danger ? 'var(--danger)' : item.disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: item.disabled ? 'default' : 'pointer',
              opacity: item.disabled ? 0.5 : 1,
              fontSize: 'var(--fs-md)',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                (e.currentTarget as HTMLElement).style.background = item.danger
                  ? 'var(--danger-muted)'
                  : 'var(--surface)';
                (e.currentTarget as HTMLElement).style.color = item.danger
                  ? 'var(--danger-hover)'
                  : 'var(--text)';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = item.danger
                ? 'var(--danger)'
                : item.disabled ? 'var(--text-muted)' : 'var(--text-secondary)';
            }}
          >
            <span>{item.label}</span>
            {item.hint && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{item.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 供需要「先弹菜单、菜单项里再输入」的场景使用的受控版本（保持同一套样式）。 */
export function ContextMenuInputRow({
  label, value, placeholder, onCommit, onCancel,
}: {
  label: string; value: string; placeholder?: string;
  onCommit: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-center gap-2 px-3.5 py-1.5">
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-md)', minWidth: 56 }}>{label}</span>
      <input
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(v);
          else if (e.key === 'Escape') onCancel();
        }}
        className="flex-1 min-w-0 px-1.5 py-0.5 rounded border"
        style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)', fontSize: 'var(--fs-md)' }}
      />
    </div>
  );
}
