import { useEffect, useRef, useState } from 'react';

/**
 * 寄存器（D 触发器）端口／极性配置窗。
 *
 * 端口不是画出来的，是 digitaljs 按 `polarity` 里**键在不在**生成的
 * （cells/dff.mjs:42-70：`'clock' in polarity` 才加 clk 脚，`aload` 一次加 ain＋aload 两脚），
 * 所以"不要这个口"必须是**把这个键整个删掉**，留 `键: undefined` 等于仍然有这一脚。
 * 这里每次都用新对象重建 polarity，绝不在旧对象上改回 undefined。
 *
 * ⚠ 低有效要写成 `false`，不能写 `0`：引擎两边都认（`pol = v => polarity[k] ? 1 : -1`），
 *   但**字形只认严格 false** —— base.mjs:139 是 `port.polarity === false` 才加 overline，
 *   而 `0 === false` 为假 ⇒ 写 0 的"低有效复位脚"在画布上与高有效长得一模一样，
 *   看图上分不清就能把复位电路接反。上游 yosys2digitaljs 发的也是 true/false
 *   （core.ts:735-736 的 P/N），这里与它对齐。
 *
 * ⚠ set / clr 是**与数据同宽**的端口（dff.mjs:53/57 `bits: bits`），不是 1 位控制脚；
 *   1 位的只有 clk / en / arst / srst / aload。
 *
 * 全部改完必须重建器件：polarity / bits / initial / arst_value / srst_value / enable_srst /
 * no_data 都在 dff.mjs:118 的 `_unsupportedPropChanges` 名单里，事后 set 会被回滚且端口不重建。
 */

/** polarity 的一脚：portId 是 digitaljs 生成的端口名，wide 表示位宽跟随数据位宽 */
type Ctrl = {
  key: 'clock' | 'enable' | 'arst' | 'srst' | 'set' | 'clr' | 'aload';
  portId: string; wide?: boolean; valueKey?: 'arst_value' | 'srst_value';
  extraPortId?: string;
  name: string; desc: string;
};
const CONTROLS: Ctrl[] = [
  { key: 'clock', portId: 'clk', name: '时钟', desc: '边沿采样（不勾＝没有时钟，每次求值都把 D 直接送到 Q）' },
  { key: 'enable', portId: 'en', name: '使能', desc: '不满足电平时保持原值' },
  { key: 'arst', portId: 'arst', name: '异步复位', desc: '立即生效，不等边沿', valueKey: 'arst_value' },
  { key: 'srst', portId: 'srst', name: '同步复位', desc: '只在有效边沿生效', valueKey: 'srst_value' },
  { key: 'set', portId: 'set', name: '置位 S', desc: '与数据同宽的逐位置位', wide: true },
  { key: 'clr', portId: 'clr', name: '清零 R', desc: '与数据同宽的逐位清零', wide: true },
  { key: 'aload', portId: 'aload', name: '异步装载', desc: '有效时把 AD 端口的值直接送到 Q', extraPortId: 'ain' },
];

interface Props {
  cell: any;
  onApply: (patch: DffPatch) => void;
  onClose: () => void;
}

/** 交给 reconfigureCell 的整套构造期参数（缺省＝这一项不要了） */
export type DffPatch = {
  bits: number; initial: string; polarity: Record<string, boolean>;
  arst_value?: string; srst_value?: string; enable_srst?: boolean; no_data?: boolean;
};

const BIN = /^[01x]+$/i;

/** 当前这一脚的极性：键存在＝这一脚在；值 truthy＝高有效，false/0＝低有效 */
const hasKey = (pol: Record<string, any>, k: string) => k in (pol || {});
/**
 * ⚠ 键还不存在时默认**高有效**：这一脚是用户刚勾上的，下拉里留着上一次算出来的
 *   `!!undefined === false` 就等于"勾一个静默低有效的复位脚"—— 现场读数（r94 闸门首跑）
 *   真把 srst 配成了低有效，而用户只勾了「同步复位」那一个框。
 */
const isHigh = (pol: Record<string, any>, k: string) => (hasKey(pol, k) ? !!pol[k] : true);

