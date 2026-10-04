// 自定义门 / 子模块「内部电路」查看弹窗（只读，支持递归钻取）。
//
// R35：渲染管线与编译模式钻取（App.buildViewJson → Circuit.displayOn）完全
// 同源 —— subcircuitGraph 反向转换为 circuit JSON 后经 io_ui /
// normalizeIoLabels / renameAutoCells / new Circuit({elkjs}) 渲染。
//
// R35b 修复（用户报告「展开图加载卡顿且无内容」）：
//  - 卡顿：elk 自动布局是主线程同步计算。弹窗先渲染骨架（「正在布局…」占位）
//    再跑管线，点击立即有反馈；默认值改由 shouldAutoLayout 判定。
//  - 无内容：坏连线曾让 new Circuit 抛 TypeError → 弹窗永久白屏；已降级容错。
//
// R37（用户方案落地）：门定义迁移进沙盒文件系统后，展开图主路径改为
// 按 celltype 解析门定义文件 → 编译格式 circuit JSON 直接渲染
// （resolveDefCircuit 合并依赖定义 → renderCircuitView），零反向转换。
// 内嵌快照只剩旧档兜底路径。
//
// R38（用户自检「子部件无法打开」）：
//  - 旧版弹窗 setInteractivity(false)，digitaljs 的 open:subcircuit 钻取事件
//    不触发 → 子部件里的子部件（子部件的子部件）点不开。现在改用几何命中
//    （监听 mount 点击，命中某 Subcircuit 的放大镜 a.zoom 即下钻），不依赖
//    digitaljs 交互态，且不需要开启编辑态 —— 看图仍然只读，但可逐层钻取。
//  - 钻取用 breadcrumb 栈（def 名 / inline cells 两种形态），与编译模式逐层
//    钻入子模块体验一致；点面包屑可跳回任一层。
//
// React StrictMode 双挂载坑：joint 的 paper.remove() 会把传入的 el 从 DOM
// 摘掉，第一次卸载后 host 已脱离文档 —— 所以 host 内部再套一层 mount 节点。

import { useEffect, useRef, useState } from 'react';
import { renderSubcircuitView, shouldAutoLayout, type SubcircuitViewHandle } from '../lib/subcircuitView';
import { resolveDefCells } from '../lib/gateSystem';
import { serializeGraphCells } from '../lib/sandboxSerialize';

type StackEntry = { kind: 'def'; name: string } | { kind: 'inline'; cells: any };

