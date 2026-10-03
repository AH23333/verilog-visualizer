// Custom window controls for the frameless (decorations:false) Tauri window.
// Renders nothing outside Tauri (plain browser / Playwright), so web dev flow
// is unaffected. Windows-style: 46px wide slots, close hover red.

import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        const fn = await win.onResized(async ({ payload }) => {
          // payload is the new outer size; isMaximized() is the source of truth
          try { setMaximized(await win.isMaximized()); } catch { /* ignore */ }
          void payload;
        });
        if (cancelled) { fn(); } else { unlisten = fn; }
      } catch { /* older runtime without window API */ }
    })();
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  if (!isTauri) return null;

  const act = (fn: 'minimize' | 'toggleMaximize' | 'close') => {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        if (fn === 'minimize') return w.minimize();
        if (fn === 'toggleMaximize') return w.toggleMaximize();
        return w.close();
      })
      .catch(() => { /* permission missing -> surface in console */ });
  };

  const base: React.CSSProperties = {
    width: 46, height: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
    borderRadius: 0, flexShrink: 0,
  };

  // NOTE: deliberately NO data-tauri-drag-region on this wrapper — Tauri checks
  // the attribute's presence, so even ="false" would turn buttons into drag
  // targets and swallow clicks.
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', marginLeft: 'auto', flexShrink: 0 }}>
      <button
        aria-label="最小化" title="最小化"
        style={base}
        onClick={() => act('minimize')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      ><Minus size={14} strokeWidth={1.5} /></button>
      <button
        aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'}
        style={base}
        onClick={() => act('toggleMaximize')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      >
        {maximized
          ? <span style={{ position: 'relative', width: 12, height: 12, display: 'inline-block' }}>
              <Square size={10} strokeWidth={1.5} style={{ position: 'absolute', right: 0, top: 0 }} />
              <Square size={10} strokeWidth={1.5} style={{ position: 'absolute', left: 0, bottom: 0, maskImage: 'linear-gradient(135deg, #000 40%, transparent 40%)', WebkitMaskImage: 'linear-gradient(135deg, #000 40%, transparent 40%)' }} />
            </span>
          : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button
        aria-label="关闭" title="关闭"
        style={base}
        onClick={() => act('close')}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#e81123'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
      ><X size={15} strokeWidth={1.5} /></button>
    </div>
  );
}
