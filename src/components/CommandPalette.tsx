import { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  combo?: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

/** Subsequence fuzzy match: every char of `q` appears in `text` in order. */
function fuzzyMatch(q: string, text: string): boolean {
  q = q.toLowerCase().trim();
  text = text.toLowerCase();
  if (!q) return true;
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

export default function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(
    () => commands.filter((c) => fuzzyMatch(query, c.label)),
    [commands, query],
  );

  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keep active item in view
  useEffect(() => {
    listRef.current?.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) { cmd.run(); onClose(); }
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '12vh', background: 'rgba(0,0,0,0.35)',
      }}
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '90vw', maxHeight: '60vh',
          background: 'var(--dropdown-bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'scaleIn 120ms ease-out',
        }}
      >
        {/* Input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text)', fontSize: 'var(--fs-md)', padding: 0,
            }}
          />
        </div>
        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              No matching commands.
            </div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => { cmd.run(); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 14px', cursor: 'pointer',
                background: i === activeIdx ? 'var(--accent-muted)' : 'transparent',
                color: i === activeIdx ? 'var(--text)' : 'var(--text-secondary)',
                fontSize: 'var(--fs-md)',
              }}
            >
              <span>{cmd.label}</span>
              {cmd.combo && (
                <span style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                }}>{cmd.combo}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