export default function SandboxExpandModal({ cell, theme, scope = '', onClose }: {
  cell: any; theme: 'dark' | 'light'; scope?: string; onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gateName = String(cell?.get?.('celltype') || '');
  const initialInline = (() => { try { return cell.get('subcircuitGraph'); } catch { return null; } })();

  // 钻取栈：栈底是 cell 本身（按 celltype 解析部件文件，或旧档内嵌快照），
  // 钻入的子部件压栈。两种形态覆盖 R39 绑定式与旧档内嵌式。
  const [stack, setStack] = useState<StackEntry[]>(() => {
    if (gateName) return [{ kind: 'def', name: gateName }];
    if (initialInline?.cells?.length) return [{ kind: 'inline', cells: initialInline }];
    return [];
  });
  const top = stack[stack.length - 1];

  // 默认布局策略：快照自带位置（编译产物/复制电路）保留原位零开销；
  // 手绘图（位置缺失）自动整理。挂载时按栈底内容判定一次。
  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try {
      if (gateName) { const c = resolveDefCells(gateName, scope); if (c) return shouldAutoLayout(c); }
      return shouldAutoLayout(initialInline?.cells?.length ? initialInline : null);
    } catch { return true; }
  });
  const [rendering, setRendering] = useState(true);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [skippedDevs, setSkippedDevs] = useState(0);
  const [source, setSource] = useState<'def' | 'inline'>('def');

  // 下钻到某个 Subcircuit：优先按 celltype 解析部件文件（R39 绑定式），
  // 否则回退到该实例的内嵌子图（旧档内嵌式）。
  const drillInto = (subCell: any) => {
    const name = String(subCell.get?.('celltype') || '');
    if (name && resolveDefCells(name, scope)) { setStack(s => [...s, { kind: 'def', name }]); return; }
    const g = subCell.get?.('graph');
    if (g?.getCells?.()?.length) {
      try { setStack(s => [...s, { kind: 'inline', cells: serializeGraphCells(g) }]); return; } catch {}
    }
    // 既无绑定定义也无内嵌子图 —— 该子部件是空壳
    setFailMsg('该子部件没有可渲染的内部电路（定义已删除或内嵌快照缺失）');
  };

  useEffect(() => {
    const host = hostRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!host || !digitaljs) return;
    let handle: SubcircuitViewHandle | null = null;
    let curHandle: SubcircuitViewHandle | null = null;
    let disposed = false;
    let timer = 0;
    let mountEl: HTMLElement | null = null;
    let clickHandler: ((ev: MouseEvent) => void) | null = null;
    setRendering(true);
    setFailMsg(null);
    // 先让弹窗骨架上屏（下一帧），再跑同步布局管线 —— 大图 elk 秒级阻塞
    // 期间用户看到的是「正在布局…」而不是冻结的空白
    timer = window.setTimeout(() => {
      if (disposed) return;
      host.innerHTML = '';
      const mount = document.createElement('div');
      mount.style.position = 'absolute';
      mount.style.inset = '0';
      mount.style.background = theme === 'dark' ? '#151a1f' : '#ffffff';
      host.appendChild(mount);
      mountEl = mount;
      try {
        // 渲染栈顶：def 名 → 解析部件文件（自足 cells）→ 反向转换走编译渲染管线；
        // inline → 旧档内嵌快照同样走该管线（兜底）
        if (top?.kind === 'def') {
          const defCells = resolveDefCells(top.name, scope);
          if (defCells) { setSource('def'); handle = renderSubcircuitView(digitaljs, mount, defCells, { autoLayout }); }
          else { setSource('inline'); setFailMsg(`部件定义「${top.name}」不存在或已删除`); }
        } else if (top?.kind === 'inline') {
          setSource('inline');
          handle = renderSubcircuitView(digitaljs, mount, top.cells, { autoLayout });
        }
        if (!handle) { setRendering(false); return; }
        curHandle = handle;
        setSkipped(handle.skippedWires);
        setSkippedDevs(handle.skippedDevices ?? 0);
        handle.paper.setInteractivity(false);
        // R38：几何命中放大镜 → 下钻，不依赖 digitaljs 交互态（弹窗保持只读）
        clickHandler = (ev: MouseEvent) => {
          const ip = curHandle?.paper; if (!ip) return;
          const subs = ip.model.getCells().filter((c: any) => c.get('type') === 'Subcircuit');
          for (const c of subs) {
            const v = c.findView(ip);
            const za = v?.el?.querySelector?.('a.zoom');
            if (!za) continue;
            const r = za.getBoundingClientRect();
            if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
              drillInto(c);
              return;
            }
          }
        };
        // 捕获阶段监听：joint 的 paper 会在冒泡阶段 stopPropagation，
        // 普通冒泡监听收不到；捕获阶段在 paper 处理之前命中，且保持弹窗只读。
        mount.addEventListener('click', clickHandler, true);
        // render:done（elk 布局 + fitToContent）后在弹窗视口内缩放适配
        let fitCount = 0;
        handle.paper.on('render:done', () => {
          if (fitCount++ < 5) {
            requestAnimationFrame(() => {
              try {
                handle!.paper.setDimensions(host.clientWidth || 720, host.clientHeight || 420);
                handle!.paper.scaleContentToFit({ padding: 24, maxScale: 1.6, minScale: 0.3 });
              } catch { /* ignore */ }
            });
          }
        });
        requestAnimationFrame(() => {
          try {
            handle!.paper.setDimensions(host.clientWidth || 720, host.clientHeight || 420);
            handle!.paper.scaleContentToFit({ padding: 24, maxScale: 1.6, minScale: 0.3 });
          } catch { /* ignore */ }
        });
      } catch (e) {
        console.warn('[内部电路] 渲染失败:', e);
        setFailMsg(String((e as Error)?.message || e));
      }
      (window as any).__innerPaper = handle?.paper;
      setRendering(false);
    }, 30);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (mountEl && clickHandler) { try { mountEl.removeEventListener('click', clickHandler, true); } catch { /* ignore */ } }
      try { handle?.circuit.shutdown(); } catch { /* ignore */ }
      try { handle?.paper.remove(); } catch { /* ignore */ }
      // 测试钩子随弹窗销毁，避免读到旧实例
      try { delete (window as any).__innerPaper; } catch { /* ignore */ }
    };
  }, [stack, theme, autoLayout, scope]);

  const crumbLabel = (s: StackEntry) => (s.kind === 'def' ? s.name : '内嵌子电路');

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}>
      <div style={{ width: '80%', height: '78%', display: 'flex', flexDirection: 'column',
        background: 'var(--menu-bg)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 600, display: 'flex',
            alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            内部电路：
            {stack.map((s, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
                <button onClick={() => setStack(stack.slice(0, i + 1))}
                  title="返回该层"
                  style={{ background: i === stack.length - 1 ? 'var(--accent)' : 'transparent',
                    color: i === stack.length - 1 ? '#fff' : 'var(--text)',
                    border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer',
                    fontSize: 'var(--fs-xs)', padding: '1px 6px' }}>
                  {crumbLabel(s)}
                </button>
              </span>
            ))}
            {stack.length > 1 && (
              <button onClick={() => setStack(stack.slice(0, 1))} title="回到最外层"
                style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 4,
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '1px 5px' }}>
                ⤒ 顶层
              </button>
            )}
          </span>
          <button onClick={onClose} title="关闭"
            style={{ width: 24, height: 24, border: '1px solid var(--border)', borderRadius: 4,
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: 8, position: 'relative' }}>
          <div ref={hostRef} data-inner-host="" style={{ width: '100%', height: '100%', position: 'relative' }} />
          {rendering && !failMsg && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 8, pointerEvents: 'none',
              fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)',
                borderTopColor: 'var(--text-secondary)', display: 'inline-block',
                animation: 'spin 0.8s linear infinite' }} />
              正在布局…
            </div>
          )}
          {failMsg && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>
              <span>{failMsg.includes('渲染失败') ? failMsg : `内部电路渲染失败：${failMsg}`}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                电路数据可能已损坏；可尝试重新放置该部件。
              </span>
            </div>
          )}
        </div>
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {skipped > 0 ? `⚠ ${skipped} 条连线无法还原（端口不匹配已跳过） · ` : ''}
            {skippedDevs > 0 ? `⚠ ${skippedDevs} 个器件无法识别已跳过 · ` : ''}
            {skipped === 0 && skippedDevs === 0 ? '完整还原 · ' : ''}
            {source === 'def' ? '绑定门定义渲染 · 与编译模式钻取同一管线' : '旧档内嵌快照渲染（定义缺失兜底）'}
            {stack.length > 1 ? ' · 已钻取子部件' : ''}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={autoLayout}
              onChange={(e) => setAutoLayout(e.target.checked)} />
            自动整理布局
          </label>
        </div>
      </div>
    </div>
  );
}
