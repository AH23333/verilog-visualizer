// 画布工具条 —— App.tsx L1245-1361 仿真控制组的残体（TabBar 退役后浮在画布上方）。
// 组成：运行/暂停合并按钮、单步、速度滑条、波形开关、输入面板开关、
// 「复制到沙盒」、「导出」下拉（SVG / 电路 JSON / 网表，落盘走 host.saveExportFile）。
// 样式照旧全部走 CSS 变量（与旧 TabBar leftSlot 同一套令牌）。
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, StepForward, AudioWaveform, SlidersHorizontal, Copy, Download, ChevronDown } from 'lucide-react';

const MIN_SPEED_MS = 5, MAX_SPEED_MS = 200;

interface Props {
  simPaused: boolean;
  speedMs: number;
  debugTick: number;
  onTogglePause: () => void;
  onStepOnce: () => void;
  onSpeedChange: (ms: number) => void;
  waveOpen: boolean;
  inputsOpen: boolean;
  onToggleWave: () => void;
  onToggleInputs: () => void;
  onCopyToSandbox: () => void;
  onExportSvg: () => void;
  onExportJson: () => void;
  onExportNetlist: () => void;
}

export default function CanvasToolbar({
  simPaused, speedMs, debugTick, onTogglePause, onStepOnce, onSpeedChange,
  waveOpen, inputsOpen, onToggleWave, onToggleInputs,
  onCopyToSandbox, onExportSvg, onExportJson, onExportNetlist,
}: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportBoxRef = useRef<HTMLDivElement>(null);

  // 点外部收起导出下拉
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportBoxRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  return (
    <div
      style={{
        position: 'absolute', top: 8, left: 8, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0,
        padding: '4px 10px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,0.18))',
      }}
      data-canvas-toolbar=""
    >
      {/* R103：运行/暂停合并——运行时显示「暂停」，暂停时显示「继续/运行」，单态按钮 */}
      <button
        onClick={onTogglePause}
        data-testid="sim-pause-toggle"
        title={simPaused ? '继续运行' : '暂停仿真（定格当前波形，R103）'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          background: simPaused ? 'var(--success)' : 'var(--vscode-button-secondaryBackground, var(--surface-hover))',
          color: simPaused ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-button-secondaryForeground, var(--text))',
          fontWeight: 600, fontSize: 'var(--fs-sm)',
        }}
      >{simPaused ? <><Play size={13} /> 运行</> : <><Pause size={13} /> 暂停</>}</button>
      <button
        onClick={onStepOnce}
        disabled={!simPaused}
        title={simPaused ? 'Step one delta-cycle (F7)' : 'Pause first to step'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)', cursor: simPaused ? 'pointer' : 'not-allowed',
          background: simPaused ? 'var(--vscode-button-background, var(--accent))' : 'transparent',
          color: simPaused ? 'var(--vscode-button-foreground, #fff)' : 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', fontWeight: 600,
          opacity: simPaused ? 1 : 0.4,
        }}
      ><StepForward size={13} /> 单步</button>
      {simPaused && debugTick > 0 && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', fontWeight: 600, padding: '0 4px' }}>
          tick={debugTick}
        </span>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
        速度
        {/* range value = "fastness": low ms = fast engine tick */}
        <input
          type="range" min={0} max={1} step={0.01}
          value={(MAX_SPEED_MS - speedMs) / (MAX_SPEED_MS - MIN_SPEED_MS)}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            onSpeedChange(Math.round(MAX_SPEED_MS - t * (MAX_SPEED_MS - MIN_SPEED_MS)));
          }}
          style={{ width: 90, accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <span style={{ minWidth: 46, color: 'var(--text)' }}>{speedMs} ms</span>
      </label>
      <button
        onClick={onToggleWave}
        data-testid="wave-toggle"
        title="切换命名信号的实时波形"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
          background: waveOpen ? 'var(--vscode-button-background, var(--accent))' : 'transparent',
          color: waveOpen ? 'var(--vscode-button-foreground, #fff)' : 'var(--text)',
        }}
      ><AudioWaveform size={13} /> 波形</button>
      <button
        onClick={onToggleInputs}
        title="切换输入开关面板"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
          background: inputsOpen ? 'var(--vscode-button-background, var(--accent))' : 'transparent',
          color: inputsOpen ? 'var(--vscode-button-foreground, #fff)' : 'var(--text)',
        }}
      ><SlidersHorizontal size={13} /> 输入</button>
      <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
      <button
        onClick={onCopyToSandbox}
        title="把当前电路落成工作区里的一颗新 .djs，进行自由二次编辑"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
          background: 'var(--surface)', color: 'var(--text)',
        }}
      ><Copy size={13} /> 复制到沙盒</button>
      <div ref={exportBoxRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setExportOpen((v) => !v)}
          data-tool="export"
          title="导出当前电路"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
            background: 'var(--surface)', color: 'var(--text)',
          }}
        ><Download size={13} /> 导出 <ChevronDown size={12} /></button>
        {exportOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
            minWidth: 160, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: 4, boxShadow: '0 6px 18px var(--vscode-widget-shadow, rgba(0,0,0,.28))',
          }}>
            {[
              { label: 'SVG 图片', action: onExportSvg },
              { label: '电路 JSON（.json）', action: onExportJson },
              { label: '综合网表（.v）', action: onExportNetlist },
            ].map((it) => (
              <button key={it.label} onClick={() => { setExportOpen(false); it.action(); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: 'transparent', color: 'var(--text)', fontSize: 'var(--fs-sm)',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >{it.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
