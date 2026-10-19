import { useEffect, useRef } from 'react';
import { t } from '../i18n';   // i18n：中文原文即键（I18N_DESIGN §二）
import type { CSSProperties } from 'react';

/**
 * 总线转换器「位宽方案」对话框：一条 N 位总线 ↔ 若干组（每组 1/2/4/8 位）。
 * 分线器 = 总线 → 多组（8 位拆成 8×1、4×2、2×4 都在这里选）；
 * 合线器 = 多组 → 总线。这是 1/2/4/8 位分线之间互转的入口。
 */
export default function BusWidthDialog({ mode, total, groupWidth, onTotal, onGroupWidth, onApply, onClose }: {
  mode: string; total: number; groupWidth: number;
  onTotal: (n: number) => void; onGroupWidth: (n: number) => void;
  onApply: () => void; onClose: () => void;
}) {
  // 同 BindingDialog：`inset:0` 的遮罩必须给 Esc 一条出路（自动化测试也靠它，不然点不到遮罩外的任何行）
  // 依赖表写 `[]` + ref，理由见 BindingDialog 里那段注释。
  const closeBusRef = useRef(onClose);
  closeBusRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeBusRef.current(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  const TOTALS = [1, 2, 4, 8, 16, 32];
  const widths = [1, 2, 4, 8].filter(w => total % w === 0);
  const n = Math.floor(total / Math.max(1, groupWidth));
  const btn = (active: boolean): CSSProperties => ({
    padding: '5px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer', borderRadius: 4,
    background: active ? 'var(--accent)' : 'var(--surface)',
    color: active ? 'var(--vscode-button-foreground, #fff)' : 'var(--text)',
    border: '1px solid var(--border-subtle)',
  });
  return (
    <div data-bus-width-dialog onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2200,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        padding: 18, minWidth: 340, boxShadow: '0 12px 32px var(--vscode-widget-shadow, rgba(0,0,0,.32))' }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
          {t('{mode}位宽方案', { mode: t(mode) })}
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          {mode === t('分线器') ? t('一条总线拆成若干组（每组可取 1/2/4/8 位）') : t('若干组合成一条总线')}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>{t('总线位宽')}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TOTALS.map(tw => (   // 参数⛔ 叫 t（遮蔽 i18n t——F3 清扫）
            <button key={tw} onClick={() => { onTotal(tw); if (tw % groupWidth !== 0) onGroupWidth(1); }} style={btn(tw === total)}>{t('{n} 位', { n: tw })}</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>{t('每组位宽')}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {widths.map(w => (
            <button key={w} onClick={() => onGroupWidth(w)} style={btn(w === groupWidth)}>{t('{n} 位 ×{count}', { n: w, count: Math.floor(total / w) })}</button>
          ))}
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 14,
          background: 'var(--surface-hover)', borderRadius: 6, padding: '6px 10px' }}>
          {t('结果：{n} 组 × {gw} 位 = {total} 位', { n, gw: groupWidth, total: n * groupWidth })}
          <span style={{ opacity: .8 }}>（端口 {mode === t('分线器') ? `out0…out${n - 1} / in` : `in0…in${n - 1} / out`}）</span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>{t('取消')}</button>
          <button onClick={onApply} style={{ padding: '6px 14px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--vscode-button-foreground, #fff)', border: 'none', borderRadius: 4 }}>{t('应用')}</button>
        </div>
      </div>
    </div>
  );
}
