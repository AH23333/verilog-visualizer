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
import {
  renderSubcircuitView, renderCircuitView, shouldAutoLayout, shouldAutoLayoutCircuit,
  type SubcircuitViewHandle,
} from '../lib/subcircuitView';
import { resolveDefCells } from '../lib/gateSystem';
import { serializeGraphCells } from '../lib/sandboxSerialize';

type StackEntry =
  | { kind: 'def'; name: string }
  | { kind: 'inline'; cells: any }
  | { kind: 'circuit'; name: string; circuit: any };

export default function SandboxExpandModal({ cell, theme, scope = '', initialCircuit, initialName = '', onClose }: {
  cell: any; theme: 'dark' | 'light'; scope?: string;
  /** 编译模式传入：子模块的编译格式电路体（自带 subcircuits，可继续钻取）。 */
  initialCircuit?: any; initialName?: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const styleElRef = useRef<HTMLStyleElement | null>(null);
  /** 当前渲染出来的 paper：放大/缩小/适应按钮直接操作它（与 ctrl+滚轮同一套变换） */
  const paperRef = useRef<any>(null);
  const gateName = String(cell?.get?.('celltype') || '');
  const initialInline = (() => { try { return cell.get('subcircuitGraph'); } catch { return null; } })();

  // 钻取栈：栈底是初始对象，钻入的子部件压栈。
  //  - circuit：编译模式（编译格式电路体，钻取走自带 subcircuits）
  //  - def：沙盒部件文件（cells，按名绑定）
  //  - inline：旧档内嵌快照（兜底）
  const [stack, setStack] = useState<StackEntry[]>(() => {
    if (initialCircuit?.devices) return [{ kind: 'circuit', name: initialName || '子部件', circuit: initialCircuit }];
    if (gateName) return [{ kind: 'def', name: gateName }];
    if (initialInline?.cells?.length) return [{ kind: 'inline', cells: initialInline }];
    return [];
  });
  const top = stack[stack.length - 1];

  // 默认布局策略：快照自带位置（编译产物/复制电路）保留原位零开销；
  // 手绘图（位置缺失）自动整理。挂载时按栈底内容判定一次。
  const [autoLayout, setAutoLayout] = useState<boolean>(() => {
    try {
      if (initialCircuit?.devices) return shouldAutoLayoutCircuit(initialCircuit);
      if (gateName) { const c = resolveDefCells(gateName, scope); if (c) return shouldAutoLayout(c); }
      return shouldAutoLayout(initialInline?.cells?.length ? initialInline : null);
    } catch { return true; }
  });
  const [rendering, setRendering] = useState(true);
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [skippedDevs, setSkippedDevs] = useState(0);
  const [source, setSource] = useState<'def' | 'inline'>('def');

  // 下钻到某个 Subcircuit。按当前栈顶形态依次尝试：
  //  1) 编译模式：栈顶 circuit 自带 subcircuits[name] → 直接压栈（自足层级）；
  //  2) 沙盒：按 celltype 解析部件文件（绑定式）；
  //  3) 兜底：该实例的内嵌子图（旧档内嵌式）。
  const drillInto = (subCell: any) => {
    const name = String(subCell.get?.('celltype') || '');
    if (name && top?.kind === 'circuit') {
      const body = top.circuit?.subcircuits?.[name];
      if (body?.devices) {
        // 子模块体自带的 subcircuits 是空的（digitaljs 沿用父层那张平铺表），
        // 钻取时必须把同一张表带下去，否则再往下一层就查不到定义。
        setStack(s => [...s, { kind: 'circuit', name, circuit: { devices: body.devices, connectors: body.connectors ?? [], subcircuits: top.circuit?.subcircuits ?? {} } }]);
        return;
      }
    }
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
        // 渲染栈顶：circuit（编译格式，编译模式）→ renderCircuitView 直渲；
        // def（沙盒部件文件，自足 cells）→ 反向转换走同一编译渲染管线；
        // inline（旧档内嵌快照）→ 同一管线兜底
        if (top?.kind === 'circuit') {
          setSource('def');
          handle = renderCircuitView(digitaljs, mount, top.circuit, { autoLayout });
          if (!handle) setFailMsg(`部件「${top.name}」没有可渲染的器件`);
        } else if (top?.kind === 'def') {
          const defCells = resolveDefCells(top.name, scope);
          if (defCells) { setSource('def'); handle = renderSubcircuitView(digitaljs, mount, defCells, { autoLayout }); }
          else { setSource('inline'); setFailMsg(`部件定义「${top.name}」不存在或已删除`); }
        } else if (top?.kind === 'inline') {
          setSource('inline');
          handle = renderSubcircuitView(digitaljs, mount, top.cells, { autoLayout });
        }
        if (!handle) { setRendering(false); return; }
        curHandle = handle;
        paperRef.current = handle.paper;
        setSkipped(handle.skippedWires);
        setSkippedDevs(handle.skippedDevices ?? 0);
        // R40 只读化（用户要求：展开图不需要组件拖动和开关交互，只保留点击
        // 继续钻取）。digitaljs 的开关是 `click .btnface` 的 **jQuery 委托**
        // （cells/io.mjs），会绕过 joint 的 setInteractivity —— 所以除了
        // setInteractivity(false)，还要对 .btnface 单独断 pointer-events。
        // 不用整层 pointer-events:none：那会把子电路的放大镜 a.zoom 也一起
        // 打死，导致「点击继续钻取」失效。
        try { handle.paper.setInteractivity(false); } catch { /* ignore */ }
        try { handle.paper.fixed?.(true); } catch { /* ignore */ }
        try {
          for (const el of handle.paper.model.getElements()) {
            try { el.set('draggable', false); } catch { /* ignore */ }
            try { el.attr('interactive', false); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        // 屏蔽开关点击面（Button/Lamp/Clock 的 .btnface）
        // joint 重绘会重建 SVG 子元素并重置 inline style，所以不能只在渲染后
        // 改一次 —— 注入一条 scoped CSS 规则，由样式表持续约束，稳。
        if (!styleElRef.current) {
          const st = document.createElement('style');
          st.setAttribute('data-ro-part', '1');
          st.textContent = '[data-inner-host] .btnface{pointer-events:none !important}';
          document.head.appendChild(st);
          styleElRef.current = st;
        }
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
        // 适配到弹窗视口。digitaljs 的 elk 布局是**异步**写坐标的：displayOn 刚
        // 返回时内容包围盒还是半路的（实测 300ms 时 432×401 → 被按 maxScale 放大到
        // 3×，子部件的放大镜被推到视口外，用户看到的就是「一片空白/点不动」）。
        // 所以不能只适配一次 —— 轮询到包围盒稳定为止（有上限，最迟 ~1.2s）。
        let lastBox = '';
        let fitsLeft = 12;
        const fitNow = () => {
          const pw = handle!.paper;
          try {
            const bb = pw.getContentBBox();
            pw.setDimensions(host.clientWidth || 720, host.clientHeight || 420);
            pw.scaleContentToFit({ padding: 24, maxScale: 3, minScale: 0.05 });
            setZoomPct(Math.round((pw.scale().sx || 1) * 100));
            return `${Math.round(bb.x)},${Math.round(bb.y)},${Math.round(bb.width)},${Math.round(bb.height)}`;
          } catch { return lastBox; }
        };
        const settleFit = () => {
          if (disposed || fitsLeft-- <= 0) return;
          const box = fitNow();
          if (box && box === lastBox) return;      // 布局已稳定，收工
          lastBox = box;
          window.setTimeout(settleFit, 100);
        };
        requestAnimationFrame(settleFit);
        let fitCount = 0;
        handle.paper.on('render:done', () => { if (fitCount++ < 5) requestAnimationFrame(settleFit); });
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
      paperRef.current = null;
      if (mountEl && clickHandler) { try { mountEl.removeEventListener('click', clickHandler, true); } catch { /* ignore */ } }
      try { handle?.circuit.shutdown(); } catch { /* ignore */ }
      try { handle?.paper.remove(); } catch { /* ignore */ }
      // 测试钩子随弹窗销毁，避免读到旧实例
      try { delete (window as any).__innerPaper; } catch { /* ignore */ }
    };
  }, [stack, theme, autoLayout, scope]);

  /** 以视口中心为锚点缩放（与 ctrl+滚轮同一变换式，按钮点一下就能放大看细节） */
  const zoomBy = (factor: number) => {
    const pw = paperRef.current; const host = hostRef.current;
    if (!pw || !host) return;
    // 复用 renderCircuitView 里那份量出来的锚点公式（joint 的 SVG 有 y 轴翻转，
    // 自己写变换式会把画面推走 —— 见 subcircuitView 的说明）
    const r = host.getBoundingClientRect();
    try {
      if (typeof pw.__zoomAtClient === 'function') pw.__zoomAtClient(r.left + r.width / 2, r.top + r.height / 2, factor);
      else { const cur = pw.scale().sx || 1; const ns = Math.max(0.05, Math.min(8, cur * factor)); pw.scale(ns, ns); }
      setZoomPct(Math.round((pw.scale().sx || 1) * 100));
    } catch { /* ignore */ }
  };
  const zoomFit = () => {
    const pw = paperRef.current; const host = hostRef.current;
    if (!pw || !host) return;
    try {
      pw.setDimensions(host.clientWidth, host.clientHeight);
      pw.scaleContentToFit({ padding: 24, maxScale: 8, minScale: 0.05 });
      setZoomPct(Math.round((pw.scale().sx || 1) * 100));
    } catch { /* ignore */ }
  };
  const zoomActual = () => {
    const pw = paperRef.current;
    if (!pw) return;
    try { pw.scale(1, 1); pw.translate(0, 0); setZoomPct(100); } catch { /* ignore */ }
  };

  const crumbLabel = (s: StackEntry) => (s.kind === 'inline' ? '内嵌子电路' : s.name);

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
          {/* 放大查看：按钮 + ctrl/⌘+滚轮（弹窗只读，不禁缩放平移） */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {([['−', () => zoomBy(1 / 1.25), '缩小'], ['+', () => zoomBy(1.25), '放大'],
              ['适应', zoomFit, '缩放到整张图可见'], ['1:1', zoomActual, '按实际大小显示']] as [string, () => void, string][])
              .map(([txt, fn, tip]) => (
              <button key={txt} data-xz={txt} onClick={fn} title={`${tip}（滚轮以光标为中心缩放，Shift+滚轮左右平移）`}
                style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 4,
                  color: 'var(--text)', cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '1px 7px', lineHeight: '16px' }}>
                {txt}
              </button>
            ))}
            {zoomPct != null && <span style={{ minWidth: 34, textAlign: 'right' }}>{zoomPct}%</span>}
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
