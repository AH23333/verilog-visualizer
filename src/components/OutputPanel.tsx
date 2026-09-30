import { useState, useRef, useEffect } from 'react';
import { X, AlertCircle, Terminal } from 'lucide-react';

export interface Problem {
  fileName: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

interface OutputPanelProps {
  log: string;
  problems: Problem[];
  visible: boolean;
  onToggle: () => void;
  onClose: () => void;
  onJumpToProblem: (fileName: string, line: number) => void;
}

const OUTPUT_HEIGHT_KEY = 'verilog-viz-output-height';

function getSavedHeight(): number {
  try {
    const saved = localStorage.getItem(OUTPUT_HEIGHT_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (n >= 60 && n <= 600) return n;
    }
  } catch {}
  return 180;
}

export default function OutputPanel({ log, problems, visible, onToggle, onClose, onJumpToProblem }: OutputPanelProps) {
  const [containerHeight, setContainerHeight] = useState(getSavedHeight);
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<'output' | 'problems'>('output');
  const logRef = useRef<HTMLPreElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Auto-switch to Problems tab when new errors arrive
  useEffect(() => {
    if (problems.length > 0) setTab('problems');
  }, [problems]);

  // Auto-scroll to bottom when log updates
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  // Resize drag handlers
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = containerHeight;
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.max(60, Math.min(600, dragStartHeight.current + delta));
      setContainerHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(OUTPUT_HEIGHT_KEY, String(containerHeight));
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerHeight]);

  // Collapsed header bar
  if (!visible) {
    return (
      <div
        style={{
          height: 24,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          background: 'var(--statusbar-bg)',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0,
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggle}
        title="Show output panel"
      >
        <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
          Problems{problems.length > 0 ? ` (${problems.length})` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Click to expand</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        userSelect: isDragging ? 'none' : 'auto',
        minHeight: 60,
        maxHeight: '40vh',
        height: Math.min(containerHeight, window.innerHeight * 0.4),
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: 3,
          cursor: 'ns-resize',
          background: isDragging ? 'var(--accent)' : 'var(--border-subtle)',
          flexShrink: 0,
        }}
      />

      {/* Header with tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 26,
          padding: '0 4px 0 8px',
          flexShrink: 0,
          gap: 2,
        }}
      >
        <button
          onClick={() => setTab('output')}
          className="text-btn"
          style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
            color: tab === 'output' ? 'var(--text)' : 'var(--text-muted)',
            borderBottom: tab === 'output' ? '1px solid var(--accent)' : '1px solid transparent',
            borderRadius: 0,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Terminal size={11} /> Output
        </button>
        <button
          onClick={() => setTab('problems')}
          className="text-btn"
          style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
            color: tab === 'problems' ? 'var(--text)' : 'var(--text-muted)',
            borderBottom: tab === 'problems' ? '1px solid var(--accent)' : '1px solid transparent',
            borderRadius: 0,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <AlertCircle size={11} /> Problems{problems.length > 0 ? ` (${problems.length})` : ''}
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close panel"
          className="icon-btn"
          style={{ width: 22, height: 22, color: 'var(--text-muted)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab content */}
      {tab === 'output' ? (
        <pre
          ref={logRef}
          style={{
            flex: 1,
            margin: 0,
            padding: '8px 12px',
            overflow: 'auto',
            fontFamily: "'Consolas', 'Courier New', monospace",
            fontSize: 'var(--fs-md)',
            lineHeight: '1.6',
            color: 'var(--text-secondary)',
            background: 'var(--bg)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            minHeight: 0,
          }}
        >
          {log || 'No output yet. Press F5 to compile.'}
        </pre>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: 'var(--bg)' }}>
          {problems.length === 0 ? (
            <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              No problems. Code is clean.
            </div>
          ) : (
            problems.map((p, i) => (
              <div
                key={i}
                onClick={() => onJumpToProblem(p.fileName, p.line)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 12px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                title={`${p.fileName}:${p.line} — click to jump`}
              >
                <AlertCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text)' }}>{p.message}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'monospace' }}>
                    {p.fileName}:{p.line}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
