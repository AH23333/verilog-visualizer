import { useEffect, useRef } from 'react';
import { ArrowRight, Check } from 'lucide-react';

/**
 * 沙盒子电路实例的「绑定...」对话框（R100 重写）—— 样式与编译模式 BindingDialog
 * **完全一致**：同一套令牌（rgba(0,0,0,.55)+blur 遮罩、--bg-elevated 面板、
 * --radius-xl、24px 28px 内边距、--shadow-lg、同款行布局与 取消/确定 按钮）。
 *
 * 交互保留「点行即换绑」（r44 gate 的 data-rebind-row 锚点依赖它），行样式改为
 * 编译模式 instantiated-module 行同款（绑定成功＝绿、未绑定＝橙）。
 * 换绑走 rebindSubcircuitCell 单一主人（重建实例并按端口接回连线）。
 *
 * Esc 经 ref：父组件每次渲染新建箭头函数，写进依赖表＝每渲染一次重挂一轮监听
 * （本仓 r84/r87 实测的关窗失效形状）。
 */

export interface RebindDialogPart {
  name: string;
  folder: string;
}

interface Props {
  cur: string;
  parts: RebindDialogPart[];
  onPick: (name: string) => void;
  onClose: () => void;
}

export function RebindDialog({ cur, parts, onPick, onClose }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div data-rebind-dialog="" onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', padding: '24px 28px',
          minWidth: 520, maxWidth: 680, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
        }}>
        {/* Header —— 与编译模式 BindingDialog 同结构 */}
        <div style={{ marginBottom: 16, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text)' }}>
            绑定子电路实例
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>
            {parts.length > 0
              ? `发现 ${parts.length} 个部件文件。点选一行即把实例换绑过去（重建并按端口接回连线）。`
              : '还没有部件文件：先「保存为部件」建一个。'}
          </p>
        </div>

        <div style={{ flex: 1, overflow: 'auto', marginBottom: 16, minHeight: 100 }}>
          <div style={{
            fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--warning)',
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            部件文件 ({parts.length})
          </div>
          {parts.map((p) => {
            const isCur = p.name === cur;
            return (
              <div key={p.name}
                data-rebind-row={p.name}
                onClick={() => onPick(p.name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px',
                  marginBottom: 4, borderRadius: 4, cursor: 'pointer',
                  background: isCur ? 'rgba(0, 200, 0, 0.05)' : 'rgba(255, 150, 0, 0.08)',
                  border: isCur ? '1px solid rgba(0, 200, 0, 0.15)' : '1px solid rgba(255, 150, 0, 0.2)',
                }}
                title={isCur ? `当前绑定：${p.name}` : `绑定到 ${p.name}`}>
                <code style={{
                  fontFamily: 'monospace', fontSize: 'var(--fs-lg)',
                  color: isCur ? 'var(--success)' : 'var(--warning)',
                  fontWeight: 600, minWidth: 100, flex: 1,
                }}>
                  {p.name}
                </code>
                {p.folder && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {p.folder}/
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}><ArrowRight size={14} /></span>
                {isCur ? (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)', whiteSpace: 'nowrap' }}>
                    <Check size={12} /> 当前绑定
                  </span>
                ) : (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    绑定
                  </span>
                )}
              </div>
            );
          })}
          {!parts.length && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-lg)' }}>
              没有可绑定的部件文件。
            </div>
          )}
        </div>

        {/* Buttons —— 与编译模式同款（取消＝描边、确定＝accent） */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose}
            data-rebind-close=""
            style={{
              padding: '6px 18px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 'var(--fs-md)',
              fontWeight: 500,
            }}>
            取消
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '6px 18px', border: 'none', borderRadius: 'var(--radius-md)',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: 'var(--fs-md)', fontWeight: 600,
            }}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