export function DffPortsModal({ cell, onApply, onClose }: Props) {
  const pol0: Record<string, any> = cell.get('polarity') || {};
  const [bits, setBits] = useState(Math.max(1, Math.min(32, Number(cell.get('bits')) || 1)));
  const [initial, setInitial] = useState(String(cell.get('initial') ?? 'x'));
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONTROLS.map((c) => [c.key, hasKey(pol0, c.key)])));
  const [high, setHigh] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONTROLS.map((c) => [c.key, isHigh(pol0, c.key)])));
  const [arstValue, setArstValue] = useState(String(cell.get('arst_value') ?? ''));
  const [srstValue, setSrstValue] = useState(String(cell.get('srst_value') ?? ''));
  const [enableSrSt, setEnableSrSt] = useState(cell.get('enable_srst') === true);
  const [noData, setNoData] = useState(cell.get('no_data') === true);
  const [err, setErr] = useState('');

  // Esc 关窗的回调必须经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次
  // 就"摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const rowStyle = { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 12px',
    borderBottom: '1px solid var(--border-subtle, #eee)', fontSize: 'var(--fs-xs, 11px)' };
  const boxStyle = { padding: '1px 4px', fontSize: 'var(--fs-xs, 11px)',
    border: '1px solid var(--border, #ccc)', borderRadius: 3,
    background: 'var(--surface, #fff)', color: 'var(--text, #222)' };
  const valueInput = (v: string, set: (s: string) => void) => (
    <input value={v} placeholder={`如 ${'0'.repeat(bits)}`} style={{ ...boxStyle, width: 8 + 9 * Math.max(4, bits),
      fontFamily: 'ui-monospace, monospace' }} onChange={(e) => set(e.target.value.trim())} />
  );

  const bothEnSrst = on.enable && on.srst;

  const apply = () => {
    if (bits < 1 || bits > 32) { setErr('位宽必须 1–32'); return; }
    if (!BIN.test(initial) || initial.length > bits) { setErr(`输出初值只能是 0/1/x，且不长于 ${bits} 位`); return; }
    const polarity: Record<string, boolean> = {};
    for (const c of CONTROLS) if (on[c.key]) polarity[c.key] = high[c.key];
    const patch: DffPatch = { bits, initial, polarity };
    for (const c of CONTROLS) {
      if (!c.valueKey || !on[c.key]) continue;
      const v = c.valueKey === 'arst_value' ? arstValue : srstValue;
      if (v === '') continue;   // 留空＝交给 digitaljs 建器件时补全 0（dff.mjs:35-39）
      if (!BIN.test(v) || v.length > bits) {
        setErr(`${c.name}值只能是 0/1/x，且不长于 ${bits} 位`); return;
      }
      patch[c.valueKey] = v;
    }
    // enable_srst 只有"使能＋同步复位"同时存在时才有意义（dff.mjs:105 那一条分支）；
    // 其它组合下一律删键，免得留一颗没人读的开关骗后来的读档。
    if (bothEnSrst) patch.enable_srst = enableSrSt;
    if (noData) patch.no_data = true;
    onApply(patch);
  };

  return (
    <div data-dffports-modal="" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxHeight: '84vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface, #fff)', border: '1px solid var(--border, #ccc)',
          borderRadius: 'var(--radius-md, 8px)', boxShadow: '0 12px 40px rgba(0,0,0,.35)', color: 'var(--text, #222)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-sm, 12px)', fontWeight: 700 }}>
          <span>寄存器端口配置 — {String(cell.get('label') || cell.get('net') || cell.id).slice(0, 24)}</span>
          <span style={{ flex: 1 }} />
          <button data-dffports-close="" onClick={onClose}
            style={{ padding: '1px 8px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 3, background: 'transparent', color: 'var(--text, #333)' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px',
          fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-secondary, #666)',
          borderBottom: '1px solid var(--border-subtle, #eee)' }}>
          <span>位宽 <input data-dffports-f="bits" value={String(bits)} style={{ ...boxStyle, width: 44 }}
            onChange={(e) => setBits(Number(e.target.value) || 0)} /></span>
          <span>输出初值 <input data-dffports-f="initial" value={initial} placeholder="0 / x"
            style={{ ...boxStyle, width: 70, fontFamily: 'ui-monospace, monospace' }}
            onChange={(e) => setInitial(e.target.value.trim())} /></span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {CONTROLS.map((c) => (
            <div key={c.key} data-dffports-row={c.key} style={{ ...rowStyle, opacity: on[c.key] ? 1 : 0.75 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, width: 96, cursor: 'pointer' }} title={c.desc}>
                <input data-dffports-on={c.key} type="checkbox" checked={!!on[c.key]}
                  onChange={(e) => setOn((s) => ({ ...s, [c.key]: e.target.checked }))} />
                <span style={{ fontWeight: 600 }}>{c.name}</span>
              </label>
              <span style={{ color: 'var(--text-muted, #888)', width: 52 }}>端口 {c.portId}{c.extraPortId ? `＋${c.extraPortId}` : ''}</span>
              <select data-dffports-pol={c.key} value={high[c.key] ? '1' : '0'} disabled={!on[c.key]}
                style={{ ...boxStyle, opacity: on[c.key] ? 1 : 0.4 }}
                onChange={(e) => setHigh((s) => ({ ...s, [c.key]: e.target.value === '1' }))}>
                <option value="1">高有效 ↑</option>
                <option value="0">低有效 ↓（画上带横线）</option>
              </select>
              {c.wide ? <span style={{ color: 'var(--text-muted, #888)' }}>{bits} 位</span> : <span style={{ color: 'var(--text-muted, #888)' }}>1 位</span>}
              <span style={{ flex: 1 }} />
              {c.valueKey && on[c.key] && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary, #666)' }}>
                  {c.name}值
                  <span data-dffports-value={c.valueKey}>{valueInput(c.valueKey === 'arst_value' ? arstValue : srstValue,
                    c.valueKey === 'arst_value' ? setArstValue : setSrstValue)}</span>
                </label>
              )}
            </div>
          ))}

          <div data-dffports-row="enable_srst" style={{ ...rowStyle, opacity: bothEnSrst ? 1 : 0.5 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
              title="勾选＝使能无效时连同步复位也拦住（dff.mjs:105，$_SDFFCE_ 那一族就是这一种）；不勾＝同步复位只看有效边沿">
              <input data-dffports-enable-srst="" type="checkbox" checked={enableSrSt} disabled={!bothEnSrst}
                onChange={(e) => setEnableSrSt(e.target.checked)} />
              <span style={{ fontWeight: 600 }}>使能也管住同步复位</span>
            </label>
            <span style={{ color: 'var(--text-muted, #888)' }}>需要同时有时钟使能与同步复位</span>
          </div>

          <div data-dffports-row="no_data" style={rowStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
              title="去掉 D 端口：只剩置位／清零（$_SR_ 那一族），或不带时钟时当作纯延时线用">
              <input data-dffports-no-data="" type="checkbox" checked={noData}
                onChange={(e) => setNoData(e.target.checked)} />
              <span style={{ fontWeight: 600 }}>不要 D 端口（纯置位／复位锁存）</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
          borderTop: '1px solid var(--border-subtle, #ddd)', fontSize: 'var(--fs-xs, 11px)' }}>
          <span style={{ color: err ? 'var(--danger, #b91c1c)' : 'var(--text-muted, #888)', flex: 1 }}>
            {err || '改这些项都要重建器件；原有连线只在重建后仍有同名端口时才接回（关掉某一脚，它的连线会被丢弃）。'}
          </span>
          <button data-dffports-cancel="" onClick={onClose}
            style={{ padding: '3px 12px', cursor: 'pointer', border: '1px solid var(--border, #ccc)',
              borderRadius: 'var(--radius-sm, 4px)', background: 'transparent', color: 'var(--text, #333)' }}>取消</button>
          <button data-dffports-apply="" onClick={apply}
            style={{ padding: '3px 14px', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-sm, 4px)',
              background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 600 }}>应用（重建器件）</button>
        </div>
      </div>
    </div>
  );
}
