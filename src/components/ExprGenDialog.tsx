// 布尔表达式 → 电路图 生成对话框（借鉴 OpenCircuits ExprToCircuitPopup 的交互面）。
// ⚠ 字号/字重一律 inline style：本仓没有 Tailwind 引擎，text-[var(--fs-*)] 那类
//   arbitrary-value 类是死类（卷十七教训），只有布局 utility 类可用。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { expressionToCells, type ExprGenResult } from '../lib/exprToCircuit';

interface ExprGenDialogProps {
  onGenerate: (res: ExprGenResult, expr: string, asGate: string | null) => void;
  onCancel: () => void;
}

const EXAMPLES = ['a & b | c', '!(a & b) ^ c', 'A AND B OR NOT C', 's = a^b^cin; cout = (a&b)|(cin&(a^b))'];

export default function ExprGenDialog({ onGenerate, onCancel }: ExprGenDialogProps) {
  const [expr, setExpr] = useState('a & b | c');
  const [outName, setOutName] = useState('Y');
  const [gateMode, setGateMode] = useState(false);
  const [gateName, setGateName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 0); return () => clearTimeout(t); }, []);

  // 实时预览：语法一错就红字提示，对了显示拓扑摘要（上游是生成后才知道，本仓更进一步）
  const preview = useMemo(() => expressionToCells(expr, { outputName: outName.trim() || 'Y' }), [expr, outName]);
  const ok = !preview.error;
  const gateNameOk = !gateMode || /^[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff-]*$/.test(gateName.trim());
  const summary = ok
    ? `输入 ${(preview as ExprGenResult).vars.length} · 门 ${Object.values((preview as ExprGenResult).gateCounts).reduce((a, b) => a + b, 0)} · 输出 ${(preview as ExprGenResult).outputs.length}`
      + (((preview as ExprGenResult).shared || 0) > 0 ? ` · 共享 ${(preview as ExprGenResult).shared} 门` : '')
    : '';

  const submit = () => {
    if (!ok || !preview.cells || !gateNameOk) return;
    onGenerate(preview as ExprGenResult, expr.trim(), gateMode ? gateName.trim() : null);
  };

  const box: CSSProperties = {
    background: 'var(--input-bg)', color: 'var(--text)',
    border: `1px solid ${ok ? 'var(--input-border)' : 'var(--danger)'}`,
    borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 'var(--fs-md)',
    outline: 'none', width: '100%', fontFamily: 'var(--font-mono, Consolas, monospace)',
  };

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }} onClick={onCancel}>
      <div className="animate-fade-in w-[460px] max-w-[92vw] rounded-xl border shadow-2xl"
        style={{ background: 'var(--menu-bg)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="布尔表达式生成电路">
        <div className="px-5 pt-4 pb-2">
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text)' }}>布尔表达式 → 电路图</span>
        </div>
        <div className="px-5 pb-4 flex flex-col gap-2">
          <input
            ref={inputRef}
            value={expr}
            placeholder="如：a & b | !c"
            style={box}
            data-expr-input
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
          />
          <div className="flex items-center gap-2">
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', flexShrink: 0 }}>输出名</label>
            <input value={outName} onChange={(e) => setOutName(e.target.value)} data-expr-outname
              style={{ ...box, width: 72, padding: '3px 8px' }} disabled={ok && (preview as ExprGenResult).outputs.length > 1}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {ok && (preview as ExprGenResult).outputs.length > 1 ? '多输出语句自带名字：y = a&b; z = a|b' : '（成为 Output 端口名，导出 Verilog 同名）'}
            </span>
          </div>
          <div className="flex items-center gap-2" data-expr-gate-row>
            <label className="flex items-center gap-1.5" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={gateMode} data-expr-gatemode onChange={(e) => setGateMode(e.target.checked)} />
              直接存为部件
            </label>
            {gateMode && (
              <input value={gateName} onChange={(e) => setGateName(e.target.value)} placeholder="部件名，如 half_adder" data-expr-gatename
                style={{ ...box, flex: 1, padding: '3px 8px', borderColor: gateNameOk ? 'var(--input-border)' : 'var(--danger)' }} />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setExpr(ex)} data-expr-example={ex}
                className="cursor-pointer"
                style={{
                  fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 999,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, Consolas, monospace)',
                }}>{ex}</button>
            ))}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            支持 &amp;(与) |(或) ^(异或) !(非)，括号；多输出用分号（s = a^b^cin; cout = ...）；同型自动并多输入门，!(a&amp;b) 自动用与非门，公共子表达式共享一颗门
          </div>
          {ok
            ? <div data-expr-preview style={{ fontSize: 'var(--fs-sm)', color: 'var(--success, #22c55e)' }}>✓ {summary}</div>
            : <div data-expr-error style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{preview.error}</div>}
          {!gateNameOk && <div data-expr-gate-err style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>部件名需以字母/下划线/中文开头，仅含字母数字下划线中划线</div>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onCancel}
              style={{ padding: '0 14px', height: 28, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--fs-md)' }}>
              取消
            </button>
            <button onClick={submit} disabled={!ok || !gateNameOk} data-expr-go
              style={{ padding: '0 14px', height: 28, borderRadius: 'var(--radius-md)', border: 'none', background: ok && gateNameOk ? 'var(--accent)' : 'var(--surface-hover)', color: ok && gateNameOk ? '#fff' : 'var(--text-muted)', cursor: ok && gateNameOk ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-md)', fontWeight: 600 }}>
              {gateMode ? '存为部件并放置' : '生成到画布'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
