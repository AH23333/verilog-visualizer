import { useEffect, useRef, useMemo, useState, useCallback, forwardRef, useImperativeHandle, type CSSProperties } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { EditorState, type Extension, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  placeholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
} from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
  StreamLanguage,
} from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { settingsStore } from '../store/settingsStore';

interface CodeEditorProps {
  code: string;
  fileName: string;
  theme: 'dark' | 'light';
  onCodeChange: (code: string) => void;
  onSave: () => void;
  onRecompile: () => void;
  isCompiling: boolean;
  /** Fired on cursor line change (for live cross-highlight in split view). */
  onCursorLineChange?: (line: number) => void;
}

const themeCompartment = new Compartment();

export interface CodeEditorHandle {
  undo: () => void;
  redo: () => void;
  /** Open the in-file find/replace bar and focus the query input. */
  openFind: () => void;
  /** Select the whole given line (1-based, clamped), scroll it into view, focus editor. */
  jumpToLine: (line: number) => void;
  /** Current primary-cursor line (1-based), or null when no editor instance. */
  getCursorLine: () => number | null;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  code,
  fileName,
  theme,
  onCodeChange,
  onSave,
  onRecompile,
  isCompiling,
  onCursorLineChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onCodeChange);
  onChangeRef.current = onCodeChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onRecompileRef = useRef(onRecompile);
  onRecompileRef.current = onRecompile;
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  onCursorLineChangeRef.current = onCursorLineChange;

  // ---- Search state ----
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Build extensions (stable, theme-independent part)
  const baseExtensions = useMemo<Extension[]>(() => [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    foldGutter(),
    indentOnInput(),
    placeholder('// Write Verilog code here...'),
    history(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
      if (update.selectionSet && onCursorLineChangeRef.current) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos).number;
        onCursorLineChangeRef.current(line);
      }
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      { key: 'Mod-s', run: () => { onSaveRef.current(); return true; }, preventDefault: true },
      { key: 'F5', run: () => { onRecompileRef.current(); return true; }, preventDefault: true },
      { key: 'Mod-f', run: (_view) => { setSearchVisible(true); setTimeout(() => searchInputRef.current?.focus(), 0); return true; }, preventDefault: true },
      // Clipboard: use Tauri clipboard plugin via invoke as primary, fallback to DOM
      { key: 'Mod-c', run: (view) => {
        const sel = view.state.selection.main;
        if (sel.empty) return false;
        const text = view.state.doc.sliceString(sel.from, sel.to);
        // Prefer Tauri clipboard plugin
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('plugin:clipboard-manager|write_text', { text }).catch(() => {
            // Fallback: DOM textarea trick
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          });
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        });
        return true;
      }},
      { key: 'Mod-v', run: (view) => {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('plugin:clipboard-manager|read_text').then((text) => {
            if (typeof text === 'string') view.dispatch(view.state.replaceSelection(text));
          }).catch(() => { /* fallback: let browser native handle via DOM */ });
        }).catch(() => { /* fallback: let browser native handle */ });
        return true;
      }},
      { key: 'Mod-x', run: (view) => {
        const sel = view.state.selection.main;
        if (sel.empty) return false;
        const text = view.state.doc.sliceString(sel.from, sel.to);
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('plugin:clipboard-manager|write_text', { text }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          });
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        });
        view.dispatch(view.state.replaceSelection(''));
        return true;
      }},
      { key: 'Mod-=', run: () => { settingsStore.increaseFontSize(); return true; } },
      { key: 'Mod--', run: () => { settingsStore.decreaseFontSize(); return true; } },
      { key: 'Mod-0', run: () => { settingsStore.resetFontSize(); return true; } },
    ]),
    StreamLanguage.define(verilog),
    themeCompartment.of(theme === 'dark' ? oneDark : syntaxHighlighting(defaultHighlightStyle)),
    EditorView.theme({
      '&': { height: '100%', fontSize: '1rem', fontFamily: "'Consolas', 'Courier New', monospace" },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontSize: '1rem', fontFamily: "'Consolas', 'Courier New', monospace", lineHeight: '1.6' },
      '.cm-line': { lineHeight: '1.6' },
      '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)' },
      '.cm-activeLine': { backgroundColor: 'var(--accent-muted)' },
      '.cm-cursor': { borderLeftColor: 'var(--text)' },
      '.cm-selectionBackground': { backgroundColor: 'var(--accent-muted) !important' },
      '.cm-matchingBracket': { backgroundColor: 'var(--accent-muted)', outline: '1px solid var(--accent)' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
      '.cm-tooltip': { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' },
      '.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
        '& .cm-completionLabel': { color: 'var(--text)' },
        '& .cm-completionDetail': { color: 'var(--text-muted)' },
        '& .cm-completionMatchedText': { color: 'var(--accent)' },
        '& li[aria-selected]': { backgroundColor: 'var(--accent-muted)', color: 'var(--text)' },
      },
      '.cm-searchMatch': { backgroundColor: 'var(--warning-muted)', outline: '1px solid var(--warning)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--accent-muted)', outline: '1px solid var(--accent)' },
      '.cm-panel': { backgroundColor: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', color: 'var(--text)' },
      '.cm-panel input': { backgroundColor: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--input-border)' },
      '.cm-panel button': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' },
    }, { dark: theme === 'dark' }),
  ], []);

  // Create editor on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const state = EditorState.create({
      doc: code,
      extensions: baseExtensions,
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update editor content from outside
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentCode = view.state.doc.toString();
    if (currentCode !== code) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      });
    }
  }, [code]);

  // Update theme via compartment
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(
        theme === 'dark' ? oneDark : syntaxHighlighting(defaultHighlightStyle)
      ),
    });
  }, [theme]);

  // Sync font size
  useEffect(() => {
    return settingsStore.subscribe(() => {
      const size = settingsStore.getFontSize();
      document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
      viewRef.current?.requestMeasure();
    });
  }, []);

  // ---- Search helpers ----
  const findMatches = useCallback((view: EditorView): { from: number; to: number }[] => {
    if (!searchQuery) return [];
    try {
      const text = view.state.doc.toString();
      let pattern: RegExp;
      if (useRegex) {
        pattern = new RegExp(searchQuery, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }
      const matches: { from: number; to: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        matches.push({ from: m.index, to: m.index + m[0].length });
        if (m[0].length === 0) pattern.lastIndex++;
      }
      return matches;
    } catch {
      return [];
    }
  }, [searchQuery, caseSensitive, useRegex]);

  const doFindNext = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const matches = findMatches(view);
    setMatchCount(matches.length);
    if (matches.length === 0) return;

    const sel = view.state.selection.main;
    let nextIdx = 0;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].from >= sel.to) {
        nextIdx = i;
        break;
      }
    }
    setMatchIndex(nextIdx);
    view.dispatch({
      selection: { anchor: matches[nextIdx].from, head: matches[nextIdx].to },
      scrollIntoView: true,
    });
  }, [findMatches]);

  const doFindPrev = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const matches = findMatches(view);
    setMatchCount(matches.length);
    if (matches.length === 0) return;

    const sel = view.state.selection.main;
    let prevIdx = matches.length - 1;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].to <= sel.from) {
        prevIdx = i;
        break;
      }
    }
    setMatchIndex(prevIdx);
    view.dispatch({
      selection: { anchor: matches[prevIdx].from, head: matches[prevIdx].to },
      scrollIntoView: true,
    });
  }, [findMatches]);

  const doReplaceOne = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const sel = view.state.selection.main;
    const matches = findMatches(view);

    // Check if current selection matches a search result
    let matchAtSelection = false;
    for (const m of matches) {
      if (m.from === sel.from && m.to === sel.to) {
        matchAtSelection = true;
        break;
      }
    }

    if (matchAtSelection) {
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replaceText },
      });
    }

    doFindNext();
  }, [findMatches, replaceText, doFindNext]);

  const doReplaceAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const matches = findMatches(view);
    if (matches.length === 0) return;

    // Apply in reverse order to preserve positions
    const changes = matches.reverse().map((m) => ({
      from: m.from,
      to: m.to,
      insert: replaceText,
    }));
    view.dispatch({ changes });
    setMatchCount(0);
    setMatchIndex(0);
  }, [findMatches, replaceText]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchQuery('');
    setReplaceText('');
    setMatchCount(0);
    setMatchIndex(0);
  }, []);

  // Imperative surface for the app-level menu / global shortcuts
  const openFindHandle = useCallback(() => {
    setSearchVisible(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  useImperativeHandle(ref, () => ({
    undo: () => { const v = viewRef.current; if (v) undo(v); },
    redo: () => { const v = viewRef.current; if (v) redo(v); },
    openFind: openFindHandle,
    jumpToLine: (line: number) => {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.max(1, Math.min(Math.round(line) || 1, view.state.doc.lines));
      const lineObj = view.state.doc.line(clamped);
      view.dispatch({
        selection: { anchor: lineObj.from, head: lineObj.to },
        scrollIntoView: true,
      });
      view.focus();
    },
    getCursorLine: () => {
      const view = viewRef.current;
      if (!view) return null;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    },
  }), [openFindHandle]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) doFindPrev();
      else doFindNext();
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }, [doFindNext, doFindPrev, closeSearch]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 14px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, minHeight: 32,
      }}>
        <span style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {fileName}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => { const v = viewRef.current; if (v) undo(v); }}
            title="Undo (Ctrl+Z)"
            style={toolbarBtnStyle}
          >&#x21B6;</button>
          <button
            onClick={() => { const v = viewRef.current; if (v) redo(v); }}
            title="Redo (Ctrl+Y)"
            style={toolbarBtnStyle}
          >&#x21B7;</button>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginLeft: 4 }}>Verilog</span>
          <button
            onClick={onRecompile}
            disabled={isCompiling}
            title="Compile (F5)"
            style={{
              padding: '2px 12px', background: isCompiling ? 'var(--text-muted)' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
              cursor: isCompiling ? 'default' : 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 500,
            }}
          >
            {isCompiling ? 'Compiling...' : 'Compile'}
          </button>
        </div>
      </div>
      {/* Search Bar */}
      {searchVisible && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find..."
              style={{
                width: 180, padding: '3px 8px', fontSize: 'var(--fs-sm)',
                background: 'var(--input-bg)', color: 'var(--text)',
                border: '1px solid var(--input-border)', borderRadius: 'var(--radius-sm)',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', minWidth: 40 }}>
              {searchQuery ? `${matchIndex + 1}/${matchCount}` : ''}
            </span>
            <button
              onClick={doFindPrev} title="Previous match (Shift+Enter)"
              style={searchBtnStyle}
            ><ChevronUp size={13} /></button>
            <button
              onClick={doFindNext} title="Next match (Enter)"
              style={searchBtnStyle}
            ><ChevronDown size={13} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={replaceInputRef}
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Replace..."
              style={{
                width: 150, padding: '3px 8px', fontSize: 'var(--fs-sm)',
                background: 'var(--input-bg)', color: 'var(--text)',
                border: '1px solid var(--input-border)', borderRadius: 'var(--radius-sm)',
                outline: 'none',
              }}
            />
            <button onClick={doReplaceOne} title="Replace" style={searchBtnStyle}>Replace</button>
            <button onClick={doReplaceAll} title="Replace All" style={searchBtnStyle}>All</button>
          </div>
          <button onClick={() => setCaseSensitive((v) => !v)} title="Match case"
            style={{ ...searchBtnStyle, fontWeight: 600, background: caseSensitive ? 'var(--accent-muted)' : 'transparent', color: caseSensitive ? 'var(--accent)' : 'var(--text-secondary)' }}>Aa</button>
          <button onClick={() => setUseRegex((v) => !v)} title="Use regex"
            style={{ ...searchBtnStyle, fontFamily: 'monospace', background: useRegex ? 'var(--accent-muted)' : 'transparent', color: useRegex ? 'var(--accent)' : 'var(--text-secondary)' }}>.re</button>
          <button onClick={closeSearch} title="Close (Escape)" style={{ ...searchBtnStyle, marginLeft: 'auto' }}><X size={13} /></button>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
});

export default CodeEditor;

const searchBtnStyle: CSSProperties = {
  padding: '2px 8px', fontSize: 'var(--fs-xs)', fontWeight: 500,
  background: 'var(--surface)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const toolbarBtnStyle: CSSProperties = {
  padding: '2px 6px', fontSize: 'var(--fs-sm)', fontWeight: 500,
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};