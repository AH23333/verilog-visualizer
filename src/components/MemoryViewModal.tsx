import { useEffect, useState, useRef } from 'react';

/**
 * 存储器（RAM）内容查看 / 编辑器。
 * digitaljs 架构里 gate 即 jointjs cell —— cell.memdata 就是 Mem3vl 实例（prepare 后就绪）：
 * - 读：cell.memdata.get(addr).toString()
 * - 写：cell.memdata.set(addr, Vector3vl.fromBin(bin, bits)) + cell.trigger('manualMemChange', cell)
 *   （engine 原生监听 manualMemChange 并重新入队，修改立即生效）
 * - 持久化：serializePaper 从实例字段导出 memdataInit 快照，电路重建后 restoreMemoryData 回写。
 *   不能用 memdata 属性名 —— digitaljs 的 initialize 会 removeProp('memdata')。
 */

interface Props {
  cell: any;
  /** 兼容旧签名（未使用） */
  circuitRef?: { current: any };
  onClose: () => void;
}

export function MemoryViewModal({ cell, onClose }: Props) {
  const bits = Number(cell.get('bits')) || 1;
  const abits = Number(cell.get('abits')) || 2;
  const capped = Math.min(abits, 8); // 最多展示 256 字，防止巨表卡死
  const words = 1 << capped;
  const mem: any = (cell as any).memdata ?? null;
  const [rows, setRows] = useState<string[]>(() => {
    const arr: string[] = [];
    for (let a = 0; a < words; a++) {
      try {
        arr.push(mem ? String(mem.get(a)).replace(/^Vector3vl\s+/, '') : 'x');
      } catch { arr.push('x'); }
    }
    return arr;
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  // Escape 关闭（走 onClose —— 关闭时 SandboxCanvas 会 commit，生成 memdataInit 快照）
  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing === null) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  const decOf = (bin: string): string => {
    if (/x/i.test(bin)) return 'x';
    const n = parseInt(bin, 2);
    return Number.isNaN(n) ? 'x' : String(n);
  };

  const commit = (addr: number, input: string) => {
    const s = input.trim().toLowerCase();
    let bin: string;
    if (s === '' || s === 'x') {
      bin = 'x'.repeat(bits);
    } else if (/^[01]+$/.test(s) && s.length === bits) {
      bin = s; // 直接按二进制输入
    } else if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      if (n >= (1 << bits)) { setEditing(null); setDraft(''); return; }
      bin = n.toString(2).padStart(bits, '0');
    } else {
      setEditing(null); setDraft('');
      return;
    }
    if (mem) {
      try {
        const v0 = mem.get(0);
        const Ctor = v0.constructor; // Vector3vl（digitaljs 未导出，从实例取）
        mem.set(addr, Ctor.fromBin(bin, bits));
        // engine 原生监听 manualMemChange —— 重新入队，修改立即生效
        cell.trigger('manualMemChange', cell);
      } catch { /* ignore */ }
    }
    setRows(prev => { const n = [...prev]; n[addr] = bin; return n; });
    setEditing(null); setDraft('');
  };

  /** 批量填充全部字（运行中立即生效 + rows 同步） */
  const fillAll = (bit: '0' | '1') => {
    setRows(prev => prev.map(() => bit.repeat(bits)));
    if (mem) {
      try {
        const v0 = mem.get(0);
        const Ctor = v0.constructor;
        const vec = bit === '1' ? Ctor.fromBin('1'.repeat(bits), bits) : Ctor.zeros(bits);
        for (let a = 0; a < words; a++) mem.set(a, vec);
        cell.trigger('manualMemChange', cell);
      } catch { /* ignore */ }
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-memory-view style={{ background: 'var(--surface, #fff)', borderRadius: 8,
        width: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 40px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', borderBottom: '1px solid var(--border-subtle, #ddd)' }}>
          <span style={{ fontSize: 'var(--fs-sm, 13px)', fontWeight: 600 }}>
            存储器内容 · {bits} 位 × {1 << abits} 字{capped < abits ? '（仅显示前 256 字）' : ''}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button data-mem-fill="0" onClick={() => fillAll('0')} title="全部写 0"
              style={{ padding: '2px 8px', fontSize: 'var(--fs-xs, 11px)', cursor: 'pointer',
                border: '1px solid var(--border-subtle, #ccc)', borderRadius: 3, background: 'transparent' }}>清零</button>
            <button data-mem-fill="1" onClick={() => fillAll('1')} title="全部写 1"
              style={{ padding: '2px 8px', fontSize: 'var(--fs-xs, 11px)', cursor: 'pointer',
                border: '1px solid var(--border-subtle, #ccc)', borderRadius: 3, background: 'transparent' }}>全置 1</button>
            <button onClick={onClose} title="关闭" style={{ border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ padding: '4px 12px', fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-muted, #888)',
          borderBottom: '1px solid var(--border-subtle, #ddd)' }}>
          点击数值编辑：输入十进制（0–{(1 << bits) - 1}）、等长二进制（如 {bits === 4 ? '0101' : '1'}）或 x。
          {mem ? '修改立即写入运行中的电路。' : '（引擎未运行，仅展示）'}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rows.map((bin, addr) => (
            <div key={addr} data-mem-row={addr} style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '2px 12px', fontSize: 'var(--fs-xs, 11px)', fontFamily: 'ui-monospace, monospace',
              borderBottom: '1px solid var(--border-subtle, #eee)' }}>
              <span style={{ width: 46, color: 'var(--text-muted, #888)' }}>#{addr}</span>
              <span style={{ width: 36, color: 'var(--text-muted, #888)' }}>{addr.toString(2).padStart(abits, '0')}</span>
              <span style={{ width: 8 * Math.max(1, Math.ceil(bits / 4)) }}>{bin}</span>
              <span style={{ width: 48, color: 'var(--text-muted, #888)' }}>= {decOf(bin)}</span>
              <span style={{ flex: 1 }} />
              {editing === addr ? (
                <input autoFocus data-mem-input value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(addr, draft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(addr, draft);
                    if (e.key === 'Escape') { setEditing(null); setDraft(''); }
                  }}
                  style={{ width: 90, padding: '1px 5px', fontSize: 'var(--fs-xs, 11px)',
                    border: '1px solid var(--accent, #2563eb)', borderRadius: 3 }} />
              ) : (
                <button data-mem-edit={addr} onClick={() => { setEditing(addr); setDraft(/x/.test(bin) ? '' : decOf(bin)); }}
                  style={{ padding: '1px 8px', fontSize: 'var(--fs-xs, 11px)', cursor: 'pointer',
                    border: '1px solid var(--border-subtle, #ccc)', borderRadius: 3,
                    background: 'transparent', color: 'var(--text, #333)' }}>
                  编辑
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
