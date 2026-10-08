import { useState, useEffect, useCallback, useRef } from 'react';
import { settingsStore, type ViewMode } from '../store/settingsStore';

interface Props {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onClose: () => void;
}

type Tab = 'appearance' | 'sandbox' | 'shortcuts' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'sandbox', label: '沙盒' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'about', label: '关于' },
];

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'Delete / Backspace', desc: '删除选中的部件或连线' },
  { keys: 'Ctrl + A', desc: '全选部件' },
  { keys: 'Ctrl + C / Ctrl + X', desc: '复制 / 剪切选中部件' },
  { keys: 'Ctrl + V', desc: '粘贴' },
  { keys: 'Ctrl + D', desc: '创建副本' },
  { keys: 'Ctrl + Z / Ctrl + Shift + Z', desc: '撤销 / 重做' },
  { keys: 'Ctrl + R / Shift + Ctrl + R', desc: '顺时针 / 逆时针旋转 90°' },
  { keys: 'Ctrl + S', desc: '保存当前沙盒文件' },
  { keys: 'Shift + 点击 / Ctrl + 点击', desc: '加选 / 减选' },
  { keys: '空白拖拽', desc: '框选多个部件' },
  { keys: '右键拖拽', desc: '平移画布' },
  { keys: '右键单击', desc: '打开上下文菜单' },
  { keys: '滚轮 / Ctrl + 滚轮', desc: '平移 / 缩放' },
  { keys: 'Ctrl + 0', desc: '重置缩放与位置' },
  { keys: '方向键', desc: '微移选中部件（Shift 加速）' },
  { keys: 'F5', desc: '编译当前 Verilog' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '7px 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/** 受控数字输入（R102）：编辑期间用本地 draft，失焦/回车才提交并夹到 [min,max] */
function NumField({ label, value, min, max, onCommit }: {
  label: string; value: number; min: number; max: number; onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === '') { setDraft(String(value)); return; }
    onCommit(Math.round(n));
  };
  return (
    <input
      type="number"
      data-setting={label}
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 68, height: 26, padding: '0 6px', borderRadius: 4, textAlign: 'right',
        background: 'var(--surface)', color: 'var(--text)',
        border: '1px solid var(--border)', fontSize: 'var(--fs-sm)',
        // ⚠ R103：`type=number` 自带的上下 spinner 会把它挤歪，用户看到的「-/＋ 位置偏移」
        // 就是它造成的（旁边还有我们自己的 −/+ 按钮）。隐藏原生 spinner，三件控件同高对齐。
        appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
        margin: 0,
      }}
    />
  );
}

