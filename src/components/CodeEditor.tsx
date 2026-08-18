import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { settingsStore } from '../store/settingsStore';

// Declare Prism global from CDN
declare global {
  interface Window {
    Prism: {
      highlight: (code: string, grammar: any, language: string) => string;
      languages: Record<string, any>;
    };
  }
}

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
  const preRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(settingsStore.getFontSize());
  const [highlightedCode, setHighlightedCode] = useState('');

  // Sync with global font size setting changes
  useEffect(() => {
    return settingsStore.subscribe(() => {
      setFontSize(settingsStore.getFontSize());
    });
  }, []);

  // Highlight code using Prism
  useEffect(() => {
    try {
      if (window.Prism && window.Prism.languages?.verilog) {
        const html = window.Prism.highlight(code, window.Prism.languages.verilog, 'verilog');
        setHighlightedCode(html);
      } else {
        setHighlightedCode(escapeHtml(code));
      }
    } catch {
      setHighlightedCode(escapeHtml(code));
    }
  }, [code]);

  // Sync scroll between textarea, pre, and line numbers
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const pre = preRef.current;
    const lineNumbers = lineNumbersRef.current;
    if (textarea) {
      if (pre) {
        pre.scrollTop = textarea.scrollTop;
        pre.scrollLeft = textarea.scrollLeft;
      }
      if (lineNumbers) {
        lineNumbers.scrollTop = textarea.scrollTop;
      }
    }
  }, []);

  // Tab key support, zoom shortcuts, and recompile
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        onRecompile();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        settingsStore.increaseFontSize();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        settingsStore.decreaseFontSize();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        settingsStore.resetFontSize();
      }
    },
    [code, onCodeChange, onRecompile, onSave]
  );

  const lineHeight = fontSize + 7;
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  const editorStyle = useMemo(
    () => ({
      fontSize,
      lineHeight: `${lineHeight}px`,
      fontFamily: "'Consolas', 'Courier New', 'Fira Code', 'Cascadia Code', monospace",
      tabSize: 2,
    }),
    [fontSize, lineHeight]
  );

  const isDark = theme === 'dark';

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

        {/* Code container with overlay */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Highlighted code layer (behind) */}
          <pre
            ref={preRef}
            aria-hidden="true"
            style={{
              ...editorStyle,
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              margin: 0,
              padding: '8px 12px',
              overflow: 'auto',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              background: 'transparent',
              border: 'none',
              pointerEvents: 'none',
              color: 'var(--text)',
            }}
          >
            <code
              className="language-verilog"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>

          {/* Editable textarea layer (on top, transparent text) */}
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              ...editorStyle,
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              height: '100%',
              padding: '8px 12px',
              border: 'none',
              outline: 'none',
              resize: 'none',
              background: 'transparent',
              color: 'transparent',
              caretColor: isDark ? '#e6edf3' : '#24292f',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              overflow: 'auto',
              zIndex: 1,
            }}
          />
        </div>
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

/** Escape HTML entities for plain text fallback */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}