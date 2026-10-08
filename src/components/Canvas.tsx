import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { serializePaperJson } from '../lib/sandboxSerialize';
import { settingsStore } from '../store/settingsStore';
import { applyWireStyle } from '../lib/wireRouting';
import { setSimInterval } from '../lib/simClock';

/**
 * 取器件的输出信号向量。digitaljs 把 `outputSignals` 存在 **attributes** 上，
 * 直接读 `cell.outputSignals` 恒为 undefined —— 于是「单步」拨不动时钟、
 * 输入面板的切换按钮点下去 `if (!sig?._bvec) return` 直接返回（表现为「按了没反应」），
 * 面板列出的输入值也永远取不到。这里统一走属性访问器。
 */
const outSig = (cell: any) => {
  const o = (cell && (cell.get?.('outputSignals') || cell.outputSignals)) || {};
  return o.out ?? Object.values(o)[0];
};

/**
 * 写器件的输出电平。⚠ 不能手写 `_bvec[0]=0; _avec={}`：digitaljs 的 Vector3vl
 * 把 `_avec` 当**「已定义」掩码**用，`_avec={}` 表示 **x（未定）**而不是 0。
 * 实测后果两条：①「单步」把时钟拉成 x，触发器判不到 0→1 上升沿，时序电路
 * 按多少次单步都不走（表现为「按钮没反应」）；②这种半初始化向量连 `String()`
 * 都会抛（digitaljs 内部 toBin 读 undefined）。所以一律用现成向量的构造器
 * `fromBin` 造合法值（与 MemoryViewModal 同一取 ctor 的办法）。
 */
const setOutBit = (cell: any, one: boolean): boolean => {
  try {
    const o = (cell && (cell.get?.('outputSignals') || cell.outputSignals)) || {};
    const sig = o.out ?? Object.values(o)[0];
    const C = sig && sig.constructor;
    if (!C || typeof C.fromBin !== 'function') return false;
    const bits = Number(cell.get('bits')) || 1;
    const vec = C.fromBin(one ? '1'.repeat(bits) : '0'.repeat(bits), bits);
    cell.set('outputSignals', { ...o, out: vec });
    return true;
  } catch { return false; }
};

/** 读器件输出电平（'0' / '1' / 其它＝未定）；向量坏了也不炸。 */
const readOutBit = (cell: any): string => {
  try {
    const s = outSig(cell);
    return s == null ? 'x' : String(s).replace(/^Vector3vl\s+/, '');
  } catch { return 'x'; }
};

/**
 * 沉降：反复推进引擎队列直到当前时间片排空。
 * 一次 updateGatesNext() 只消费一个片，深层组合逻辑（乘法器/加法器树）一轮排不干净，
 * 表现为「走了一个时钟沿但输出一动不动」；这里与 SandboxCanvas 的 flushStaleQueue 同源，
 * 加上片数上限防止死循环。
 */
const settle = (circuit: any, maxSteps = 24) => {
  const eng = circuit?._engine || circuit;
  for (let i = 0; i < maxSteps; i++) {
    try {
      if (typeof eng.updateGatesNext !== 'function') { if (i === 0) circuit.updateGatesNext?.(); break; }
      const peek = eng._pq?.peek?.();
      if (peek != null && eng._tick != null && peek >= eng._tick) { if (i === 0) eng.updateGatesNext(); break; }
      eng.updateGatesNext();
    } catch { break; }
  }
};

export interface CanvasHandle {
  resetZoom: () => void;
  fitToWindow: () => void;
  /** 菜单「放大 / 缩小」：以视口中心为锚按 factor 缩放（与 Ctrl+滚轮同一份实现） */
  zoomBy: (factor: number) => void;
  /** Make the joint.js paper read-only (true) or interactive (false). Requires a rendered circuit. */
  setFixed: (fixed: boolean) => void;
  /** Pause (true) / resume (false) the digitaljs simulation engine. */
  setPaused: (paused: boolean) => void;
  /** Engine tick interval in ms (lower = faster). No-op when paused. */
  setSpeed: (intervalMs: number) => void;
  /** Resync sim state after the circuit was (re)built. */
  reapplySimState: () => void;
  /**
   * Glow every top-level cell/wire whose source_positions cover (srcPath, line).
   * Returns how many elements were highlighted (0 = nothing on this line in the
   * top view — could be inside a subcircuit).
   */
  highlightSource: (srcPath: string, line: number) => number;
  /** Remove all source-highlight glows. */
  clearSourceHighlight: () => void;
  /** Enumerate named nets (deduped) available for waveform display. */
  getWaveChannels: () => { name: string; bits: number }[];
  /** One waveform sample: engine tick + binary value string per named net. */
  getWaveSample: () => { tick: number; values: Record<string, string> } | null;
  /**
   * Single clock-edge advance (only meaningful while paused).
   * Forces every auto-created Clock cell through a 0→1 rising edge and
   * propagates gates, so one DFF clock edge advances the design by one tick.
   */
  stepOnce: () => void;
  /** Enumerate all interactive input cells (Button/Clock) for the side panel. */
  listInputs: () => { id: string; label: string; type: string; value: string; bits: number }[];
  /** Enumerate all output cells (Lamp/Display/…) — read-only in the side panel. */
  listOutputs: () => { id: string; label: string; type: string; value: string }[];
  /** 翻转某一位（bitIndex 0 = 最低位）——面板里多位输入逐位编辑用 */
  toggleInputBit: (id: string, bitIndex: number) => void;
  /** Toggle a Button/Clock input by cell id (flip its output and propagate). */
  toggleInput: (id: string) => void;
  /**
   * Hit-test a screen point against rendered cells. Returns the cell's sub-module
   * info so the caller (context menu) can offer "Enter submodule" when drillable.
   */
  probeCellAt: (clientX: number, clientY: number) => { celltype: string; label: string; drillable: boolean } | null;
  /**
   * Serialize the current paper into the sandbox cell-shape JSON string
   * (shared whitelist builder — plain data only, no Vector3vl / cyclic attrs).
   * Returns null when no paper exists. Used by「复制到沙盒」.
   */
  getGraphJson: () => string | null;
}

