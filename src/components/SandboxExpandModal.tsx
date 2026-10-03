// 自定义门 / 子模块「内部电路」查看弹窗（只读）。
//
// R35：渲染管线与编译模式钻取（App.buildViewJson → Circuit.displayOn）完全
// 同源 —— subcircuitGraph 反向转换为 circuit JSON 后经 io_ui /
// normalizeIoLabels / renameAutoCells / new Circuit({elkjs}) 渲染。
//
// R35b 修复（用户报告「展开图加载卡顿且无内容」）：
//  - 卡顿：elk 自动布局是主线程同步计算（148 器件实测单长任务 2.3s）。
//    弹窗先渲染骨架（「正在布局…」占位）再跑管线，点击立即有反馈；
//    默认值改由 shouldAutoLayout 判定 —— 快照自带位置（编译产物/复制电路）
//    保留原位零开销，只有手绘图才自动整理。
//  - 无内容：一条坏连线曾让 new Circuit 抛 TypeError → 弹窗永久白屏；
//    renderSubcircuitView 已降级容错（剔线重建 + 逐条补线），这里再把
//    handle=null / 异常显式提示出来，并展示无法还原的连线数。
//
// R37（用户方案落地）：门定义迁移进沙盒文件系统后，展开图主路径改为
// **按 celltype 解析门定义文件 → 编译格式 circuit JSON 直接渲染**
// （resolveDefCircuit 合并依赖定义 → renderCircuitView），零反向转换 ——
// 与编译模式钻取在数据形态上完全一致。内嵌快照只剩旧档兜底路径。
//
// React StrictMode 双挂载坑：joint 的 paper.remove() 会把传入的 el 从 DOM
// 摘掉，第一次卸载后 host 已脱离文档 —— 所以 host 内部再套一层 mount 节点。

import { useEffect, useRef, useState } from 'react';
import { renderCircuitView, renderSubcircuitView, shouldAutoLayout, shouldAutoLayoutCircuit } from '../lib/subcircuitView';
import { resolveDefCircuit } from '../lib/gateSystem';
import { serializeGraphCells } from '../lib/sandboxSerialize';

export default function SandboxExpandModal({ cell, theme, onClose }: {
  cell: any; theme: 'dark' | 'light'; onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gateName = String(cell?.get?.('celltype') || '');
  // 渲染源：绑定门定义（编译格式，零转换）或旧档内嵌快照（反向转换兜底）
  const [source, setSource] = useState<'def' | 'inline'>('def');
  // 默认布局策略：快照自带位置 → 保留原位（跳过 elk，零卡顿）；
  // 手绘图（位置缺失）→ 自动整理。挂载时按内容判定一次。
  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try {
      const defJson = gateName ? resolveDefCircuit(gateName) : null;
      if (defJson) return shouldAutoLayoutCircuit(defJson);
      const j = cell.get('subcircuitGraph');
      return shouldAutoLayout(j?.cells?.length ? j : null);
    } catch { return true; }
  });
  const [rendering, setRendering] = useState(true);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [skippedDevs, setSkippedDevs] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!host || !digitaljs) return;
    let handle: ReturnType<typeof renderCircuitView> = null;
    let disposed = false;
    let timer = 0;
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
      try {
        // 主路径（R37）：celltype → 门定义文件（编译格式）→ 合并依赖定义 → 直渲
        const defJson = gateName ? resolveDefCircuit(gateName) : null;
        if (defJson) {
          setSource('def');
          handle = renderCircuitView(digitaljs, mount, defJson, { autoLayout });
        } else {
          // 兜底路径（旧档未迁移/定义被删）：内嵌快照反向转换渲染
          setSource('inline');
          let json = cell.get('subcircuitGraph');
          if (!json?.cells?.length && cell.get('graph')?.getCells) {
            try { json = serializeGraphCells(cell.get('graph')); } catch { /* ignore */ }
          }
          handle = renderSubcircuitView(digitaljs, mount, json, { autoLayout });
        }
        if (!handle) { setFailMsg('该电路没有可渲染的器件。'); return; }
        setSkipped(handle.skippedWires);
        setSkippedDevs(handle.skippedDevices ?? 0);
        handle.paper.setInteractivity(false);
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
      try { handle?.circuit.shutdown(); } catch { /* ignore */ }
      try { handle?.paper.remove(); } catch { /* ignore */ }
      // 测试钩子随弹窗销毁，避免读到旧实例
      try { delete (window as any).__innerPaper; } catch { /* ignore */ }
    };
  }, [cell, theme, autoLayout, gateName]);

  const name = gateName || cell.get('label') || '自定义门';
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}>
      <div style={{ width: '80%', height: '78%', display: 'flex', flexDirection: 'column',
        background: 'var(--menu-bg)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 600 }}>
            内部电路：{name}
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
              <span>内部电路渲染失败：{failMsg}</span>
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
