import { useEffect, useState, useRef } from 'react';

/**
 * 存储器（RAM/ROM）端口配置窗。
 *
 * 端口不是画出来的，是 digitaljs 按 `rdports` / `wrports` 里的**键在不在**生成的
 * （cells/memory.mjs:44-84：`'clock_polarity' in port` 才加 clk 脚……），
 * 所以"不要这个口"必须是**把这个键整个删掉**，不能留 `键: undefined`
 * —— 键存在就代表端口存在，与值无关。这里每次都用新对象重建，绝不在旧对象上改回 undefined。
 *
 * 全部改完必须重建器件（Memory 的这些项都在 `_unsupportedPropChanges` 名单里）。
 */

interface Props {
  cell: any;
  onApply: (patch: { bits: number; abits: number; words?: number; offset?: number;
    rdports: Record<string, any>[]; wrports: Record<string, any>[] }) => void;
  onClose: () => void;
}

type Sel = { label: string; value: string };
const CLK_OPTS: Sel[] = [{ label: '无时钟（组合读）', value: 'none' }, { label: '时钟 ↑', value: '1' }, { label: '时钟 ↓', value: '0' }];
const EN_OPTS: Sel[] = [{ label: '无使能', value: 'none' }, { label: '使能 高有效', value: '1' }, { label: '使能 低有效', value: '0' }];
const RST_OPTS: Sel[] = [{ label: '无', value: 'none' }, { label: '高有效', value: '1' }, { label: '低有效', value: '0' }];

/** 从端口对象里取某键（不存在＝'none'），供下拉显示 */
const getSel = (p: Record<string, any>, key: string) => (key in p ? String(p[key]) : 'none');
/** 写回：值 'none' 时删键，其它值写成数字（键的存在本身就代表端口存在） */
function setSel(p: Record<string, any>, key: string, v: string) {
  if (v === 'none') delete p[key];
  else p[key] = Number(v);
  return p;
}

const BIN = /^[01x]+$/i;

