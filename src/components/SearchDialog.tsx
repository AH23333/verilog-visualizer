// Global search dialog - searches across all project files

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FileEntry } from '../store/fileStore';

interface SearchDialogProps {
  files: FileEntry[];
  theme: 'dark' | 'light';
  onClose: () => void;
  onOpenFile: (fileId: string, line: number) => void;
}

interface SearchResult {
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export default function SearchDialog({ files, theme, onClose, onOpenFile }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape to close
  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const doSearch = useCallback(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setSearching(true);
    const allResults: SearchResult[] = [];

    try {
      let pattern: RegExp;
      if (regex) {
        pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }

      for (const file of files) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let match: RegExpExecArray | null;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(line)) !== null) {
            allResults.push({
              fileId: file.id,
              fileName: file.name,
              line: i + 1,
              column: match.index + 1,
              lineContent: line.trim(),
              matchStart: match.index,
              matchEnd: match.index + match[0].length,
            });
            if (match[0].length === 0) pattern.lastIndex++;
          }
        }
      }
    } catch {
      // Invalid regex
    }

    setResults(allResults);
    setSearching(false);
  }, [query, caseSensitive, regex, files]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(doSearch, 200);
    return () => clearTimeout(timer);
  }, [doSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      doSearch();
    }
  }, [doSearch]);

  const bg = theme === 'dark' ? 'var(--bg-elevated)' : 'var(--bg)';
  const border = 'var(--border)';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '10vh',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 640,
          maxHeight: '70vh',
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid var(--border-subtle)` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="在所有文件中搜索..."
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 'var(--fs-md)',
                background: 'var(--input-bg)',
                color: 'var(--text)',
                border: `1px solid var(--input-border)`,
                borderRadius: 'var(--radius-md)',
                outline: 'none',
              }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Aa
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              .*
            </label>
          </div>
          <div style={{ marginTop: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {searching ? '搜索中...' : results.length > 0 ? `在 ${new Set(results.map((r) => r.fileId)).size} 个文件中找到 ${results.length} 条结果` : query ? '无结果' : `在 ${files.length} 个文件中搜索`}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {results.slice(0, 200).map((result, i) => (
            <div
              key={`${result.fileId}-${result.line}-${i}`}
              onClick={() => onOpenFile(result.fileId, result.line)}
              style={{
                padding: '6px 16px',
                cursor: 'pointer',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                fontSize: 'var(--fs-md)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span style={{ color: 'var(--text-muted)', minWidth: 120, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.fileName}:{result.line}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                {result.lineContent.length > 100
                  ? result.lineContent.substring(0, 100) + '...'
                  : result.lineContent}
              </span>
            </div>
          ))}
          {results.length > 200 && (
            <div style={{ padding: '8px 16px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              Showing first 200 of {results.length} results. Refine your search for more specific results.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}