export default function SettingsPanel({ theme, onToggleTheme, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('appearance');
  const [fontSize, setFontSize] = useState(() => settingsStore.getFontSize());
  const [defaultView, setDefaultView] = useState<ViewMode>(() => settingsStore.getDefaultViewMode());
  const [sb, setSb] = useState(() => settingsStore.getSandboxSettings());
  const [, force] = useState(0);

  // R102：store 一变就把快照 state 一起刷新——否则走别的入口（快捷键 ±、localStorage
  // 恢复）改了字号，这里拿的还是旧快照，标题栏「当前 X px」也是旧的。
  useEffect(() => settingsStore.subscribe(() => {
    force((n) => n + 1);
    setFontSize(settingsStore.getFontSize());
    setDefaultView(settingsStore.getDefaultViewMode());
    setSb(settingsStore.getSandboxSettings());
  }), []);
  // Esc 关窗的回调要经 ref：父组件每次渲染都新建箭头函数，把它写进依赖表＝每渲染一次就
  // "摘掉旧的、挂上新的"一轮，按下那一刻挂没挂上是运气（本仓 r84 实测：事件到了 document 而弹窗没关）。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = useCallback((patch: Partial<typeof sb>) => {
    settingsStore.setSandboxSettings(patch);
    setSb(settingsStore.getSandboxSettings());
  }, [sb]);

  // R102：数字输入改**受控**——早前是 `defaultValue`（非受控），面板打开后即使 store
  // 变了（面板内的 ± 按钮、别的入口、甚至 localStorage 恢复值）显示也永远停在打开那刻
  // 的快照（用户报「字体大小始终显示 21」）。受控后 value 永远等于真实值。
  const numInput = (label: string, value: number, onCommit: (n: number) => void, min: number, max: number) => (
    <NumField key={label} label={label} value={value} min={min} max={max}
      onCommit={(n) => onCommit(Math.min(max, Math.max(min, n)))} />
  );

  const toggle = (on: boolean, onChange: (v: boolean) => void) => (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 46, height: 24, borderRadius: 12, border: '1px solid var(--border)',
        background: on ? 'var(--accent)' : 'var(--surface)', cursor: 'pointer', position: 'relative',
      }}
      title={on ? '已开启' : '已关闭'}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 24 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
      }} />
    </button>
  );

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: 620, maxWidth: '92vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column',
          background: 'var(--menu-bg)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>设置</span>
          <button onClick={onClose} title="关闭"
            style={{
              width: 24, height: 24, border: '1px solid var(--border)', borderRadius: 4,
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1,
            }}>×</button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Tabs */}
          <div style={{ width: 120, borderRight: '1px solid var(--border)', padding: '8px 6px', flexShrink: 0 }}>
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', marginBottom: 2,
                  border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 'var(--fs-sm)',
                  background: tab === t.id ? 'var(--surface-hover)' : 'transparent',
                  color: tab === t.id ? 'var(--text)' : 'var(--text-secondary)',
                }}>{t.label}</button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: '12px 16px', overflowY: 'auto', minWidth: 0 }}>
            {tab === 'appearance' && (
              <>
                <Row label="主题" hint="深色 / 浅色界面">
                  <button onClick={onToggleTheme}
                    style={{
                      padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 'var(--fs-sm)',
                      background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
                    }}>
                    {theme === 'dark' ? '切换到浅色' : '切换到深色'}
                  </button>
                </Row>
                <Row label="界面字体大小" hint={`当前 ${fontSize}px（8–36）`}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => { settingsStore.decreaseFontSize(); setFontSize(settingsStore.getFontSize()); }}
                      style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, borderRadius: 4, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>−</button>
                    {numInput('界面字体大小', fontSize, (n) => { settingsStore.setFontSize(n); setFontSize(n); }, 8, 36)}
                    <button onClick={() => { settingsStore.increaseFontSize(); setFontSize(settingsStore.getFontSize()); }}
                      style={{ width: 26, height: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, borderRadius: 4, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>+</button>
                  </div>
                </Row>
                <Row label="默认视图" hint="启动后进入的视图">
                  <select value={defaultView}
                    onChange={(e) => { const v = e.target.value as ViewMode; settingsStore.setDefaultViewMode(v); setDefaultView(v); }}
                    style={{
                      padding: '4px 8px', borderRadius: 4, background: 'var(--surface)',
                      color: 'var(--text)', border: '1px solid var(--border)', fontSize: 'var(--fs-sm)',
                    }}>
                    <option value="circuit">电路图</option>
                    <option value="code">代码</option>
                    <option value="split">分屏</option>
                  </select>
                </Row>
                <Row label="连线走线" hint="编译模式与沙盒共用；改完已画的线路立刻重排">
                  <select data-wire-style=""
                    value={sb.wireStyle}
                    onChange={(e) => update({ wireStyle: e.target.value as any })}
                    style={{
                      padding: '4px 8px', borderRadius: 4, background: 'var(--surface)',
                      color: 'var(--text)', border: '1px solid var(--border)', fontSize: 'var(--fs-sm)',
                    }}>
                    <option value="metro">正交折线</option>
                    <option value="orthogonal">直角</option>
                    <option value="straight">直线</option>
                  </select>
                </Row>
              </>
            )}

            {tab === 'sandbox' && (
              <>
                <Row label="显示网格" hint="关闭后画布为纯色">
                  {toggle(sb.showGrid, (v) => update({ showGrid: v }))}
                </Row>
                <Row label="吸附到网格" hint="拖动部件时自动对齐网格">
                  {toggle(sb.snapToGrid, (v) => update({ snapToGrid: v }))}
                </Row>
                <Row label="网格间距" hint={`当前 ${sb.gridSize}px（4–64）`}>
                  {numInput('网格间距', sb.gridSize, (n) => update({ gridSize: n }), 4, 64)}
                </Row>
                <Row label="默认位宽" hint={`新建 IO 部件的位数（1–32）`}>
                  {numInput('默认位宽', sb.defaultBits, (n) => update({ defaultBits: n }), 1, 32)}
                </Row>
                <Row label="打开时自动运行仿真" hint="关闭后需手动点“运行”">
                  {toggle(sb.autoStartSim, (v) => update({ autoStartSim: v }))}
                </Row>
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => { settingsStore.resetSandboxSettings(); setSb(settingsStore.getSandboxSettings()); }}
                    style={{
                      padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 'var(--fs-sm)',
                      background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
                    }}>恢复沙盒默认设置</button>
                </div>
              </>
            )}

            {tab === 'shortcuts' && (
              <div style={{ fontSize: 'var(--fs-sm)' }}>
                {SHORTCUTS.map((s) => (
                  <div key={s.keys} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 16,
                    padding: '5px 0', borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{s.desc}</span>
                    <span style={{
                      color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 'var(--fs-xs)',
                      background: 'var(--surface)', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                    }}>{s.keys}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'about' && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Verilog Visualizer</div>
                <div>· 代码区：Verilog 编辑、编译、综合</div>
                <div>· 电路区：由 Yosys 生成的门级电路可视化</div>
                <div>· 沙盒：基于 digitaljs 的可交互数字电路实验台</div>
                <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  设置保存在浏览器本地（localStorage）。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
