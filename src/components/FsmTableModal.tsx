import { useEffect, useState, useRef } from 'react';

/**
 * 状态机（digitaljs 的 FSM 器件）转移表编辑器。
 *
 * 数据形状由上游定死，不是这里发明的：
 *  - digitaljs `cells/FSM.mjs` 的 prepare() 按 `trans_table` 逐条
 *    `Vector3vl.fromBin(tr.ctrl_in, bits.in)` / `fromBin(tr.ctrl_out, bits.out)`，
 *    所以 ctrl_in / ctrl_out 必须是**二进制字符串**（可含 x 表示无关位），
 *    state_in / state_out 是**整数**状态号；
 *  - yosys2digitaljs 从 $fsm 的 TRANS_TABLE 解出来的也是这四个字段同一形状
 *    （core.ts:994-1010），所以编译模式复制过来的机器人在这里读写同形。
 *
 * 状态数 / 初始状态 / 位宽都在 digitaljs 的 `_unsupportedPropChanges` 名单里
 * （FSM.mjs:180）—— 改完必须由调用方**重建器件**，不能 cell.set()。
 */

export interface FsmTrans {
  state_in: number;
  ctrl_in: string;
  state_out: number;
  ctrl_out: string;
}

interface Props {
  /** joint cell（digitaljs FSM 实例） */
  cell: any;
  /** 应用改动：调用方用 reconfigureCell 重建器件（保留 id / 位置 / 连线） */
  onApply: (patch: { states: number; init_state: number; bits: { in: number; out: number }; trans_table: FsmTrans[] }) => void;
  onClose: () => void;
}

const BIN_RE = /^[01x]+$/i;

/** 把用户填的串对齐到指定位宽：太长截断、太短右侧补 0；空串按全 x 处理 */
function fitBin(raw: string, width: number): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'x'.repeat(width);
  const clean = s.replace(/[^01x]/g, '');
  if (!clean) return 'x'.repeat(width);
  return clean.length >= width ? clean.slice(0, width) : clean.padEnd(width, '0');
}

const cellInput = (width: number) => ({
  width: 8 + 12 * Math.max(1, width), padding: '1px 5px', fontSize: 'var(--fs-xs, 11px)',
  fontFamily: 'ui-monospace, monospace', border: '1px solid var(--border, #ccc)', borderRadius: 3,
  background: 'var(--surface, #fff)', color: 'var(--text, #222)',
});

function StateSelect({ dataKey, value, states, onChange }: {
  dataKey: string; value: number; states: number; onChange: (v: number) => void;
}) {
  return (
    <select data-fsm-state={dataKey} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 76, padding: '1px 2px', fontSize: 'var(--fs-xs, 11px)',
        border: '1px solid var(--border, #ccc)', borderRadius: 3,
        background: 'var(--surface, #fff)', color: 'var(--text, #222)' }}>
      {Array.from({ length: states }, (_, s) => <option key={s} value={String(s)}>{s}</option>)}
    </select>
  );
}

