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
    // Close on any click outside
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Close on Escape
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Delay adding listeners to avoid immediate close from the right-click event
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

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 16);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        minWidth: 180,
        background: 'var(--dropdown-bg)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: '4px 0',
        zIndex: 2000,
        userSelect: 'none',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
          disabled={item.disabled}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 16px',
            background: 'transparent',
            color: item.danger ? 'var(--danger)' : item.disabled ? 'var(--text-dim)' : 'var(--text)',
            border: 'none',
            cursor: item.disabled ? 'default' : 'pointer',
            fontSize: '1rem',
            textAlign: 'left',
            opacity: item.disabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              (e.target as HTMLElement).style.background = item.danger
                ? 'var(--danger-bg)'
                : 'var(--menu-hover)';
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = 'transparent';
          }}
        >
          {item.label}
        </button>
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