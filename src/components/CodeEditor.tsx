import { useState, useCallback, useRef, useEffect } from 'react';
import { settingsStore } from '../store/settingsStore';

interface CodeEditorProps {
  code: string;
  fileName: string;
  theme: 'dark' | 'light';
  onCodeChange: (code: string) => void;
  onRecompile: () => void;
  onSave: () => void;
  isCompiling: boolean;
}

export default function CodeEditor({
  code,
  fileName,
  theme,
  onCodeChange,
  onRecompile,
  onSave,
  isCompiling,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const [lineCount, setLineCount] = useState(1);
  const [fontSize, setFontSize] = useState(settingsStore.getFontSize());

  // Sync with global font size setting changes
  useEffect(() => {
    return settingsStore.subscribe(() => {
      setFontSize(settingsStore.getFontSize());
    });
  }, []);

  // Sync scroll between textarea and line numbers
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const lineNumbers = lineNumbersRef.current;
    if (textarea && lineNumbers) {
      lineNumbers.scrollTop = textarea.scrollTop;
    }
  }, []);

  // Update line count when code changes
  useEffect(() => {
    setLineCount(code.split('\n').length);
  }, [code]);

  // Tab key support, zoom shortcuts, and recompile
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab: insert 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newCode = code.substring(0, start) + '  ' + code.substring(end);
        onCodeChange(newCode);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
        return;
      }
      // Ctrl+S / Cmd+S: save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      // F5: recompile
      if (e.key === 'F5') {
        e.preventDefault();
        onRecompile();
        return;
      }
      // Ctrl+= / Ctrl+Plus: zoom in
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        settingsStore.increaseFontSize();
        return;
      }
      // Ctrl+-: zoom out
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        settingsStore.decreaseFontSize();
        return;
      }
      // Ctrl+0: reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        settingsStore.resetFontSize();
      }
    },
    [code, onCodeChange, onRecompile]
  );

  const isDark = theme === 'dark';
  const lineHeight = fontSize + 7;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            fontFamily: 'monospace',
          }}
        >
          {fileName}
        </span>
        <button
          onClick={onRecompile}
          disabled={isCompiling}
          style={{
            padding: '4px 14px',
            background: isCompiling ? 'var(--text-muted)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: isCompiling ? 'default' : 'pointer',
            fontSize: '0.82rem',
            fontWeight: 500,
          }}
        >
          {isCompiling ? 'Compiling...' : 'Compile (F5)'}
        </button>
      </div>

      {/* Editor area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          style={{
            width: Math.max(48, fontSize * 3.5),
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--surface)',
            borderRight: '1px solid var(--border-subtle)',
            paddingTop: 8,
            paddingBottom: 8,
            userSelect: 'none',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                height: lineHeight,
                lineHeight: `${lineHeight}px`,
                textAlign: 'right',
                paddingRight: 8,
                fontSize,
                fontFamily: "'Consolas', 'Courier New', monospace",
                color: 'var(--text-muted)',
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize,
            lineHeight: `${lineHeight}px`,
            fontFamily: "'Consolas', 'Courier New', monospace",
            background: 'var(--bg)',
            color: 'var(--text)',
            tabSize: 2,
            whiteSpace: 'pre',
            overflowWrap: 'normal',
            overflowX: 'auto',
          }}
        />
      </div>

      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '2px 14px',
          background: 'var(--statusbar-bg)',
          color: 'var(--text-secondary)',
          fontSize: '0.74rem',
          flexShrink: 0,
          gap: 16,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <span>Verilog</span>
        <span>Lines: {lineCount}</span>
        <span>Zoom: {fontSize}px</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}