export function FsmTableModal({ cell, onApply, onClose }: Props) {
  const b = cell.get('bits') || { in: 1, out: 1 };
  const [states, setStates] = useState(Math.max(1, Math.min(64, Number(cell.get('states')) || 1)));
  const [init, setInit] = useState(Math.max(0, Number(cell.get('init_state')) || 0));
  const [inBits, setInBits] = useState(Math.max(1, Math.min(16, Number((b as any).in) || 1)));
  const [outBits, setOutBits] = useState(Math.max(1, Math.min(16, Number((b as any).out) || 1)));
  const [rows, setRows] = useState<FsmTrans[]>(() => {
    const src = Array.isArray(cell.get('trans_table')) ? (cell.get('trans_table') as FsmTrans[]) : [];
    return src.map((t) => ({
      state_in: Number(t.state_in) || 0, ctrl_in: String(t.ctrl_in ?? ''),
      state_out: Number(t.state_out) || 0, ctrl_out: String(t.ctrl_out ?? ''),
    }));
  });
  const [err, setErr] = useState('');
  // 仿真跑着的时候实时显示当前状态：这是 FSM 器件最有说服力的一格（digitaljs 自己
  // 也靠 change:current_state 高亮状态图的圆圈）
  const [cur, setCur] = useState<null | number>(() => {
    const c = cell.get('current_state');
    return c == null ? null : Number(c);
  });
  useEffect(() => {
    const on = () => { const c = cell.get('current_state'); setCur(c == null ? null : Number(c)); };
    cell.on('change:current_state', on);
    const t = window.setInterval(on, 300);
    return () => { cell.off('change:current_state', on); window.clearInterval(t); };
  }, [cell]);
  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const setRow = (i: number, patch: Partial<FsmTrans>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const apply = () => {
    if (states < 1 || states > 64) { setErr('状态数必须落在 1–64'); return; }
    if (init < 0 || init >= states) { setErr(`初始状态必须在 0–${states - 1}`); return; }
    for (const [i, r] of rows.entries()) {
      if (r.state_in < 0 || r.state_in >= states) { setErr(`第 ${i + 1} 行：源状态超出范围`); return; }
      if (r.state_out < 0 || r.state_out >= states) { setErr(`第 ${i + 1} 行：目标状态超出范围`); return; }
      if (r.ctrl_in && !BIN_RE.test(r.ctrl_in)) { setErr(`第 ${i + 1} 行：输入条件只能是 0/1/x`); return; }
      if (r.ctrl_out && !BIN_RE.test(r.ctrl_out)) { setErr(`第 ${i + 1} 行：输出值只能是 0/1/x`); return; }
    }
    // 同一源状态下两条完全相同的输入条件 = 引擎按顺序取第一条匹配（FSM.mjs 的
    // next_trans），出图上会画出两条一样的弧，看着像冲突。这里只拦完全重复的。
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      const key = `${r.state_in}|${fitBin(r.ctrl_in, inBits)}`;
      if (seen.has(key)) { setErr(`第 ${i + 1} 行：源状态 ${r.state_in} 已有同样条件的转移`); return; }
      seen.add(key);
    }
    onApply({
      states, init_state: init, bits: { in: inBits, out: outBits },
      trans_table: rows.map((r) => ({
        state_in: r.state_in, state_out: r.state_out,
        ctrl_in: fitBin(r.ctrl_in, inBits), ctrl_out: fitBin(r.ctrl_out, outBits),
      })),
    });
  };

  const label = String(cell.get('label') || cell.get('celltype') || '状态机');
  const num = (v: string) => (v === '' ? '' : String(Number(v)));
  const input = (aria: string, value: string, set: (s: string) => void, min: number, max: number) => (
    <input data-fsm-meta={aria} value={value}
      onChange={(e) => set(num(e.target.value))}
      min={min} max={max}
      style={{ width: 52, padding: '1px 4px', fontSize: 'var(--fs-xs, 11px)', fontFamily: 'ui-monospace, monospace',
        border: '1px solid var(--border, #ccc)', borderRadius: 3, background: 'var(--surface, #fff)', color: 'var(--text, #222)' }} />
  );

  return (
    <div data-fsm-modal="" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface, #fff)', border: '1px solid var(--border, #ccc)',
          borderRadius: 'var(--radius-md, 8px)', boxShadow: '0 12px 40px rgba(0,0,0,.35)',
          color: 'var(--text, #222)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-sm, 12px)', fontWeight: 700 }}>
          <span>状态机转移表 — {label}</span>
          <span style={{ flex: 1 }} />
          <span data-fsm-cur="" style={{ fontWeight: 600, color: 'var(--accent, #2563eb)', fontSize: 'var(--fs-xs, 11px)' }}>
            {cur == null ? '当前状态 —' : `当前状态 ${cur}`}
          </span>
          <button data-fsm-close="" onClick={onClose}
            style={{ padding: '1px 8px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 3, background: 'transparent', color: 'var(--text, #333)' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '6px 12px',
          fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-secondary, #666)',
          borderBottom: '1px solid var(--border-subtle, #eee)', flexWrap: 'wrap' }}>
          <span>状态数 {input('states', String(states), (s) => setStates(Number(s) || 0), 1, 64)}</span>
          <span>初始 {input('init', String(init), (s) => setInit(Number(s) || 0), 0, states - 1)}</span>
          <span>输入位 {input('in', String(inBits), (s) => setInBits(Number(s) || 0), 1, 16)}</span>
          <span>输出位 {input('out', String(outBits), (s) => setOutBits(Number(s) || 0), 1, 16)}</span>
          <span style={{ flex: 1 }} />
          <button data-fsm-add="" onClick={() => setRows((rs) => [...rs, { state_in: 0, ctrl_in: '', state_out: 0, ctrl_out: '' }])}
            style={{ padding: '2px 8px', cursor: 'pointer', border: '1px solid var(--accent, #2563eb)',
              borderRadius: 3, background: 'transparent', color: 'var(--accent, #2563eb)', fontWeight: 600 }}>
            + 添加转移
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, padding: '4px 12px', fontSize: 'var(--fs-xs, 11px)',
            color: 'var(--text-muted, #888)', borderBottom: '1px solid var(--border-subtle, #eee)' }}>
            <span style={{ width: 76 }}>源状态</span><span style={{ width: 116 }}>输入条件(0/1/x)</span>
            <span style={{ width: 76 }}>目标状态</span><span style={{ width: 116 }}>输出值(0/1/x)</span><span />
          </div>
          {!rows.length && (
            <div style={{ padding: '10px 12px', fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-muted, #888)' }}>
              还没有转移：点「+ 添加转移」。空表时器件输出恒为 x。
            </div>
          )}
          {rows.map((r, i) => (
            <div key={i} data-fsm-row={i} style={{ display: 'flex', gap: 6, alignItems: 'center',
              padding: '3px 12px', borderBottom: '1px solid var(--border-subtle, #eee)' }}>
              <StateSelect dataKey="state_in" value={r.state_in} states={states}
                onChange={(v) => setRow(i, { state_in: v })} />
              <input data-fsm-bin="in" value={r.ctrl_in} placeholder={'1'.repeat(inBits)}
                onChange={(e) => setRow(i, { ctrl_in: e.target.value })}
                style={cellInput(inBits)} />
              <StateSelect dataKey="state_out" value={r.state_out} states={states}
                onChange={(v) => setRow(i, { state_out: v })} />
              <input data-fsm-bin="out" value={r.ctrl_out} placeholder={'0'.repeat(outBits)}
                onChange={(e) => setRow(i, { ctrl_out: e.target.value })}
                style={cellInput(outBits)} />
              <span style={{ flex: 1 }} />
              <button data-fsm-del={i} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
                style={{ padding: '1px 7px', cursor: 'pointer', border: '1px solid var(--border-subtle, #ccc)',
                  borderRadius: 3, background: 'transparent', color: 'var(--danger, #b91c1c)' }}>删</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
          borderTop: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-xs, 11px)' }}>
          <span style={{ color: err ? 'var(--danger, #b91c1c)' : 'var(--text-muted, #888)', flex: 1 }}>
            {err || `条件串按 ${inBits} / ${outBits} 位对齐；同一源状态里输入条件相同的两条转移只有一条会生效`}
          </span>
          <button data-fsm-cancel="" onClick={onClose}
            style={{ padding: '3px 12px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)', background: 'transparent', color: 'var(--text, #333)' }}>取消</button>
          <button data-fsm-apply="" onClick={apply}
            style={{ padding: '3px 14px', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 600 }}>应用（重建器件）</button>
        </div>
      </div>
    </div>
  );
}
