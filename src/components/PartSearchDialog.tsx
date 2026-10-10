import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import type { PartSearchSource } from '../lib/partSearch';

/**
 * 部件搜索弹窗（Ctrl+F 路由到画布时打开 —— 编译模式与沙盒共用这一颗）。
 *
 * 数据源经 `partSearchRegistry` 注入：弹窗不认得任何模式，只调 `getSource()` 现取
 * 当前台上画布的搜索句柄 —— 模式切换/电路重建都不用重建弹窗本身。
 *
 * Esc 关闭遵循 r87 那一条纪律：回调塞 ref、依赖表 `[]`，不许拿父组件现建的
 * onClose 当依赖。
 */
interface Props {
  open: boolean;
  onClose: () => void;
  getSource: () => PartSearchSource | null;
}

export default function PartSearchDialog({ open, onClose, getSource }: Props) {
  const [query, setQuery] = useState('');
  const [entered, setEntered] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  // 每次打开都清空上轮输入、聚焦到输入框
  useEffect(() => {
    if (open) {
      setQuery('');
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const source = open ? getSource() : null;
  const hits = useMemo(
    () => (source ? source.list(query) : []),
    [source, query, entered],
  );

  const jump = useCallback((id: string) => {
    const s = getSource();
    if (s && s.locate(id)) onClose(); // 定位成功才关（先把用户带到那颗）；失败留在弹窗里
  }, [getSource, onClose]);

  if (!open) return null;

  const label = (h: { label: string; type: string; celltype?: string }) =>
    h.celltype ? `${h.label}（${h.celltype}）` : h.label;

  return (
    <div
      data-part-search-dialog=""
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
      }}
    >
      <div style={{
        width: 480, maxWidth: 'calc(100vw - 40px)', maxHeight: '60vh',
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            data-part-search-input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setEntered((n) => n + 1); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const first = hits[0];
                if (first) jump(first.id);
              }
            }}
            placeholder="输入部件名称（label / 类型 / 绑定名 / 网络）"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 'var(--fs-md)',
            }}
          />
          <button onClick={onClose} title="关闭" style={{
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', padding: 2,
          }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: '6px 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {hits.length > 0 ? `匹配 ${hits.length} 个部件` : source ? '没有匹配的部件' : '当前没有可搜索的画布'}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 6px 8px' }}>
          {hits.map((h) => (
            <button
              key={h.id}
              data-part-search-item
              onClick={() => jump(h.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--text)', padding: '6px 8px', borderRadius: 6,
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 500 }}>{label(h)}</span>
              <span style={{ marginLeft: 8, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{h.type}</span>
              {h.net ? <span style={{ marginLeft: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>net {h.net}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}