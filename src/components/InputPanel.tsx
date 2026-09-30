import { useState, useEffect, useCallback } from 'react';
import { Square, Clock, X } from 'lucide-react';
import type { CanvasHandle } from './Canvas';

interface InputPanelProps {
  canvasRef: React.RefObject<CanvasHandle | null>;
  open: boolean;
  onClose: () => void;
}

interface InputItem {
  id: string;
  label: string;
  type: string;
  value: string;
}

/**
 * Side-panel集中输入面板: lists all Button/Clock inputs so users don't have
 * to hunt for tiny switches on the schematic. Polls at 200ms for value changes.
 */
export default function InputPanel({ canvasRef, open, onClose }: InputPanelProps) {
  const [items, setItems] = useState<InputItem[]>([]);

  const refresh = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    setItems(c.listInputs());
  }, [canvasRef]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 200);
    return () => clearInterval(t);
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div style={{
      width: 180, flexShrink: 0,
      borderLeft: '1px solid var(--border-subtle)',
      background: 'var(--bg-elevated)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          Inputs
        </span>
        <button onClick={onClose} className="icon-btn" style={{ width: 18, height: 18, color: 'var(--text-muted)' }}>
          <X size={12} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {items.length === 0 && (
          <div style={{ padding: 12, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            No inputs. Compile a design with clk/reset/inputs.
          </div>
        )}
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => canvasRef.current?.toggleInput(it.id)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', marginBottom: 2,
              background: 'transparent', border: '1px solid transparent',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              color: 'var(--text)', textAlign: 'left', fontSize: 'var(--fs-sm)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {it.type === 'Clock'
              ? <Clock size={12} style={{ color: it.value === '1' ? 'var(--danger)' : 'var(--text-muted)' }} />
              : <Square size={12} style={{ color: it.value === '1' ? 'var(--success)' : 'var(--text-muted)' }} />
            }
            <span style={{ flex: 1, fontFamily: 'monospace' }}>{it.label}</span>
            <span style={{
              fontWeight: 700, fontSize: 'var(--fs-md)',
              color: it.value === '1' ? 'var(--danger)' : 'var(--text-muted)',
            }}>{it.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
