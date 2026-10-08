// 输入 / 输出面板（R101）—— 编译模式与沙盒模式**共用同一颗组件**，保证两处的
// 统计口径、刷新频率与交互完全一致。
//
//  · 输入（Button / Clock …）：实时列出画布上全部输入件，**可点击改变状态**；
//  · 输出（Lamp / 数码管 / 数值显示 …）：实时列出全部输出件，**只读**——用户不能
//    直接改输出（那是组合逻辑/时序逻辑的结果），只能看。
//
// 200ms 轮询（与旧 InputPanel 同频）：仿真一跑起来值就跟着变，不用手动刷新。
import { useState, useEffect, useCallback } from 'react';
import { Square, Clock, Eye, X } from 'lucide-react';

export interface IOItem {
  id: string; label: string; type: string; value: string;
  /** 位宽（多位输入要在面板里逐位可编辑，R102） */
  bits?: number;
}

/** 面板要的数据来源：宿主（编译画布 / 沙盒画布）各自实现，UI 不关心底层。 */
export interface IOHost {
  listInputs: () => IOItem[];
  listOutputs: () => IOItem[];
  toggleInput: (id: string) => void;
  /** 翻转某一位（多位输入用；宿主没实现时面板退回整条切换） */
  toggleInputBit?: (id: string, bit: number) => void;
}

interface Props {
  host: IOHost;
  open: boolean;
  onClose: () => void;
  /** 面板标题锚点（默认 Inputs，编译模式沿用旧文案，测试靠它定位） */
  inputsTitle?: string;
  outputsTitle?: string;
}

export default function IOPanel({ host, open, onClose, inputsTitle = 'Inputs', outputsTitle = 'Outputs' }: Props) {
  const [ins, setIns] = useState<IOItem[]>([]);
  const [outs, setOuts] = useState<IOItem[]>([]);

  const refresh = useCallback(() => {
    try {
      setIns(host.listInputs());
      setOuts(host.listOutputs());
    } catch { /* 画布正在重建，下一拍再来 */ }
  }, [host]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 200);
    return () => clearInterval(t);
  }, [open, refresh]);

  if (!open) return null;

  const row = (it: IOItem, interactive: boolean) => {
    // 位宽 > 1 的输入：把每一位渲染成可点的小方块（多位也要能在面板里实时编辑，R102）。
    // 约定：位序**左＝高位**（与 `String(vec)` 的书写序一致）；`bitIndex` 也从左数（0 = 最高位），
    // 这样"点第 k 个格子"与"翻转第 k 位"是同一件事，宿主那边不用再做一次取反。
    const bitCells = interactive && (it.bits ?? 1) > 1
      ? String(it.value).split('').map((b, k) => {
        const bitIndex = k;
        return (
          <span
            key={k}
            data-io-bit={`${it.id}:${bitIndex}`}
            onClick={(e) => { e.stopPropagation(); (host.toggleInputBit || host.toggleInput)(it.id, bitIndex); }}
            title={`翻转第 ${bitIndex} 位`}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 15, height: 15, marginLeft: 2, borderRadius: 2, cursor: 'pointer',
              fontSize: '0.5625rem', fontWeight: 700, lineHeight: 1,
              background: b === '1' ? 'var(--accent)' : 'var(--surface)',
              color: b === '1' ? '#fff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >{b === '1' ? '1' : '0'}</span>
        );
      })
      : null;
    return (
    <button
      key={it.id}
      data-io-row={it.id}
      data-io-kind={interactive ? 'input' : 'output'}
      onClick={() => { if (interactive) host.toggleInput(it.id); }}
      title={interactive ? (it.type === 'Clock' ? '点击切换时钟电平（0/1）' : '点击切换该输入的状态') : '输出值只读（由电路计算得出）'}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', marginBottom: 2,
        background: 'transparent', border: '1px solid transparent',
        borderRadius: 'var(--radius-sm)', cursor: interactive ? 'pointer' : 'default',
        color: 'var(--text)', textAlign: 'left', fontSize: 'var(--fs-sm)',
        opacity: interactive ? 1 : 0.9,
      }}
      onMouseEnter={(e) => { if (interactive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { if (interactive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {it.type === 'Clock'
        ? <Clock size={12} style={{ color: it.value === '1' ? 'var(--danger)' : 'var(--text-muted)', flexShrink: 0 }} />
        : interactive
          ? <Square size={12} style={{ color: it.value === '1' ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }} />
          : <Eye size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
      <span style={{ flex: 1, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
      {bitCells}
      {(!bitCells || it.type === 'Clock') && (
        <span style={{
          fontWeight: 700, fontSize: 'var(--fs-md)',
          color: it.value === '1' ? (interactive ? 'var(--danger)' : 'var(--success)') : 'var(--text-muted)',
        }}>{it.value}</span>
      )}
    </button>
    );
  };

  const section = (title: string, items: IOItem[], interactive: boolean, hint: string) => (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '2px 4px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
        <span>{items.length}</span>
      </div>
      {items.length === 0 && (
        <div style={{ padding: '6px 8px', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{hint}</div>
      )}
      {items.map((it) => row(it, interactive))}
    </div>
  );

  return (
    <div data-io-panel style={{
      width: 180, flexShrink: 0,
      borderLeft: '1px solid var(--border-subtle)',
      background: 'var(--bg-elevated)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          {inputsTitle}
        </span>
        <button onClick={onClose} className="icon-btn" data-io-close style={{ width: 18, height: 18, color: 'var(--text-muted)' }}>
          <X size={12} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {section(inputsTitle, ins, true, 'No inputs. 放一个输入引脚/时钟即可在此切换。')}
        {section(outputsTitle, outs, false, 'No outputs. 放一个灯/数码管/数值显示即可在此观察。')}
      </div>
    </div>
  );
}
