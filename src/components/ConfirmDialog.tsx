// In-app replacement for window.confirm()
import { useEffect, useRef, type CSSProperties } from 'react';
import { TriangleAlert } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  onAccept: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, detail, confirmLabel = 'OK', danger, onAccept, onCancel,
}: ConfirmDialogProps) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => okRef.current?.focus(), 0);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('keydown', key); };
  }, [onCancel]);

  const btnBase: CSSProperties = {
    height: 28, padding: '0 14px', borderRadius: 'var(--radius-md)',
    cursor: 'pointer', fontSize: 'var(--fs-md)', fontWeight: 600, border: 'none',
  };

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }} onClick={onCancel}>
      <div className="animate-fade-in w-[420px] max-w-[92vw] rounded-xl border shadow-2xl"
        style={{ background: 'var(--menu-bg)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="px-5 pt-4 pb-1 flex items-center gap-2.5">
          {danger && (
            <TriangleAlert size={17} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          )}
          <span className="text-[var(--fs-lg)] font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
        </div>
        <div className="px-5 pb-4">
          <p className="text-[var(--fs-md)] leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>{message}</p>
          {detail && (
            <p className="text-[var(--fs-sm)] mt-1.5 mb-0 font-mono break-all" style={{ color: 'var(--text-muted)' }}>{detail}</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onCancel}
              className="rounded-md cursor-pointer"
              style={{ ...btnBase, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 400 }}>
              Cancel
            </button>
            <button ref={okRef} onClick={onAccept}
              className="rounded-md text-white"
              style={{ ...btnBase, background: danger ? 'var(--danger)' : 'var(--accent)' }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
