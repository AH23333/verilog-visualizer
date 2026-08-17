import { useState, useCallback, useRef, useEffect } from 'react';
import { settingsStore } from '../store/settingsStore';

interface CodeEditorProps {
  code: string;
  fileName: string;
  theme: 'dark' | 'light';
  onCodeChange: (code: string) => void;
  onRecompile: () => void;
  isCompiling: boolean;
}

export default function CodeEditor({
  code,
  fileName,
  theme,
  onCodeChange,
  onRecompile,
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
      // Ctrl+S / Cmd+S: recompile
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
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
        background: isDark ? '#1e1e1e' : '#ffffff',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: isDark ? '#2d2d2d' : '#f3f3f3',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.92rem',
            color: 'var(--text-dim)',
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
            background: isCompiling ? 'var(--text-dim)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: isCompiling ? 'default' : 'pointer',
            fontSize: '0.92rem',
            fontWeight: 500,
          }}
        >
          {isCompiling ? 'Compiling...' : 'Re-compile (Ctrl+S)'}
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
            background: isDark ? '#252526' : '#f0f0f0',
            borderRight: `1px solid ${isDark ? '#3c3c3c' : '#d4d4d4'}`,
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
                color: isDark ? '#858585' : '#999',
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
            background: isDark ? '#1e1e1e' : '#ffffff',
            color: isDark ? '#d4d4d4' : '#333333',
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
          padding: '2px 12px',
          background: isDark ? '#007acc' : '#0078d4',
          color: '#fff',
          fontSize: '0.85rem',
          flexShrink: 0,
          gap: 16,
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