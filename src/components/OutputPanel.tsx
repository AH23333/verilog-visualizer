import { useState, useRef, useEffect } from 'react';

interface OutputPanelProps {
  log: string;
  visible: boolean;
  onToggle: () => void;
  onClose: () => void;
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

export default function OutputPanel({ log, visible, onToggle, onClose }: OutputPanelProps) {
  const [containerHeight, setContainerHeight] = useState(getSavedHeight);
  const [isDragging, setIsDragging] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

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
      // Save to localStorage
      localStorage.setItem(OUTPUT_HEIGHT_KEY, String(containerHeight));
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerHeight]);

  // Collapse to status bar only
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
        <span style={{ fontSize: '0.77rem', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase' }}>
          Output
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '0.69rem', color: 'var(--text-dim)' }}>Click to expand</span>
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

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 26,
          padding: '0 8px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            cursor: 'pointer',
          }}
          onClick={onToggle}
        >
          Output
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title="Close panel"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            padding: '2px 6px',
            borderRadius: 3,
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--menu-hover)'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
        >
          ✕
        </button>
      </div>

      {/* Log content — scrollable with maxHeight cap */}
      <pre
        ref={logRef}
        style={{
          flex: 1,
          margin: 0,
          padding: '8px 12px',
          overflow: 'auto',
          fontFamily: "'Consolas', 'Courier New', monospace",
          fontSize: '0.8rem',
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
    </div>
  );
}