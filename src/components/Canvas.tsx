import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface CanvasHandle {
  resetZoom: () => void;
  fitToWindow: () => void;
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
  listInputs: () => { id: string; label: string; type: string; value: string }[];
  /** Toggle a Button/Clock input by cell id (flip its output and propagate). */
  toggleInput: (id: string) => void;
  /**
   * Hit-test a screen point against rendered cells. Returns the cell's sub-module
   * info so the caller (context menu) can offer "Enter submodule" when drillable.
   */
  probeCellAt: (clientX: number, clientY: number) => { celltype: string; label: string; drillable: boolean } | null;
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
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { circuitJson, theme, onError, locked, paused, speedMs, onRunningChange, onSourceJump, onReady },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any | null>(null);
  const paperRef = useRef<any | null>(null);
  const valueTimers = useRef<ReturnType<typeof setInterval>[]>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Refs so imperative sim commands always act on the latest circuit / desired state
  const lockedRef = useRef(locked);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speedMs);
  const onRunningRef = useRef(onRunningChange);
  onRunningRef.current = onRunningChange;
  const onSourceJumpRef = useRef(onSourceJump);
  onSourceJumpRef.current = onSourceJump;
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
    if (c && !pausedRef.current) {
      try { c.interval = speedMs; } catch { /* engine may not expose interval */ }
    }
  }, [speedMs]);
  useEffect(() => {
    pausedRef.current = paused;
    const c = circuitRef.current;
    if (!c) return;
    try {
      if (paused) {
        c.stop();
      } else {
        c.interval = speedRef.current;
        c.start();
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
    highlightSource,
    clearSourceHighlight,
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
      try {
        const seen = new Set<string>();
        for (const lk of paper.model.getLinks()) {
          const net = lk.get('netname');
          if (!net || seen.has(String(net))) continue;
          seen.add(String(net));
          const sig = lk.get('signal');
          values[String(net)] = sig != null ? String(sig).replace(/^Vector3vl\s+/, '') : 'x';
          if (seen.size >= 24) break;
        }
      } catch { /* ignore */ }
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
          // Pure combinational: advance ONE delta-cycle tick.
          const count = circuit.updateGatesNext();
          console.log('[stepOnce] combinational delta-cycle, gates processed:', count);
          return;
        }

        // Sequential: toggle clock, then advance one delta tick.
        // First, pull clock low and let it settle (one tick).
        for (const clk of clocks) {
          const sig = clk.outputSignals?.out;
          if (sig?._bvec) { sig._bvec[0] = 0; sig._avec = {}; }
        }
        circuit.updateGatesNext();
        // Then, rising edge — clock goes high.
        for (const clk of clocks) {
          const sig = clk.outputSignals?.out;
          if (sig?._bvec) { sig._bvec[0] = 1; sig._avec = { 0: 1 }; }
        }
        circuit.updateGatesNext();
      } catch { /* step is cosmetic */ }
    },
    listInputs: () => {
      const paper = paperRef.current;
      if (!paper) return [];
      const out: { id: string; label: string; type: string; value: string }[] = [];
      try {
        for (const el of paper.model.getElements()) {
          const t = el.get('type');
          if (t === 'Button' || t === 'Clock') {
            const sig = el.outputSignals?.out;
            const bv = sig?._bvec?.[0];
            out.push({
              id: el.get('id'),
              label: el.get('label') || el.get('net') || el.get('id'),
              type: t,
              value: bv === 1 ? '1' : '0',
            });
          }
        }
      } catch { /* ignore */ }
      return out;
    },
    toggleInput: (id: string) => {
      const paper = paperRef.current;
      const circuit = circuitRef.current as any;
      if (!paper || !circuit) return;
      try {
        const cell = paper.model.getCell(id);
        if (!cell) return;
        const sig = cell.outputSignals?.out;
        if (!sig?._bvec) return;
        sig._bvec[0] = sig._bvec[0] === 1 ? 0 : 1;
        sig._avec = sig._bvec[0] === 1 ? { 0: 1 } : {};
        if (typeof circuit.updateGates === 'function') circuit.updateGates();
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
          c.interval = speedRef.current;
          c.start();
        }
      } catch (err: any) {
        onError(`Sim control failed: ${err?.message || err}`);
      }
    },
    setSpeed: (ms: number) => {
      speedRef.current = ms;
      const c = circuitRef.current;
      if (c && !pausedRef.current) {
        try { c.interval = ms; } catch { /* ignore */ }
      }
    },
    reapplySimState: () => {
      const c = circuitRef.current;
      if (!c) return;
      applyFixed(lockedRef.current);
      try {
        if (pausedRef.current) c.stop();
        else { c.interval = speedRef.current; c.start(); }
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
      + 'padding:3px 7px;border-radius:6px;white-space:nowrap;font:500 0.72rem/1.35 ui-monospace,monospace;'
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
          if (refitCount++ < 5) {
            requestAnimationFrame(() => { fitToWindow(); applyThemeToPaper(); });
          }
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
        try { circuit.interval = speedRef.current; } catch { /* ignore */ }
        circuit.start();
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

      // DEV-only read-only debug hook for automated smoke probes (stripped in prod builds)
      if (import.meta.env.DEV) {
        (window as any).__djsDebug = {
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
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    panRef.current = {
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
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
        // Ctrl+wheel = zoom at cursor
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(5, Math.max(0.1, zoomRef.current * delta));
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const scale = newZoom / zoomRef.current;
          panRef.current = {
            x: mx - scale * (mx - panRef.current.x),
            y: my - scale * (my - panRef.current.y),
          };
        }
        zoomRef.current = newZoom;
      } else {
        // Plain wheel = pan (vertical by default, horizontal with Shift)
        panRef.current = {
          x: panRef.current.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: panRef.current.y - (e.shiftKey ? e.deltaX : e.deltaY),
        };
      }
      applyTransform();
    },
    [applyTransform]
  );

  return (
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
  );
});

export default Canvas;