export function MemPortsModal({ cell, onApply, onClose }: Props) {
  const [bits, setBits] = useState(Math.max(1, Math.min(32, Number(cell.get('bits')) || 1)));
  const [abits, setAbits] = useState(Math.max(1, Math.min(16, Number(cell.get('abits')) || 2)));
  const [wordsStr, setWordsStr] = useState(cell.get('words') == null ? '' : String(cell.get('words')));
  const [offsetStr, setOffsetStr] = useState(cell.get('offset') == null ? '' : String(cell.get('offset')));
  const [rd, setRd] = useState<Record<string, any>[]>(() =>
    (Array.isArray(cell.get('rdports')) ? cell.get('rdports') : [{ clock_polarity: 1 }]).map((p: any) => ({ ...p })));
  const [wr, setWr] = useState<Record<string, any>[]>(() =>
    (Array.isArray(cell.get('wrports')) ? cell.get('wrports') : [{ clock_polarity: 1 }]).map((p: any) => ({ ...p })));
  const [err, setErr] = useState('');

  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const rowStyle = { display: 'flex', gap: 6, alignItems: 'center',
    padding: '4px 12px', borderBottom: '1px solid var(--border-subtle, #eee)', fontSize: 'var(--fs-xs, 11px)' };
  const boxStyle = { padding: '1px 4px', fontSize: 'var(--fs-xs, 11px)',
    border: '1px solid var(--border, #ccc)', borderRadius: 3, background: 'var(--surface, #fff)', color: 'var(--text, #222)' };

  const sel = (opts: Sel[], value: string, set: (v: string) => void, title: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-secondary, #666)' }} title={title}>
      <select value={value} onChange={(e) => set(e.target.value)} style={boxStyle}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  const binField = (value: string | undefined, set: (v: string | undefined) => void, width: number, title: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-secondary, #666)' }} title={title}>
      {title}
      <input value={value ?? ''} placeholder={`${'0'.repeat(width)} / 留空`}
        onChange={(e) => { const v = e.target.value.trim(); set(v === '' ? undefined : v); }}
        style={{ ...boxStyle, width: 8 + 9 * Math.max(4, width), fontFamily: 'ui-monospace, monospace' }} />
    </label>
  );

  const patchRd = (i: number, fn: (p: Record<string, any>) => void) =>
    setRd((list) => list.map((p, k) => { if (k !== i) return p; const n = { ...p }; fn(n); return n; }));
  const patchWr = (i: number, fn: (p: Record<string, any>) => void) =>
    setWr((list) => list.map((p, k) => { if (k !== i) return p; const n = { ...p }; fn(n); return n; }));

  const apply = () => {
    if (bits < 1 || bits > 32) { setErr('数据位宽必须 1–32'); return; }
    if (abits < 1 || abits > 16) { setErr('地址位宽必须 1–16'); return; }
    const words = wordsStr === '' ? undefined : Number(wordsStr);
    if (wordsStr !== '' && (!Number.isFinite(words) || (words as number) < 1 || (words as number) > 65536)) {
      setErr('字数留空即可（按地址位宽 2^abits），或填 1–65536'); return;
    }
    const offset = offsetStr === '' ? undefined : Number(offsetStr);
    if (offsetStr !== '' && !Number.isFinite(offset)) { setErr('地址偏移必须是数字'); return; }
    for (const [i, p] of rd.entries()) {
      for (const k of ['init_value', 'srst_value', 'arst_value'] as const) {
        const v = p[k];
        if (v != null && (!BIN.test(String(v)) || String(v).length > bits)) { setErr(`读口 ${i} 的${k === 'init_value' ? '输出初值' : k === 'srst_value' ? '同步复位值' : '异步复位值'}只能是 0/1/x，且不长于 ${bits} 位`); return; }
      }
      if (!('srst_polarity' in p) && p.srst_value != null) delete p.srst_value;
      if (!('arst_polarity' in p) && p.arst_value != null) delete p.arst_value;
    }
    if (!rd.length && !wr.length) { setErr('至少要有一个读口或写口'); return; }
    onApply({ bits, abits, words, offset, rdports: rd.map((p) => ({ ...p })), wrports: wr.map((p) => ({ ...p })) });
  };

  return (
    <div data-memports-modal="" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 680, maxHeight: '84vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface, #fff)', border: '1px solid var(--border, #ccc)',
          borderRadius: 'var(--radius-md, 8px)', boxShadow: '0 12px 40px rgba(0,0,0,.35)', color: 'var(--text, #222)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-sm, 12px)', fontWeight: 700 }}>
          <span>存储器端口配置 — {String(cell.get('label') || cell.get('net') || cell.id).slice(0, 24)}</span>
          <span style={{ flex: 1 }} />
          <button data-memports-close="" onClick={onClose}
            style={{ padding: '1px 8px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 3, background: 'transparent', color: 'var(--text, #333)' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px',
          fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-secondary, #666)',
          borderBottom: '1px solid var(--border-subtle, #eee)' }}>
          <span>数据位宽 <input data-memports-f="bits" value={String(bits)} style={{ ...boxStyle, width: 44 }}
            onChange={(e) => setBits(Number(e.target.value) || 0)} /></span>
          <span>地址位宽 <input data-memports-f="abits" value={String(abits)} style={{ ...boxStyle, width: 44 }}
            onChange={(e) => setAbits(Number(e.target.value) || 0)} /></span>
          <span>字数 <input data-memports-f="words" value={wordsStr} placeholder={`默认 ${1 << Math.min(abits, 16)}`}
            style={{ ...boxStyle, width: 70 }} onChange={(e) => setWordsStr(e.target.value)} /></span>
          <span>地址偏移 <input data-memports-f="offset" value={offsetStr} placeholder="0"
            style={{ ...boxStyle, width: 56 }} onChange={(e) => setOffsetStr(e.target.value)} /></span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '6px 12px 2px', fontSize: 'var(--fs-xs, 11px)', fontWeight: 700, color: 'var(--text-secondary, #666)' }}>
            读口（{rd.length}）
            <button data-memports-add-rd="" style={{ marginLeft: 8, cursor: 'pointer', border: '1px solid var(--accent, #2563eb)',
              borderRadius: 3, background: 'transparent', color: 'var(--accent, #2563eb)', fontSize: 'var(--fs-xs, 11px)', padding: '0 6px' }}
              onClick={() => setRd((l) => [...l, { clock_polarity: 1 }])}>+ 加读口</button>
          </div>
          {rd.map((p, i) => (
            <div key={`rd${i}`} data-memports-rd={i} style={rowStyle}>
              <span style={{ width: 42, color: 'var(--text-muted, #888)' }}>rd{i}</span>
              {sel(CLK_OPTS, getSel(p, 'clock_polarity'), (v) => patchRd(i, (n) => setSel(n, 'clock_polarity', v)), '时钟')}
              {sel(EN_OPTS, getSel(p, 'enable_polarity'), (v) => patchRd(i, (n) => setSel(n, 'enable_polarity', v)), '使能')}
              {sel(RST_OPTS, getSel(p, 'srst_polarity'), (v) => patchRd(i, (n) => setSel(n, 'srst_polarity', v)), '同步复位')}
              {sel(RST_OPTS, getSel(p, 'arst_polarity'), (v) => patchRd(i, (n) => setSel(n, 'arst_polarity', v)), '异步复位')}
              {binField(p.init_value, (v) => patchRd(i, (n) => { if (v == null) delete n.init_value; else n.init_value = v; }), bits, '初值')}
              <span style={{ flex: 1 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="同址读写">
                <select data-memports-hazard={i} value={'transparent' in p ? 'T' : 'collision' in p ? 'X' : 'none'}
                  style={boxStyle}
                  onChange={(e) => patchRd(i, (n) => {
                    delete n.transparent; delete n.collision;
                    if (e.target.value === 'T') n.transparent = true;
                    if (e.target.value === 'X') n.collision = true;
                  })}>
                  <option value="none">同址写：读到旧值</option>
                  <option value="T">同址写：透明（读到新值）</option>
                  <option value="X">同址写：冲突（输出 x）</option>
                </select>
              </label>
              <button data-memports-del-rd={i} onClick={() => setRd((l) => l.filter((_, k) => k !== i))}
                style={{ padding: '1px 7px', cursor: 'pointer', border: '1px solid var(--border-subtle, #ccc)',
                  borderRadius: 3, background: 'transparent', color: 'var(--danger, #b91c1c)' }}>删</button>
            </div>
          ))}

          <div style={{ padding: '8px 12px 2px', fontSize: 'var(--fs-xs, 11px)', fontWeight: 700, color: 'var(--text-secondary, #666)' }}>
            写口（{wr.length}）
            <button data-memports-add-wr="" style={{ marginLeft: 8, cursor: 'pointer', border: '1px solid var(--accent, #2563eb)',
              borderRadius: 3, background: 'transparent', color: 'var(--accent, #2563eb)', fontSize: 'var(--fs-xs, 11px)', padding: '0 6px' }}
              onClick={() => setWr((l) => [...l, { clock_polarity: 1 }])}>+ 加写口</button>
          </div>
          {wr.map((p, i) => (
            <div key={`wr${i}`} data-memports-wr={i} style={rowStyle}>
              <span style={{ width: 42, color: 'var(--text-muted, #888)' }}>wr{i}</span>
              {sel(CLK_OPTS, getSel(p, 'clock_polarity'), (v) => patchWr(i, (n) => setSel(n, 'clock_polarity', v)), '时钟')}
              {sel(EN_OPTS, getSel(p, 'enable_polarity'), (v) => patchWr(i, (n) => setSel(n, 'enable_polarity', v)), '使能')}
              <label title="写使能粒度">
                <select data-memports-bitenable={i} style={boxStyle}
                  value={p.no_bit_enable ? 'byte' : 'bit'}
                  onChange={(e) => patchWr(i, (n) => { if (e.target.value === 'bit') delete n.no_bit_enable; else n.no_bit_enable = true; })}>
                  <option value="bit">逐位写使能（{bits} 位）</option>
                  <option value="byte">整字写使能（1 位）</option>
                </select>
              </label>
              <span style={{ flex: 1 }} />
              <button data-memports-del-wr={i} onClick={() => setWr((l) => l.filter((_, k) => k !== i))}
                style={{ padding: '1px 7px', cursor: 'pointer', border: '1px solid var(--border-subtle, #ccc)',
                  borderRadius: 3, background: 'transparent', color: 'var(--danger, #b91c1c)' }}>删</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
          borderTop: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-xs, 11px)' }}>
          <span style={{ color: err ? 'var(--danger, #b91c1c)' : 'var(--text-muted, #888)', flex: 1 }}>
            {err || '端口按这里的配置重建；改位宽或增删口后，原有连线只在该端口仍存在时才接回。'}
          </span>
          <button data-memports-cancel="" onClick={onClose}
            style={{ padding: '3px 12px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)', background: 'transparent', color: 'var(--text, #333)' }}>取消</button>
          <button data-memports-apply="" onClick={apply}
            style={{ padding: '3px 14px', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 600 }}>应用（重建器件）</button>
        </div>
      </div>
    </div>
  );
}