interface CanvasProps {
  circuitJson: Record<string, unknown>;
  theme: 'dark' | 'light';
  onError: (msg: string) => void;
  /** When true the paper is read-only — clicks/toggles on switches are blocked. */
  locked: boolean;
  /** Simulation paused (engine stopped) while mounted. */
  paused: boolean;
  /** Engine interval ms at (re)build time. */
  speedMs: number;
  /** Notifies App when the engine starts, or (synchronously at build) when a warning-gated design refused to start. */
  onRunningChange?: (running: boolean) => void;
  /** Double-click on a cell that carries source_positions → (synthesisPath, line, column) */
  onSourceJump?: (srcName: string, line: number, column: number) => void;
  /** Fired once the circuit is built, laid out and fitted (safe point to apply highlights). */
  onReady?: () => void;
  /** Fired after each engine tick (delta-cycle step) with the current tick number. */
  onTick?: (tick: number) => void;
  /**
   * 子部件「快捷查看展开图」：拦截 digitaljs 内置的 open:subcircuit 弹窗，
   * 改交由 App 用统一的**只读**预览视图渲染（R40：展开图不提供拖动/开关
   * 交互，只保留点击继续钻取子部件）。入参是该子模块的编译格式电路体。
   */
  onPreviewSubcircuit?: (circuitJson: any, name: string) => void;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { circuitJson, theme, onError, locked, paused, speedMs, onRunningChange, onSourceJump, onReady, onTick, onPreviewSubcircuit },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any | null>(null);
  const paperRef = useRef<any | null>(null);
  const valueTimers = useRef<ReturnType<typeof setInterval>[]>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  // 用户一旦自己拖过/缩过，就不许再被 render:done 的自动适应窗口抹掉（见 :699 那颗 refit）
  const userViewRef = useRef(false);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Refs so imperative sim commands always act on the latest circuit / desired state
  const lockedRef = useRef(locked);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speedMs);
  const onRunningRef = useRef(onRunningChange);
  onRunningRef.current = onRunningChange;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onSourceJumpRef = useRef(onSourceJump);
  onSourceJumpRef.current = onSourceJump;
  const onPreviewSubcircuitRef = useRef(onPreviewSubcircuit);
  onPreviewSubcircuitRef.current = onPreviewSubcircuit;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const applyFixed = useCallback((fixed: boolean) => {
    try {
      const p = paperRef.current;
      if (!p) return;
      // digitaljs ButtonView binds "click .btnface" via jQuery DOM delegation,
      // which BYPASSES joint's setInteractivity — so paper.fixed() alone does NOT
      // block switch clicks. Hard-disable pointer events on the paper element too.
      try { if (typeof p.fixed === 'function') p.fixed(fixed); } catch { /* older builds */ }
      const el = p.el || p.$el?.[0];
      if (el) el.style.pointerEvents = fixed ? 'none' : 'auto';
    } catch { /* paper not ready */ }
  }, []);

  // Mirror props into refs and live-apply when they change post-build
  useEffect(() => { lockedRef.current = locked; applyFixed(locked); }, [locked, applyFixed]);
  useEffect(() => {
    speedRef.current = speedMs;
    const c = circuitRef.current;
    if (c && !pausedRef.current) setSimInterval(c, speedMs);
  }, [speedMs]);
  // 走线方式是全局设置：在设置面板里改完，已画出来的编译电路图要**立刻**重排，
  // 不用重开文件、不用重新编译。
  useEffect(() => settingsStore.subscribe(() => {
    const paper = paperRef.current;
    if (!paper) return;
    try { applyWireStyle(paper, settingsStore.getSandboxSettings().wireStyle); } catch { /* ignore */ }
  }), []);
  useEffect(() => {
    pausedRef.current = paused;
    const c = circuitRef.current;
    if (!c) return;
    try {
      if (paused) {
        c.stop();
      } else {
        setSimInterval(c, speedRef.current, true);
      }
    } catch { /* ignore */ }
  }, [paused]);

  const applyTransform = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const { x, y } = panRef.current;
    const z = zoomRef.current;
    wrapper.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    wrapper.style.transformOrigin = '0 0';
  }, []);

  /**
   * 以「布局原点坐标系」里的 (mx,my) 为锚点缩放 —— **Ctrl+滚轮与右键菜单的放大/缩小共用这一份**。
   * 锚点算法只能有一处：菜单那颗以前根本没有（编译模式右键菜单只有"适应窗口/重置缩放"），
   * 补的时候要是另写一份，两条路就会飘（同"同一动作只许一份定位实现"那一族）。
   * ⚠ 必须置 `userViewRef`：否则下一次 `render:done` 的自动适应窗口会把用户刚调的缩放抹掉（R59 的真因）。
   */
  const zoomAt = useCallback((factor: number, mx: number, my: number) => {
    const newZoom = Math.min(5, Math.max(0.1, zoomRef.current * factor));
    const scale = newZoom / zoomRef.current;
    panRef.current = {
      x: mx - scale * (mx - panRef.current.x),
      y: my - scale * (my - panRef.current.y),
    };
    zoomRef.current = newZoom;
    userViewRef.current = true;
    applyTransform();
  }, [applyTransform]);

  /** 菜单「放大 / 缩小」：以视口中心为锚（没有光标位置可用时的默认锚点） */
  const zoomBy = useCallback((factor: number) => {
    const wrap = wrapperRef.current, el = containerRef.current;
    if (!wrap || !el) return;
    const wr = wrap.getBoundingClientRect(), cr = el.getBoundingClientRect();
    // 与 handleWheel 同一套换算：布局原点 = 当前左上 − pan
    zoomAt(factor, cr.left + cr.width / 2 - (wr.left - panRef.current.x), cr.top + cr.height / 2 - (wr.top - panRef.current.y));
  }, [zoomAt]);

  // Apply theme to the DigitalJS paper element background.
  // We force paper/SVG transparent so the container's --canvas-bg + dot-grid
  // show through — no opaque white slab after subcircuit drill-down.
  const applyThemeToPaper = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const paper =
      (wrapper.querySelector('.joint-paper') as HTMLElement | null) ||
      (wrapper.querySelector('.djs') as HTMLElement | null) ||
      (wrapper.querySelector('svg') as HTMLElement | null);
    if (paper) {
      paper.style.backgroundColor = 'transparent';
      paper.style.setProperty('background-color', 'transparent', 'important');
    }
    const svg = wrapper.querySelector('svg') as SVGSVGElement | null;
    if (svg) {
      svg.style.backgroundColor = 'transparent';
      svg.style.setProperty('background-color', 'transparent', 'important');
    }
    if (theme === 'dark') {
      paper?.classList.add('joint-theme-dark');
      paper?.classList.remove('joint-theme-default');
    } else {
      paper?.classList.add('joint-theme-default');
      paper?.classList.remove('joint-theme-dark');
    }
  }, [theme]);

  // Update paper theme when theme changes
  useEffect(() => {
    applyThemeToPaper();
  }, [theme, applyThemeToPaper]);

  // Measure the real drawn content extent. joint's getContentBBox() returns the
  // union of all cells in paper-local units INCLUDING its x/y origin offset, and
  // is immune to the svg's width="100%" attribute (which parseFloat() misreads as
  // 100px — the exact bug that pushed the circuit into the bottom-right corner).
  const measureContent = useCallback((): { x: number; y: number; width: number; height: number } | null => {
    const paper = paperRef.current;
    try {
      const cb = (paper as any)?.getContentBBox?.();
      if (cb && cb.width > 0 && cb.height > 0) {
        return { x: cb.x ?? 0, y: cb.y ?? 0, width: cb.width, height: cb.height };
      }
    } catch { /* not available on this joint build */ }
    // fallback: SVG element content bbox (local units)
    try {
      const svg = wrapperRef.current?.querySelector('svg') as SVGSVGElement | null;
      const g = svg?.getBBox?.();
      if (g && g.width > 0 && g.height > 0) return { x: g.x, y: g.y, width: g.width, height: g.height };
    } catch { /* ignore */ }
    return null;
  }, []);

  // Center the measured content at a given scale by setting the wrapper transform
  // (translate then scale, origin 0 0): screen = pan + scale * local.
  const centerAtScale = useCallback((scale: number) => {
    const el = containerRef.current;
    if (!el) return;
    const bb = measureContent();
    if (!bb) return;
    const rect = el.getBoundingClientRect();
    zoomRef.current = scale;
    panRef.current = {
      x: (rect.width - bb.width * scale) / 2 - bb.x * scale,
      y: (rect.height - bb.height * scale) / 2 - bb.y * scale,
    };
    applyTransform();
  }, [applyTransform, measureContent]);

  // Fit the circuit to fill the container (never upscale past 1:1)
  const fitToWindow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const bb = measureContent();
    if (!bb) return;
    const rect = el.getBoundingClientRect();
    const padding = 48;
    const scale = Math.max(0.1, Math.min(
      (rect.width - padding * 2) / bb.width,
      (rect.height - padding * 2) / bb.height,
      1,
    ));
    centerAtScale(scale);
  }, [measureContent, centerAtScale]);

  const resetZoom = useCallback(() => {
    centerAtScale(1);
  }, [centerAtScale]);

  // ---- code -> circuit source highlight ----
  const highlightedRef = useRef<Element[]>([]);
  const clearSourceHighlight = useCallback(() => {
    for (const el of highlightedRef.current) {
      try { el.classList.remove('src-highlight'); } catch { /* detached */ }
    }
    highlightedRef.current = [];
  }, []);
  const highlightSource = useCallback((srcPath: string, line: number): number => {
    const circuit = circuitRef.current;
    const paper = paperRef.current;
    if (!circuit || !paper) return 0;
    clearSourceHighlight();
    let n = 0;
    try {
      const covers = (model: any) => {
        const srcs = model.get?.('source_positions');
        return Array.isArray(srcs) && srcs.some((s: any) =>
          s && s.name === srcPath
          && (s.from?.line ?? 0) <= line
          && line <= (s.to?.line ?? s.from?.line ?? 0));
      };
      // Mirror the (proven) dblclick path: read model-id off rendered DOM nodes and
      // resolve via paper.model.getCell. joint's findView/_views keying is unreliable
      // here because digitaljs sets an 'id' attribute ('dev6') that differs from the
      // UUID keys joint uses internally.
      const paperEl: HTMLElement | undefined = paper.el || paper.$el?.[0];
      if (!paperEl) return 0;
      const holders = paperEl.querySelectorAll('[model-id]');
      for (const el of Array.from(holders)) {
        const mid = el.getAttribute('model-id');
        if (!mid) continue;
        const model = paper.model?.getCell?.(mid);
        if (model && covers(model)) {
          el.classList.add('src-highlight');
          highlightedRef.current.push(el);
          n++;
        }
      }
    } catch { /* graph internals unavailable on this digitaljs build */ }
    return n;
  }, [clearSourceHighlight]);

  useImperativeHandle(ref, () => ({
    resetZoom,
    fitToWindow,
    zoomBy,
    highlightSource,
    clearSourceHighlight,
    getGraphJson: () => {
      const paper = paperRef.current;
      if (!paper) return null;
      try {
        return serializePaperJson(paper);
      } catch {
        return null;
      }
    },
    probeCellAt: (clientX: number, clientY: number) => {
      const paper = paperRef.current;
      if (!paper) return null;
      const subs = (circuitJson as any)?.subcircuits || {};
      // Don't rely on elementFromPoint alone: a wire (link) often overlaps a cell
      // and would win the hit-test. Instead scan every rendered Subcircuit cell
      // and return the one whose bounding box contains the point.
      const nodes = Array.from(document.querySelectorAll('[model-id]'));
      let best: { celltype: string; label: string; drillable: boolean; area: number } | null = null;
      for (const el of nodes) {
        const id = el.getAttribute('model-id');
        if (!id) continue;
        const model = paper.model?.getCell?.(id);
        if (!model || model.get('type') !== 'Subcircuit') continue;
        const celltype = String(model.get('celltype') || '');
        const label = String(model.get('label') || '');
        const drillable = !!celltype && !!subs[celltype];
        if (!drillable) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const area = r.width * r.height;
          if (!best || area < best.area) best = { celltype, label, drillable, area };
        }
      }
      return best ? { celltype: best.celltype, label: best.label, drillable: best.drillable } : null;
    },
    getWaveChannels: () => {
      const paper = paperRef.current;
      if (!paper) return [];
      const seen = new Map<string, number>();
      try {
        for (const lk of paper.model.getLinks()) {
          const net = lk.get('netname');
          if (!net || seen.has(String(net))) continue;
          seen.set(String(net), Number(lk.get('bits')) || 1);
          if (seen.size >= 24) break;
        }
      } catch { /* ignore */ }
      return Array.from(seen.entries()).map(([name, bits]) => ({ name, bits }));
    },
    getWaveSample: () => {
      const paper = paperRef.current;
      const circuit = circuitRef.current;
      if (!paper || !circuit) return null;
      const values: Record<string, string> = {};
      const seen = new Set<string>();
      for (const lk of paper.model.getLinks()) {
        const net = lk.get('netname');
        if (!net || seen.has(String(net))) continue;
        seen.add(String(net));
        // 逐根 net 各兜一次：某一条线里的向量坏了（String() 会抛）不该让整批采样停掉
        try {
          const sig = lk.get('signal');
          values[String(net)] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
        } catch { values[String(net)] = 'x'; }
        if (seen.size >= 24) break;
      }
      return { tick: Number((circuit as any).tick) || 0, values };
    },
    stepOnce: () => {
      const paper = paperRef.current;
      const circuit = circuitRef.current as any;
      if (!paper || !circuit) return;
      try {
        // Ensure engine is paused (no auto-running between steps)
        try { circuit.stop(); } catch {}

        // Find every Clock cell (auto-created by io_ui for clk/clock inputs).
        const clocks: any[] = [];
        for (const el of paper.model.getElements()) {
          if (el.get('type') === 'Clock') clocks.push(el);
        }

        if (clocks.length === 0) {
          // Pure combinational: settle one delta-cycle burst.
          settle(circuit, 24);
          return;
        }

        // Sequential: toggle clock, then advance one delta tick.
        // First, pull clock low and let it settle.
        for (const clk of clocks) setOutBit(clk, false);
        settle(circuit, 24);
        // Then, rising edge — clock goes high.
        for (const clk of clocks) setOutBit(clk, true);
        settle(circuit, 24);
      } catch { /* step is cosmetic */ }
    },
    listInputs: () => {
      const paper = paperRef.current;
      if (!paper) return [];
      const out: { id: string; label: string; type: string; value: string; bits: number }[] = [];
      try {
        for (const el of paper.model.getElements()) {
          const t = el.get('type');
          if (t === 'Button' || t === 'Clock') {
            out.push({
              id: el.get('id'),
              label: el.get('label') || el.get('net') || el.get('id'),
              type: t,
              value: readOutBit(el) === '1' ? '1' : '0',
              bits: Number(el.get('bits') || 1),
            });
          }
        }
      } catch { /* ignore */ }
      return out;
    },
    /** 输出件统计（R102）：灯 / 七段 / 数值显示 / 输出端口——**只读**。
     *  ⚠ Lamp/Display 这类是**接收型**器件：值在 `inputSignals.in`（连线驱动），
     *    `outputSignals` 是空的 —— 读错来源会让输出段永远显示 x。 */
    listOutputs: () => {
      const paper = paperRef.current;
      if (!paper) return [];
      const OUT_TYPES = ['Lamp', 'Display7', 'NumDisplay', 'NumEntry', 'Output', 'Led', 'SevenSegment'];
      const out: { id: string; label: string; type: string; value: string }[] = [];
      const clean = (v: any) => (v == null ? null : String(v).replace(/^Vector3vl\s+/, ''));
      let seq = 0;
      try {
        for (const el of paper.model.getElements()) {
          const t = String(el.get('type'));
          if (!OUT_TYPES.includes(t)) continue;
          seq++;
          let val: string | null = null;
          try {
            const inSigs = el.get('inputSignals');
            const iv = inSigs ? (inSigs.in ?? Object.values(inSigs)[0]) : null;
            val = clean(iv);
          } catch { /* 落到 outputSignals */ }
          if (val == null) {
            try {
              const sigs = el.get('outputSignals');
              const v = sigs ? (sigs.out ?? Object.values(sigs)[0]) : null;
              val = clean(v);
            } catch { /* ignore */ }
          }
          out.push({
            id: el.get('id'),
            label: el.get('label') || el.get('net') || `${t}#${seq}`,
            type: t,
            value: val ?? 'x',
          });
        }
      } catch { /* ignore */ }
      return out;
    },
    toggleInput: (id: string) => {
      // R112 更正 R103 的过度解读：用户要的「非运行状态下禁止组件传输信号」禁的是
      //   **信号在电路里传播**（不运行 ⇒ 不调 updateGates ⇒ 灯不亮），**不是**禁止用户
      //   拨输入引脚。R103 误加了 `if (pausedRef.current) return;`，而沙盒/编译默认就是
      //   未运行态 ⇒ 用户**永远无法设置输入初值**（r50 三格全红：rst 拨不动、单步无 clk）。
      //   现在允许随时改输入值；「不运行时不传输」由下面**跳过 updateGates** 来保证。
      const paper = paperRef.current;
      const circuit = circuitRef.current as any;
      if (!paper || !circuit) return;
      try {
        const cell = paper.model.getCell(id);
        if (!cell) return;
        setOutBit(cell, readOutBit(cell) !== '1');
        // R112：非运行态**只改输入值、不传播** —— 这才是「禁止组件传输信号」的本意。
        // ⚠ 判据用**引擎实际状态**（`_engine.running`），不用 `pausedRef`：后者只是 UI 意图标志，
        //   编译后引擎还没起时它可能为 false，此时仍需要能算出静态值供用户看。
        if (circuit?._engine && !circuit._engine.running) return;
        if (typeof circuit.updateGates === 'function') circuit.updateGates();
        else settle(circuit, 24);
      } catch { /* ignore */ }
    },
    /** 翻转第 bitIndex 位（0 = 最低位）。多位 Button 在面板里要能逐位编辑（R102）。 */
    toggleInputBit: (id: string, bitIndex: number) => {
      // R112 同 toggleInput：不再"直接拒绝改值"，改成"改完不传播"。
      const paper = paperRef.current;
      const circuit = circuitRef.current as any;
      if (!paper || !circuit) return;
      try {
        const cell = paper.model.getCell(id);
        if (!cell) return;
        const o = (cell.get?.('outputSignals') || cell.outputSignals) || {};
        const sig = o.out ?? Object.values(o)[0];
        const C = sig && sig.constructor;
        const bits = Number(cell.get('bits')) || 1;
        if (!C || typeof C.fromBin !== 'function') { setOutBit(cell, readOutBit(cell) !== '1'); }
        else {
          const cur = String(sig ?? '').replace(/^Vector3vl\s+/, '').padStart(bits, '0').split('');
          const pos = bitIndex;                       // R102：位序左＝高位，bitIndex 从左数
          if (pos < 0 || pos >= bits) return;
          cur[pos] = cur[pos] === '1' ? '0' : '1';
          cell.set('outputSignals', { ...o, out: C.fromBin(cur.join(''), bits) });
        }
        // R112：同 toggleInput —— 非运行态只改输入值、不传播（用引擎实际状态判定）。
        if (circuit?._engine && !circuit._engine.running) return;
        if (typeof circuit.updateGates === 'function') circuit.updateGates();
        else settle(circuit, 24);
      } catch { /* ignore */ }
    },
    setFixed: (fixed: boolean) => applyFixed(fixed),
    setPaused: (p: boolean) => {
      pausedRef.current = p;
      const c = circuitRef.current;
      if (!c) return;
      try {
        if (p) {
          c.stop();
        } else {
          setSimInterval(c, speedRef.current, true);
        }
      } catch (err: any) {
        onError(`Sim control failed: ${err?.message || err}`);
      }
    },
    setSpeed: (ms: number) => {
      speedRef.current = ms;
      const c = circuitRef.current;
      if (c && !pausedRef.current) setSimInterval(c, ms);
    },
    reapplySimState: () => {
      const c = circuitRef.current;
      if (!c) return;
      applyFixed(lockedRef.current);
      try {
        if (pausedRef.current) c.stop();
        else setSimInterval(c, speedRef.current, true);
      } catch { /* ignore */ }
    },
  }), [resetZoom, fitToWindow, highlightSource, clearSourceHighlight, applyFixed, onError, circuitJson]);

  // Initialize or update circuit
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !circuitJson) return;

    if (circuitRef.current) {
      try { circuitRef.current.stop?.(); } catch {}
      try { circuitRef.current.shutdown?.(); } catch {}
      circuitRef.current = null;
      paperRef.current = null;
    }

    el.innerHTML = '';
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    userViewRef.current = false;
    wrapperRef.current = null;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.transformOrigin = '0 0';
    el.appendChild(wrapper);
    wrapperRef.current = wrapper;

    // ---- hover tooltip: net name + bit-width + live value (cells & wires) ----
    const tip = document.createElement('div');
    tip.className = 'net-tip';
    tip.style.cssText = 'position:absolute;display:none;z-index:30;pointer-events:none;'
      + 'padding:3px 7px;border-radius:6px;white-space:nowrap;font:500 var(--fs-xs)/1.35 ui-monospace,monospace;'
      + 'background:var(--menu-bg);color:var(--text);border:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,.25)';
    el.appendChild(tip);
    const cleanSig = (s: unknown) => String(s).replace(/^Vector3vl\s+/, '');
    const onMove = (ev: MouseEvent) => {
      const paper = paperRef.current;
      if (!paper || isPanning.current) { tip.style.display = 'none'; return; }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const holder = hit?.closest?.('[model-id]');
      const id = holder?.getAttribute('model-id');
      const model = id ? paper.model?.getCell?.(id) : null;
      if (!model) { tip.style.display = 'none'; return; }
      let text = '';
      if (typeof (model as any).isLink === 'function' && (model as any).isLink()) {
        const net = model.get('netname');
        const bits = model.get('bits');
        const sig = model.get('signal');
        if (sig == null && !net) { tip.style.display = 'none'; return; }
        text = `net ${net || '?'}${bits > 1 ? ` [${bits - 1}:0]` : ''} = ${sig != null ? cleanSig(sig) : '?'}`;
      } else {
        const type = model.get('type');
        const label = model.get('label');
        const net = model.get('net');
        const celltype = model.get('celltype');
        const os = model.get('outputSignals');
        const out = os && os.out != null ? cleanSig(os.out) : null;
        const head = (label && label !== id) ? String(label) : net ? `net ${net}` : (celltype ? String(celltype) : String(type || id));
        text = head + (type && String(type) !== head ? ` · ${type}` : '') + (out != null ? ` = ${out}` : '');
      }
      tip.textContent = text;
      tip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      let x = ev.clientX - rect.left + 14;
      let y = ev.clientY - rect.top + 14;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (x + tw > rect.width - 4) x = ev.clientX - rect.left - tw - 10;
      if (y + th > rect.height - 4) y = ev.clientY - rect.top - th - 10;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    };
    const onLeave = () => { tip.style.display = 'none'; };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);

    try {
      const circuit = new window.digitaljs.Circuit(circuitJson, {
        layoutEngine: 'elkjs',
      });
      const paper = circuit.displayOn(wrapper);
      paperRef.current = paper;

      // 走线方式是**全局**设置（编译模式与沙盒同一套），不是沙盒专属
      try { applyWireStyle(paper, settingsStore.getSandboxSettings().wireStyle); } catch { /* ignore */ }

      // Disable dragging on all non-IO cells — this is a compiled circuit,
      // not a manual editor. Dragging cells triggers elkjs re-layout which
      // causes wires to wildly bend. Only IO cells (Button/Clock/Lamp) stay
      // clickable.
      try {
        const IO_TYPES = new Set(['Button', 'Clock', 'Lamp', 'NumDisplay']);
        for (const el of paper.model.getCells()) {
          if (el.isLink()) continue;
          const type = el.get('type');
          if (!IO_TYPES.has(type)) {
            try { el.attr('interactive', false); } catch {}
            try { el.set('draggable', false); } catch {}
          }
        }
      } catch { /* cosmetic */ }

      // digitaljs's from_elkjs splits every corner into two points 10px apart
      // (to give joint room for rounded corners). We post-process: merge pairs
      // of vertices closer than 15px into a single sharp corner, keeping the
      // orthogonal shape without the little "bent" segments.
      try {
        for (const lk of paper.model.getLinks()) {
          try {
            const verts = lk.get('vertices') || [];
            if (!verts.length) continue;
            const merged = [verts[0]];
            for (let i = 1; i < verts.length; i++) {
              const prev = merged[merged.length - 1];
              const cur = verts[i];
              const dx = cur.x - prev.x;
              const dy = cur.y - prev.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 25) {
                // Merge: keep the corner midpoint
                merged[merged.length - 1] = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
              } else {
                merged.push(cur);
              }
            }
            lk.set('vertices', merged);
          } catch {}
        }
      } catch { /* cosmetic */ }

      // P1-3: rewrite auto-id cell labels (dev0/dev13) to human port/net names.
      // digitaljs's cell initialize() sets label.text = id regardless of the JSON
      // device.label, so we must patch the joint model AFTER displayOn.
      try {
        const IO_TYPES = new Set(['Button', 'Clock', 'Lamp', 'NumDisplay']);
        for (const el of paper.model.getElements()) {
          const type = el.get('type');
          if (!type) continue;
          if (IO_TYPES.has(type)) {
            const net = el.get('net');
            if (net) { el.set('label', net); el.attr('label/text', net); }
          } else if (type === 'BusGroup') {
            // BusGroup has no direct net attr — find the netname on its outgoing link.
            const outPort = el.getPort && el.getPort('out');
            const links = outPort ? paper.model.getConnectedLinks(outPort) : [];
            const net = links.map((l: any) => l.get('netname')).find(Boolean);
            if (net) { el.set('label', net); el.attr('label/text', net); }
          }
        }
      } catch { /* cosmetic only */ }

      // Bus visual: multi-bit wires get thicker stroke so they stand out
      // from 1-bit signals (Quartus-style: bus = thick line).
      try {
        for (const lk of paper.model.getLinks()) {
          const bits = lk.get('bits');
          const width = Array.isArray(bits) ? bits.length : (bits > 1 ? bits : 1);
          if (width > 1) {
            lk.attr('line/stroke-width', 2.5);
          }
        }
      } catch { /* cosmetic */ }

      // Wire value overlay: append live signal value to each named link's label.
      // Lightweight: only writes to joint model when the displayed value changes.
      const valueLabelTimer = setInterval(() => {
        try {
          for (const lk of paper.model.getLinks()) {
            const net = lk.get('netname');
            if (!net) continue;
            const sig = lk.get('signal');
            const raw = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
            const next = `${net} = ${raw}`;
            const cur = lk.attr('label/text');
            if (cur !== next) lk.attr('label/text', next);
          }
        } catch { /* ignore */ }
      }, 300);
      // Store for cleanup
      ;(valueTimers as any).current.push(valueLabelTimer);

      // elk layout is async; joint re-fits content on render:done. Re-run our
      // wrapper fit afterwards so the circuit is centered instead of off-corner.
      // Also re-apply theme here — elk async layout may rebuild DOM nodes that
      // lost the dark background (manifested as white paper after subcircuit drill-down).
      try {
        let refitCount = 0;
        paper.on?.('render:done', () => {
          if (refitCount >= 5) return;
          refitCount++;
          requestAnimationFrame(() => {
            // elk 重建 DOM 会丢主题，这颗每次都补
            applyThemeToPaper();
            // 用户已经拖过/缩过 ⇒ 画面不许再被"适应窗口"整体搬家（滚轮锚点会凭空失效）
            if (!userViewRef.current) fitToWindow();
          });
        });
      } catch { /* older builds */ }

      // keep external lock state authoritative as soon as paper exists
      applyFixed(lockedRef.current);

      // notify App when the engine transitions TO running (clears stale errors).
      // We intentionally do NOT report running=false from this event: React
      // StrictMode dev double-mount makes cleanup-stop() fire a spurious
      // changeRunning(false) that would surface a bogus "not started" error.
      // Refused-start is detected synchronously via hasWarnings() below instead.
      try {
        circuit.on?.('changeRunning', () => {
          if ((circuit as any).running) onRunningRef.current?.(true);
        });
      } catch { /* older builds may not expose event emitter on Circuit */ }

      if (pausedRef.current) {
        circuit.stop();
      } else {
        setSimInterval(circuit, speedRef.current, true);
      }
      // NOTE: do NOT read circuit.running synchronously here. stop() fires its
      // changeRunning event asynchronously (engine clears _interval then triggers),
      // so a sync read can transiently see running=false right after a rebuild and
      // surface a bogus "not started" error. Authoritative updates come from the
      // 'changeRunning' listener above; the warning gate is checked explicitly below.
      try {
        if (!pausedRef.current && typeof circuit.hasWarnings === 'function' && circuit.hasWarnings()) {
          onRunningRef.current?.(false);
        }
      } catch { /* ignore */ }

      circuitRef.current = circuit;

      // Report each engine tick to App (for debug tick counter)
      try {
        circuit.on?.('postUpdateGates', (tick: number) => {
          onTickRef.current?.(tick);
        });
      } catch { /* noop */ }

      // Double-click a cell carrying source_positions → jump to the defining line
      // (joint 4.1.3 has no built-in cell-dblclick event; hit-test via model-id attr)
      try {
        const paperEl: HTMLElement | undefined = paper.el || paper.$el?.[0];
        if (paperEl) {
          paperEl.addEventListener('dblclick', (e: MouseEvent) => {
            const holder = (e.target as Element | null)?.closest?.('[model-id]');
            const cellId = holder?.getAttribute('model-id');
            if (import.meta.env.DEV) {
              const w = window as any;
              w.__djsJumpDbg = { fired: ((w.__djsJumpDbg?.fired) || 0) + 1, tag: (e.target as Element)?.tagName, cellId: cellId || null };
            }
            if (!cellId) return;
            const model = paper.model?.getCell?.(cellId);
            const srcs = model?.get?.('source_positions');
            if (import.meta.env.DEV && (window as any).__djsJumpDbg) (window as any).__djsJumpDbg.srcs = Array.isArray(srcs) ? srcs.length : 0;
            if (Array.isArray(srcs) && srcs.length > 0) {
              const s = srcs[0];
              onSourceJumpRef.current?.(String(s.name || ''), s.from?.line ?? 1, s.from?.column ?? 1);
            }
          });
        }
      } catch { /* listener attach is best-effort; paper el is replaced on rebuild */ }

      // R40：拦截 digitaljs 内置的 open:subcircuit 弹窗（它会往 body 插一个
      // 裸 jQuery 弹窗，可拖动元件、可点开关），改交 App 用统一只读预览渲染。
      // 关掉内置监听后，a.zoom 点击只走我们自己的捕获阶段命中逻辑。
      try {
        // R106：点器件/连线**高亮**（与沙盒一致）。
        // ⚠ 两个实测坑（R112 编译模式探针在 test_and.v 上验证）：
        //   ① 这段原来被放在下面那个 `if (onPreviewSubcircuitRef.current)` 里，而那个 ref
        //      只有"存在子电路预览"时才非空 ⇒ **普通电路整段绑定根本不执行**（用户报的正是
        //      「点了没反应」）。必须独立于预览逻辑、无条件执行。
        //   ② `cell.on('cell:pointerclick', …)` **收不到事件**：joint 的 pointerclick 是
        //      由 **paper** 派发、参数是 View，Backbone 的 model 不转发 ⇒ 绑在 model 上
        //      等于绑了个死钩子。必须 `paper.on(...)`。
        let selPrev: any[] = [];
        const clearPrev = () => {
          selPrev.forEach((v: any) => v?.el?.classList?.remove('sm-selected'));
          selPrev = [];
        };
        paper.on('cell:pointerclick', (view: any) => {
          clearPrev();
          const t = view?.model;
          if (!t) return;
          let views: any[] = [];
          try {
            if (typeof t.isLink === 'function' && t.isLink()) {
              // 连线：两端所连的器件一起亮（沙盒同款语义）
              const ids = new Set<string>();
              const s = t.get('source'), tg = t.get('target');
              if (s?.id) ids.add(String(s.id));
              if (tg?.id) ids.add(String(tg.id));
              views = paper.model.getCells()
                .filter((x: any) => ids.has(String(x.id)))
                .map((x: any) => x.findView(paper))
                .filter(Boolean);
            } else {
              views = [view];
            }
          } catch { views = [view]; }
          selPrev = views;
          views.forEach((v: any) => v?.el?.classList?.add('sm-selected'));
        });
        paper.on('blank:pointerclick', clearPrev);
      } catch { /* best-effort：绑定失败只是没有高亮，不影响其它功能 */ }

      try {
        if (onPreviewSubcircuitRef.current) {
          // digitaljs 的 Circuit._makeGraph 在递归进子模块时**沿用自己的那张表**
          // （`_makeGraph(subcircuits[dev.celltype], subcircuits)`），所以子模块体
          // 必须**平铺在同一张 subcircuits 表**里 —— 逐层内联的写法只有上一层能
          // 查到，第 3 层起就是 `subcircuits[名] === undefined` → ctor 抛
          // "Cannot read properties of undefined (reading 'devices')"。
          // 编译产物本来就是平表（yosys2digitaljs 把所有模块收在顶层），直接沿用。
          const root = circuitJson as any;
          const flatSubs = root?.subcircuits && typeof root.subcircuits === 'object' ? root.subcircuits : {};
          const firePreview = (model: any) => {
            const name = String(model?.get?.('celltype') || '');
            const body = flatSubs[name];
            if (!body?.devices) return;
            onPreviewSubcircuitRef.current?.({ devices: body.devices, connectors: body.connectors ?? [], subcircuits: flatSubs }, name);
          };
          paper.off('open:subcircuit');
          paper.on('open:subcircuit', firePreview);
          // 兜底：joint 在 pointerdown 里 preventDefault，open:subcircuit 未必
          // 触发；用捕获阶段几何命中放大镜补一条（与沙盒展开图同一套逻辑）。
          const paperEl: HTMLElement | undefined = paper.el || paper.$el?.[0];
          if (paperEl) {
            paperEl.addEventListener('click', (e: MouseEvent) => {
              const subs = paper.model.getCells().filter((c: any) => c.get('type') === 'Subcircuit');
              for (const c of subs) {
                const v = c.findView(paper);
                const za = v?.el?.querySelector?.('a.zoom');
                if (!za) continue;
                const r = za.getBoundingClientRect();
                if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                  firePreview(c);
                  return;
                }
              }
            }, true);
          }
        }
      } catch { /* best-effort */ }

      // DEV-only read-only debug hook for automated smoke probes (stripped in prod builds)
      if (import.meta.env.DEV) {
        (window as any).__djsDebug = {
          // R112：暴露 paper 引用。此前编译画布**没有任何调试入口**（沙盒有
          // `window.__sandboxPaper`），导致「编译画布点部件有没有高亮」「编译画布空白右键
          // 有没有菜单」这两条一直无法端到端验证 —— 探针跑了三轮都进不去这个视图。
          paper: () => paper,
          cells: () => (paper ? paper.model.getCells().map((c: any) => ({ id: c.id, type: c.get('type'), isLink: !!(c.isLink && c.isLink()) })) : []),
          getSignals: () => {
            const g = (circuit as any)._graph;
            const cells = g.getElements().map((el: any) => ({
              id: el.get('id'), type: el.get('type'), label: el.get('label'), net: el.get('net'),
              out: el.get('outputSignals') && el.get('outputSignals').out ? String(el.get('outputSignals').out) : null,
              ins: el.get('inputSignals') ? Object.fromEntries(Object.entries(el.get('inputSignals')).map(([k, v]: [string, any]) => [k, String(v)])) : null,
            }));
            return { running: !!(circuit as any).running, warnings: (g as any)._warnings, tick: (circuit as any).tick ?? null, cells };
          },
          getLinks: () => {
            const g = (circuit as any)._graph;
            return g.getLinks().map((lk: any) => ({
              id: lk.get('id'), netname: lk.get('netname'), bits: lk.get('bits') ?? null,
              source: JSON.stringify(lk.get('source')?.cell || null), target: JSON.stringify(lk.get('target')?.cell || null),
            }));
          },
          getPaper: () => paper,
          getCircuit: () => circuit,
          // ⚠ 缩放取证用：wrapper 的**内联** transform 只有 applyTransform 会写，
          //   它变了就证明滚轮真的落到了 handleWheel（区分"我们的 CSS 缩放"与 joint 自己的缩放）。
          getZoomState: () => {
            const r = (x: DOMRect) => ({
              l: Math.round(x.left), t: Math.round(x.top), w: Math.round(x.width), h: Math.round(x.height),
            });
            const wrap = wrapperRef.current;
            const paperEl = (paper as any)?.el as HTMLElement | undefined;
            return {
              zoom: zoomRef.current, pan: { ...panRef.current },
              userView: userViewRef.current,
              wrapperInline: wrap ? wrap.style.transform : null,
              wrapperOrigin: wrap ? wrap.style.transformOrigin : null,
              container: r(el.getBoundingClientRect()),
              wrapperRect: wrap ? r(wrap.getBoundingClientRect()) : null,
              paperInline: paperEl ? paperEl.style.transform : null,
              paperRect: paperEl ? r(paperEl.getBoundingClientRect()) : null,
              jointScale: (() => { try { const s = (paper as any).scale(); return { sx: s.sx, sy: s.sy }; } catch { return null; } })(),
            };
          },
        };
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const svg = wrapper.querySelector('svg') as SVGSVGElement | null;
          if (svg) {
            svg.style.display = 'block';
            svg.style.maxWidth = 'none';
            svg.style.maxHeight = 'none';
          }
          applyThemeToPaper();
          fitToWindow();
          // circuit built + laid out + fitted: safe for App to apply source highlights
          onReadyRef.current?.();
        });
      });
    } catch (err: any) {
      onError(err.message || 'Failed to render circuit');
    }

    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      try { tip.remove(); } catch { /* already detached */ }
      clearSourceHighlight();
      for (const t of valueTimers.current) clearInterval(t);
      valueTimers.current = [];
      if (circuitRef.current) {
        try { circuitRef.current.stop?.(); } catch {}
        try { circuitRef.current.shutdown?.(); } catch {}
        circuitRef.current = null;
      }
      if (paperRef.current) {
        try { paperRef.current.remove?.(); } catch {}
        paperRef.current = null;
      }
    };
  }, [circuitJson, onError, fitToWindow, applyThemeToPaper, applyFixed, clearSourceHighlight]);

  // Pan and zoom mouse handlers
  // ⚠ panRef 的坐标系只有一个：容器相对（centerAtScale 与 handleWheel 都按它算）。
  //   原来这里存的是**绝对 clientX**，于是「拖过之后再 Ctrl+滚轮」锚点会整体偏掉一个
  //   容器左上角的距离（实测光标处漂 636px、画面直接出视口）——改成纯增量，
  //   增量与原点无关，panRef 就只有一种含义。
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      isPanning.current = true;
      userViewRef.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, px: panRef.current.x, py: panRef.current.y };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    panRef.current = {
      x: panStart.current.px + (e.clientX - panStart.current.x),
      y: panStart.current.py + (e.clientY - panStart.current.y),
    };
    applyTransform();
  }, [applyTransform]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+wheel = zoom at cursor（换算全在 zoomAt 那一份里）
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const wrap = wrapperRef.current;
        if (wrap) {
          // 锚点必须按 wrapper 的**布局原点**算：getBoundingClientRect 已含当前变换，
          // 而 origin 0 0 时盒左上 = 布局原点 + pan ⇒ 布局原点 = 左上 − pan（与容器无关，
          // 容器有内边距/inline-block 基线偏移都不会把锚点带歪）。
          const wr = wrap.getBoundingClientRect();
          zoomAt(delta, e.clientX - (wr.left - panRef.current.x), e.clientY - (wr.top - panRef.current.y));
        } else {
          zoomRef.current = Math.min(5, Math.max(0.1, zoomRef.current * delta));
          userViewRef.current = true;
          applyTransform();
        }
      } else {
        // Plain wheel = pan (vertical by default, horizontal with Shift)
        panRef.current = {
          x: panRef.current.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: panRef.current.y - (e.shiftKey ? e.deltaX : e.deltaY),
        };
        userViewRef.current = true;
      }
      applyTransform();
    },
    [applyTransform, zoomAt]
  );

  return (
    <>
      {/* R103：与沙盒同一套选中高亮样式（主题紫 + !important 压过 index.css 的主题规则） */}
      <style>{`
        [data-theme] .joint-paper .sm-selected .body, [data-theme] .joint-paper .sm-selected .gate,
        [data-theme] .joint-paper .sm-selected .btnface, [data-theme] .joint-paper .sm-selected .led,
        [data-theme] .joint-paper .sm-selected path.decor,
        [data-theme] .joint-paper .sm-selected .joint-port-body {
          stroke: var(--accent-hover) !important;
          stroke-width: 2.5 !important;
        }
        [data-theme] .joint-paper .sm-selected .connection {
          stroke: var(--accent-hover) !important;
          stroke-width: 3 !important;
        }
        [data-theme] .joint-paper .sm-selected circle.port { fill: var(--accent-hover) !important; }
      `}</style>
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--canvas-bg)',
        backgroundImage: theme === 'dark'
          ? 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)'
          : 'linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        overflow: 'hidden',
        position: 'relative',
      }}
    />
    </>
  );
});

export default Canvas;