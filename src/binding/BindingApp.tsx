import { useCallback, useEffect, useRef, useState } from 'react';

export interface BindingInstance {
  name: string;
  count: number;
  auto: string | null;
  recorded: string | null;
}
export interface BindingData {
  docRel: string;
  docName: string;
  mode: 'djs' | 'verilog';
  instances: BindingInstance[];
  parts: string[];
  meta: string;
}

type Msg = any;

export default function BindingApp() {
  const bridge = useRef<any>(null);
  const [data, setData] = useState<BindingData | null>(null);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number>(0);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const getBridge = useCallback(() => {
    if (!bridge.current && typeof (window as any).acquireVsCodeApi === 'function') {
      try {
        bridge.current = (window as any).acquireVsCodeApi();
      } catch {
        /* noop */
      }
    }
    return bridge.current;
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent<Msg>) => {
      const d = ev.data as any;
      if (d?.vvh !== 'binding') return;
      if (d.op === 'data') {
        setData(d.data as BindingData);
        setSaveErrors([]);
        const initial: Record<string, string> = {};
        for (const it of (d.data as BindingData).instances) {
          initial[it.name] = it.recorded || it.auto || '';
        }
        setSel(initial);
      }
      if (d.op === 'saved') {
        setSavedAt(Date.now());
        setSaveErrors([]);
      }
      if (d.op === 'saveError') {
        setSaveErrors(Array.isArray(d.errors) ? d.errors.map(String) : [String(d.errors || '保存被拒绝')]);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const b = getBridge();
    if (b) {
      b.postMessage({ vvh: 'binding', op: 'ready' });
    }
  }, [getBridge]);

  const handleSelect = (name: string, val: string) => {
    setSel((prev) => ({ ...prev, [name]: val }));
  };

  const handleSave = () => {
    const changes: Record<string, string> = {};
    for (const it of data?.instances || []) {
      const v = sel[it.name] ?? '';
      const iv = it.recorded || it.auto || '';
      if (v !== iv) changes[it.name] = v;
    }
    const b = getBridge();
    if (b) b.postMessage({ vvh: 'binding', op: 'save', changes });
  };

  const handleOpenConfig = () => {
    const b = getBridge();
    if (b) b.postMessage({ vvh: 'binding', op: 'openConfig' });
  };

  const boundCount = (data?.instances || []).filter((it) => (sel[it.name] || '').trim()).length;

  return (
    <div style={{ fontFamily: 'var(--vscode-font-family, sans-serif)', padding: 16, color: 'var(--vscode-foreground, #ccc)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--fs-xl, 14px)' }}>部件绑定：{data?.docRel || ''}</h2>
      <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-md, 12px)', color: 'var(--text-secondary, #aaa)' }}>
        模式：{data?.mode === 'djs' ? '沙盒 .djs' : '编译 .v/.sv'} | {data?.meta ? `绑定配置：${data.meta}` : ''}
      </p>

      {(!data?.instances || data.instances.length === 0) ? (
        <p style={{ color: 'var(--text-muted, #888)' }}>这张文件没有可绑定的子模块/子电路实例。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data!.instances.map((it) => {
            const v = sel[it.name] || '';
            const partList = data.parts.slice();
            return (
              <div
                key={it.name}
                data-binding-name={it.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: 'color-mix(in srgb, var(--success, #4caf50) 5%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--border, #666) 30%, transparent)',
                }}
              >
                <code style={{ fontFamily: 'monospace', fontWeight: 600, minWidth: 100 }}>{it.name}</code>
                <span style={{ fontSize: '12px', color: 'var(--text-muted, #888)' }}>×{it.count}</span>
                <select
                  value={v}
                  onChange={(e) => handleSelect(it.name, e.target.value)}
                  style={{
                    flex: 1,
                    padding: '2px 4px',
                    background: 'var(--input-bg, #333)',
                    color: 'var(--text, #ddd)',
                    border: '1px solid var(--border, #666)',
                    borderRadius: 4,
                  }}
                >
                  <option value="">{v ? (it.auto === v ? '自动' : '清除（自动）') : '自动（无同名候选）'}</option>
                  {partList.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button
          onClick={handleOpenConfig}
          style={{
            padding: '4px 10px',
            border: '1px solid var(--border, #666)',
            borderRadius: 4,
            background: 'var(--surface, #222)',
            color: 'var(--text, #ddd)',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          打开绑定配置
        </button>
        <button
          onClick={handleSave}
          style={{
            padding: '4px 12px',
            border: 'none',
            borderRadius: 4,
            background: 'var(--accent, #4b8cff)',
            color: 'var(--vscode-button-foreground, #fff)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          保存{boundCount ? `（${boundCount}）` : ''}
        </button>
      </div>
      {savedAt > 0 && (
        <div style={{ marginTop: 8, fontSize: '12px', color: 'var(--success, #4caf50)' }}>已保存。</div>
      )}
      {saveErrors.length > 0 && (
        <div
          data-binding-save-errors
          style={{ marginTop: 8, padding: '6px 10px', border: '1px solid var(--danger, #e53935)', borderRadius: 4,
            background: 'color-mix(in srgb, var(--danger, #e53935) 8%, transparent)', fontSize: '12px' }}
        >
          <div style={{ fontWeight: 700, color: 'var(--danger, #e53935)', marginBottom: 4 }}>保存被拒（绑定目标校验未过，一条都没写）：</div>
          {saveErrors.map((e, i) => (
            <div key={i} style={{ color: 'var(--text-secondary, #aaa)' }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
