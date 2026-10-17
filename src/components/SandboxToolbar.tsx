import { Undo2, Play, Pause, StepForward, RotateCcw, Redo2, RotateCw, Save, Cpu,
  FunctionSquare, Download, FileCode, Link2, SlidersHorizontal, AudioWaveform } from 'lucide-react';
import type { CSSProperties } from 'react';
import { settingsStore, type SandboxSettings } from '../store/settingsStore';
import type { SandboxFile } from '../store/sandboxStore';

interface Props {
  activeFile: SandboxFile | null;
  running: boolean;
  handlePlayPause: () => void;
  handleStep: () => void;
  handleReset: () => void;
  settings: SandboxSettings;
  waveOpen: boolean;
  setWaveOpen: React.Dispatch<React.SetStateAction<boolean>>;
  undo: () => void;
  canUndo: boolean;
  redo: () => void;
  canRedo: boolean;
  selCount: number;
  rotateSelection: (deg: number) => void;
  handleSave: () => void;
  savingGate: boolean;
  gateName: string;
  setGateName: (v: string) => void;
  handleSaveGate: () => void;
  setSavingGate: (v: boolean) => void;
  setGateError: (v: string | null) => void;
  setExprGenOpen: (v: boolean) => void;
  handleExportSvg: () => void;
  handleExportNetlist: () => void;
  handleExportDjs: (f: SandboxFile) => void;
  setFileBindingId: (v: string | null) => void;
  setIoOpen: React.Dispatch<React.SetStateAction<boolean>>;
  ioOpen: boolean;
}

function SandboxToolbar({
  activeFile, running, handlePlayPause, handleStep, handleReset, settings, waveOpen, setWaveOpen,
  undo, canUndo, redo, canRedo, selCount, rotateSelection, handleSave, savingGate, gateName,
  setGateName, handleSaveGate, setSavingGate, setGateError, setExprGenOpen, handleExportSvg,
  handleExportNetlist, handleExportDjs, setFileBindingId, setIoOpen, ioOpen,
}: Props) {
  const sm: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, pointerEvents: 'auto',
    padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)', color: 'var(--text)',
    fontSize: 'var(--fs-xs)', cursor: 'pointer', lineHeight: 1,
  };
  const dis: CSSProperties = { ...sm, opacity: 0.45, cursor: 'not-allowed' };
  return (
    <div data-sandbox-topbar style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
      padding: '6px 8px', background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div data-sandbox-debug-bar style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 10px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      }}>
        <button
          onClick={handlePlayPause}
          title="运行 / 暂停仿真"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
            background: running ? 'var(--surface-hover)' : 'var(--success)',
            color: running ? 'var(--text-secondary)' : 'var(--vscode-button-foreground, #fff)',
          }}
        >{running ? <><Pause size={13} /> 暂停</> : <><Play size={13} /> 运行</>}</button>
        <button
          onClick={handleStep}
          title="单步执行"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--vscode-button-foreground, #fff)',
            fontSize: 'var(--fs-xs)', fontWeight: 600,
          }}
        ><StepForward size={13} /> 单步</button>
        <button
          onClick={handleReset}
          title="复位仿真"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 9px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: 'transparent', color: 'var(--text)',
          }}
        ><RotateCcw size={13} /></button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
          速度
          {/* 5–200ms 量纲与编译模式一致（右滑更快）；滑条 min/max 是 r44[14]/r62 的锚点 */}
          <input
            type="range" min={5} max={200} step={5}
            value={205 - settings.simSpeedMs}
            onChange={(e) => settingsStore.setSandboxSettings({ simSpeedMs: 205 - Number(e.target.value) })}
            style={{ width: 90, accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <span style={{ minWidth: 46, color: 'var(--text)' }}>{settings.simSpeedMs} ms</span>
        </label>
        <button
          onClick={() => setWaveOpen(w => !w)}
          title="波形监视器：实时查看连线电平时序"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
            background: waveOpen ? 'var(--accent)' : 'transparent',
            color: waveOpen ? 'var(--vscode-button-foreground, #fff)' : 'var(--text)',
          }}
        ><AudioWaveform size={13} /> 波形</button>
      </div>
      <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" style={canUndo ? sm : dis}><Undo2 size={13} /></button>
      <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" style={canRedo ? sm : dis}><Redo2 size={13} /></button>
      <button onClick={() => rotateSelection(90)} disabled={!selCount} title="旋转 90° (Ctrl+R)" style={selCount ? sm : dis}><RotateCw size={13} /></button>
      <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
      <button onClick={handleSave} disabled={!activeFile} title="保存当前沙盒文件 (Ctrl+S)" style={activeFile ? sm : dis}><Save size={13} />保存</button>
      {savingGate ? (
        <>
          <input autoFocus value={gateName} onChange={(e) => setGateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGate(); if (e.key === 'Escape') { setSavingGate(false); setGateName(''); setGateError(null); } }}
            placeholder="自定义门名称"
            style={{ width: 110, padding: '3px 6px', fontSize: 'var(--fs-xs)', background: 'var(--surface)',
              color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 3 }} />
          <button onClick={handleSaveGate} title="确认保存为自定义门" style={sm}>确定</button>
          <button onClick={() => { setSavingGate(false); setGateName(''); setGateError(null); }} title="取消" style={sm}>×</button>
        </>
      ) : (
        <button onClick={() => setSavingGate(true)} disabled={!activeFile} title="将当前电路保存为自定义门" style={activeFile ? sm : dis}><Cpu size={13} />自定义门</button>
      )}
      <button onClick={() => setExprGenOpen(true)} disabled={!activeFile} title="输入布尔表达式自动生成电路图（a & b | !c）" style={activeFile ? sm : dis}><FunctionSquare size={13} />表达式生成</button>
      <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
      <button onClick={handleExportSvg} disabled={!activeFile} title="导出 SVG" style={activeFile ? sm : dis}><Download size={13} />SVG</button>
      <button onClick={handleExportNetlist} disabled={!activeFile} title="导出综合网表（.v）：门/触发器/常量转结构化网表代码" style={activeFile ? sm : dis}><FileCode size={13} />综合网表</button>
      <button onClick={() => activeFile && handleExportDjs(activeFile)} disabled={!activeFile} title="导出 JSON（.djs）：含引用的部件定义" style={activeFile ? sm : dis}><Download size={13} />JSON</button>
      <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
      {/* 部件绑定（R100）：doc 模式也显示——绑定写回伪 activeFile + doc.onBind
          （DocApp 会话 Map），部件候选走 gateSystem partFileSource（见对话框接线处） */}
      <button onClick={() => activeFile && setFileBindingId(activeFile.id)} data-sandbox-bindings disabled={!activeFile || activeFile.kind === 'gate'}
        title="部件绑定：给当前文件里的子电路实例选择部件定义文件"         style={activeFile && activeFile.kind !== 'gate' ? sm : dis}><Link2 size={13} />部件绑定</button>
      <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
      {/* 输入 / 输出统计与交互：与编译模式的「输入」面板同一颗组件（输出段只读） */}
      <button onClick={() => setIoOpen((v) => !v)} data-sandbox-io
        title="输入 / 输出面板：列出画布上全部输入（可点击切换）与输出（只读）"
        style={ioOpen ? { ...sm, borderColor: 'var(--accent)', color: 'var(--accent)' } : sm}>
        <SlidersHorizontal size={13} />输入 / 输出
      </button>
    </div>
  );
}

export default SandboxToolbar;
