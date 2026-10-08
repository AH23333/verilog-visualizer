import { useState, useMemo } from 'react';
import { ArrowRight, Check } from 'lucide-react';

/**
 * 沙盒「绑定...」文件级对话框（R100）—— 样式与编译模式 BindingDialog **完全一致**
 * （同一套主题令牌：--bg-elevated/--radius-xl/24px 28px 内边距/--shadow-lg、
 * 同样的「绑定名 → 部件文件」select 行布局、同款 取消/确定 按钮）。
 *
 * 数据：扫文件 graphJson 里 type==='Subcircuit' 的实例，聚合出绑定名（celltype）；
 * 每行一个下拉选部件文件。确认后写 file.partBindings（gateSystem 解析时最高优先），
 * 重新打开文件后生效 —— 与编译模式「绑定已保存，重新编译后生效」同语义。
 */

export interface FileBindingPart {
  id: string;
  name: string;
  folder: string;
}

interface Props {
  fileName: string;
  isPart: boolean;
  /** 绑定名（celltype）列表（含出现次数） */
  celltypes: { name: string; count: number }[];
  /** 可选部件文件 */
  parts: FileBindingPart[];
  /** 当前解析（自动打分）结果：绑定名 → 部件文件 id */
  autoMap: Record<string, string>;
  /** 已保存的显式绑定 */
  initial: Record<string, string>;
  onConfirm: (bindings: Record<string, string>) => void;
  onCancel: () => void;
}

export default function SandboxFileBindingDialog({
  fileName, isPart, celltypes, parts, autoMap, initial, onConfirm, onCancel,
}: Props) {
  const [bindings, setBindings] = useState<Record<string, string>>(() => {
    const ini: Record<string, string> = { ...(initial || {}) };
    for (const ct of celltypes) {
      if (!ini[ct.name] && autoMap[ct.name]) ini[ct.name] = autoMap[ct.name];
    }
    return ini;
  });

  const handleSelect = (name: string, fileId: string) => {
    setBindings((prev) => {
      if (fileId === '') {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: fileId };
    });
  };

  const boundCount = useMemo(
    () => celltypes.filter((ct) => bindings[ct.name]).length,
    [celltypes, bindings],
  );

  return (
    <div
      data-file-binding-dialog=""
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: '24px 28px',
          minWidth: 520,
          maxWidth: 680,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header —— 与编译模式 BindingDialog 同结构同令牌 */}
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text)' }}>
            部件绑定：{fileName}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>
            {celltypes.length > 0
              ? `发现 ${celltypes.length} 个绑定名（${celltypes.reduce((a, b) => a + b.count, 0)} 个实例）。为每个绑定名选择部件定义文件。`
              : '这张电路没有子电路实例，无需绑定。'}
          </p>
        </div>

        <div style={{ flex: 1, overflow: 'auto', marginBottom: 16, minHeight: 100 }}>
          {/* 本文件自身是部件时（对齐编译模式 Defined Modules 段） */}
          {isPart && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-muted)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                已定义部件 (1)
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '6px 8px', marginBottom: 4, borderRadius: 4, background: 'var(--input-bg)',
              }}>
                <code style={{
                  fontFamily: 'monospace', fontSize: 'var(--fs-lg)',
                  color: 'var(--success)', fontWeight: 600, minWidth: 100,
                }}>
                  {fileName.replace(/\.djs$/i, '')}
                </code>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-md)' }}>定义于</span>
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{fileName}</span>
              </div>
            </div>
          )}

          {celltypes.length > 0 && (
            <div>
              <div style={{
                fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--warning)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                实例的绑定名 ({celltypes.length})
              </div>
              {celltypes.map((ct) => {
                const boundFileId = bindings[ct.name];
                const boundPart = boundFileId ? parts.find((p) => p.id === boundFileId) : undefined;
                const autoName = parts.find((p) => p.id === autoMap[ct.name])?.name;
                return (
                  <div
                    key={ct.name}
                    data-binding-name={ct.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '6px 8px',
                      marginBottom: 4,
                      borderRadius: 4,
                      background: boundPart ? 'rgba(0, 200, 0, 0.05)' : 'rgba(255, 150, 0, 0.08)',
                      border: boundPart ? '1px solid rgba(0, 200, 0, 0.15)' : '1px solid rgba(255, 150, 0, 0.2)',
                    }}
                  >
                    <code style={{
                      fontFamily: 'monospace', fontSize: 'var(--fs-lg)',
                      color: boundPart ? 'var(--success)' : 'var(--warning)',
                      fontWeight: 600, minWidth: 100,
                    }}>
                      {ct.name}
                    </code>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      ×{ct.count}
                    </span>
                    <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}><ArrowRight size={14} /></span>
                    <select
                      value={boundFileId || ''}
                      onChange={(e) => handleSelect(ct.name, e.target.value)}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: 'var(--fs-md)',
                        background: 'var(--input-bg)',
                        color: 'var(--text)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                      }}
                    >
                      <option value="">
                        {autoName ? `自动：${autoName}` : '-- 选择部件文件 --'}
                      </option>
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.folder ? `（${p.folder}/）` : ''}
                        </option>
                      ))}
                    </select>
                    {boundPart && (
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)', whiteSpace: 'nowrap' }}>
                        <Check size={12} /> 已绑定
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {celltypes.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-lg)' }}>
              没有可绑定的子电路实例。
            </div>
          )}
        </div>

        {/* Buttons —— 与编译模式同款 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 18px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 'var(--fs-md)',
              fontWeight: 500,
            }}
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(bindings)}
            style={{
              padding: '6px 18px',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              background: 'var(--accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 'var(--fs-md)',
              fontWeight: 600,
            }}
          >
            确定{boundCount ? `（${boundCount}）` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
