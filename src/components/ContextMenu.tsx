import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  items: {
    label: string;
    disabled?: boolean;
    danger?: boolean;
    action: () => void;
  }[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('contextmenu', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('contextmenu', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const itemHeight = 52;
  const adjustedX = Math.min(x, window.innerWidth - 280);
  const adjustedY = Math.min(y, window.innerHeight - items.length * itemHeight - 16);

  return (
    <div
      ref={menuRef}
      className="animate-scale-in fixed z-[2000] min-w-[280px] py-2 select-none rounded-lg"
      style={{
        left: adjustedX,
        top: adjustedY,
        background: 'var(--menu-bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {items.map((item, i) => (
        item.label === '---' ? (
          <div key={i} role="separator" style={{ height: 1, margin: '3px 8px', background: 'var(--border)' }} />
        ) : (
        <button
          key={i}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
          disabled={item.disabled}
          className="block w-full px-3.5 py-1.5 text-left border-0 transition-colors rounded-none"
          style={{
            background: 'transparent',
            color: item.danger ? 'var(--danger)' : item.disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
            cursor: item.disabled ? 'default' : 'pointer',
            opacity: item.disabled ? 0.5 : 1,
            fontSize: '0.85rem',
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              (e.target as HTMLElement).style.background = item.danger
                ? 'var(--danger-muted)'
                : 'var(--surface)';
              (e.target as HTMLElement).style.color = item.danger
                ? 'var(--danger-hover)'
                : 'var(--text)';
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = 'transparent';
            (e.target as HTMLElement).style.color = item.danger
              ? 'var(--danger)'
              : item.disabled ? 'var(--text-muted)' : 'var(--text-secondary)';
          }}
        >
          {item.label}
        </button>
        )
      ))}
    </div>
  );
}

export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  action: () => void;
}