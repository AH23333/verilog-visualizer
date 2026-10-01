import { useState, useEffect, useRef, useCallback } from 'react';
import { sandboxStore, customGateStore, type SandboxFile, type CustomGate } from '../store/sandboxStore';
import { exportPng, exportSvg, exportPngDataUrl, exportSvgString } from '../utils/sandboxExport';

interface Props {
  theme: 'dark' | 'light';
}

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Lamp'];
// Interface ports — placed to define a custom gate's input/output pins.
const PORT_TYPES = ['Input', 'Output'];

// (R13) Rebuild a digitaljs Subcircuit's inner graph (its embedded joint graph) from a
// serialized graph JSON. Inner Input/Output cells are forced to mode 0 (within-subcircuit)
// so the engine routes signals in/out of the subcircuit; the inner graph's Input/Output
// `net` becomes the subcircuit's port ids.
function buildInnerGraph(digitaljs: any, Graph: any, json: any, display3vl?: any) {
  const inner = new Graph();
  // Fidelity with digitaljs's Circuit._makeGraph: the inner graph must carry the 3VL
  // display helper + a subcircuit marker, else IO cells render wrongly and ports collapse.
  inner._display3vl = display3vl;
  inner._warnings = 0;
  inner.set('subcircuit', true);
  const innerMap = new Map<string, any>();
  let wn = 0;
  for (const cc of json?.cells || []) {
    if (cc.isLink) continue;
    const C = digitaljs.cells?.[cc.type];
    if (!C) continue;
    try {
      const cell = new C({
        type: cc.type,
        position: cc.position || { x: 50, y: 50 },
        bits: cc.bits || 1,
        net: cc.net || '',
      });
      if (cc.id) cell.set('id', cc.id);
      if (C === digitaljs.cells.Input || C === digitaljs.cells.Output) {
        try { cell.set('mode', 0); } catch { /* non-subcircuit IO */ }
      }
      inner.addCell(cell);
      if (cc.id) innerMap.set(cc.id, cell);
    } catch { /* skip bad inner cell */ }
  }
  for (const cc of json?.cells || []) {
    if (!cc.isLink) continue;
    try {
      const sCell = innerMap.get(cc.source?.id);
      const tCell = innerMap.get(cc.target?.id);
      if (!sCell || !tCell) continue;
      const link = new digitaljs.cells.Wire({
        source: { id: sCell.id, port: cc.source?.port },
        target: { id: tCell.id, port: cc.target?.port },
        netname: `N${++wn}`,
      });
      inner.addCell(link);
    } catch { /* skip broken inner link */ }
  }
  // (R13) The inner subcircuit graph is a bare joint.dia.Graph (NOT wrapped in a Circuit),
  // so it lacks the wire-propagation listeners that make a signal flow from a device's
  // output through a wire to its input. Without these, a custom gate's internal signal
  // never reaches its output pin and the whole gate reads as "x". Mirror circuit.js's
  // wiring so the engine can actually simulate the inner graph.
  inner.listenTo(inner, 'change:outputSignals', (gate: any, sigs: any) => {
    if (gate && typeof gate._changeOutputSignals === 'function') gate._changeOutputSignals(sigs);
  });
  inner.listenTo(inner, 'change:signal', (wire: any, signal: any) => {
    if (wire && typeof wire._changeSignal === 'function') wire._changeSignal(signal);
  });
  return inner;
}

// (R13) Serialize the paper to a clean JSON. The live Subcircuit `graph` is a circular
// joint.dia.Graph that breaks JSON.stringify, so we drop it and keep only the serializable
// `subcircuitGraph` copy. Without this, saving a circuit that contains a custom gate writes
// broken JSON and the gate is lost on reload.
function serializePaper(paper: any) {
  const cells = paper.model.getCells().map((c: any) => {
    const type = c.get('type');
    const cell: any = {
      id: c.id,
      type,
      position: c.get('position'),
      attrs: c.get('attrs'),
      size: c.get('size'),
      bits: c.get('bits'),
      net: c.get('net'),
      celltype: c.get('celltype'),
      label: c.get('label'),
      propagation: c.get('propagation'),
    };
    if (type === 'Subcircuit') cell.subcircuitGraph = c.get('subcircuitGraph');
    if (c.isLink()) {
      cell.isLink = true;
      cell.source = c.get('source');
      cell.target = c.get('target');
      cell.netname = c.get('netname');
    }
    Object.keys(cell).forEach((k) => cell[k] === undefined && delete cell[k]);
    return cell;
  });
  return { cells };
}

function SandboxCanvas({ theme }: Props) {
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const selectedIdRef = useRef<string | null>(null);
  const wireCountRef = useRef(0);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [running, setRunning] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingResetJsonRef = useRef<string | null>(null);
  const runningRef = useRef(true);
  const [, forceUpdate] = useState(0);
  const [gates, setGates] = useState<CustomGate[]>([]);
  const [savingGate, setSavingGate] = useState(false);
  const [gateName, setGateName] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [deleteGateId, setDeleteGateId] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    setFiles(sandboxStore.list());
  }, []);

  const refreshGates = useCallback(() => {
    setGates(customGateStore.list());
  }, []);

  // Create a cell by type at given position (shared by placement + load)
  const spawnCell = useCallback((type: string, x: number, y: number) => {
    const paper = paperRef.current;
    if (!paper) return null;
    const digitaljs = (window as any).digitaljs;
    const CellClass = digitaljs?.cells?.[type];
    if (!CellClass) return null;
    try {
      const cell = new CellClass({ type, position: { x, y }, bits: 1, size: { width: 60, height: 32 } });
      paper.model.addCell(cell);
      return cell;
    } catch { return null; }
  }, []);

  const doAddCell = useCallback((type: string) => {
    const cx = 100 + Math.round(Math.random() * 200);
    const cy = 100 + Math.round(Math.random() * 200);
    const cell = spawnCell(type, cx, cy);
    // (R13) Interface ports need unique pin names so a custom gate's Subcircuit
    // derives distinct, wire-able ports (port id == IO `net`).
    if (cell && PORT_TYPES.includes(type)) {
      const paper = paperRef.current;
      const same = paper ? paper.model.getCells().filter((c: any) => c.get('type') === type).length : 1;
      const prefix = type === 'Input' ? 'in' : 'out';
      try { cell.set('net', `${prefix}${same}`); } catch {}
    }
  }, [spawnCell]);

  // Load file list on mount
  useEffect(() => {
    refreshList();
    refreshGates();
    const activeId = sandboxStore.getActiveId();
    if (activeId) {
      const f = sandboxStore.get(activeId);
      if (f) setActiveFile(f);
    }
  }, [refreshList, refreshGates]);

  // (Re)build paper when active file changes
  useEffect(() => {
    if (!activeFile) return;
    const root = wrapperRef.current;
    if (!root) return;
    const digitaljs = (window as any).digitaljs;

    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    // Host child for the paper: displayOn makes the host the paper element, so
    // paper.remove() only removes the host — the root wrapper (and its grid) survives
    // re-builds. This fixes the "blank canvas after Reset" bug.
    const host = document.createElement('div');
    host.setAttribute('data-sandbox-paper-host', '');
    host.style.position = 'absolute';
    host.style.inset = '0';
    root.appendChild(host);
    const paper = circuit.displayOn(host);
    paperRef.current = paper;
    (window as any).__sandboxPaper = paper; // for QC tests // R7.2: simulation engine must run for signal propagation
    (window as any).__sandboxCircuit = circuit; // for QC tests // R10: read tick / control sim
    (window as any).__sandboxExport = {
      svgString: () => exportSvgString(paperRef.current),
      pngDataUrl: (scale = 2) => exportPngDataUrl(paperRef.current, scale),
    }; // for QC tests // R12: pixel-level verify export actually renders the circuit
    (window as any).__sandboxGates = {
      list: () => customGateStore.list(),
      place: (id: string) => { const g = customGateStore.get(id); if (g) placeCustomGate(g); },
      saveCurrentAs: (name: string) => {
        const paper = paperRef.current;
        if (!paper) return false;
        const cells = paper.model.getCells();
        if (!cells.some((c: any) => c.get('type') === 'Input') || !cells.some((c: any) => c.get('type') === 'Output')) return false;
        customGateStore.save(name, JSON.stringify(serializePaper(paper)));
        refreshGates();
        return true;
      },
    }; // for QC tests // R13: drive custom-gate import without the naming UI
    paper.options.interactive = false;
    paper.off('render:done');
    paper.scale(1);
    paper.translate(0, 0);
    if (runningRef.current) circuit.start(); // honor pause state

    // (R13) Build a digitaljs Subcircuit's embedded inner graph from a serialized JSON.
    const Graph = (paper.model as any).constructor;

    // Load cells + links. On Reset (pendingResetJsonRef set) we rebuild from the LIVE
    // paper's current topology so an unsaved circuit is NOT wiped; otherwise from saved graphJson.
    const sourceJson = pendingResetJsonRef.current ?? activeFile.graphJson ?? null;
    pendingResetJsonRef.current = null;
    if (sourceJson && sourceJson !== JSON.stringify({ cells: [] })) {
      try {
        const saved = JSON.parse(sourceJson);
        const cellMap = new Map<string, any>();
        // First pass: re-instantiate all cells
        for (const c of saved.cells || []) {
          if (c.isLink) continue;
          const pos = c.position || { x: 50, y: 50 };
          if (c.type === 'Subcircuit') {
            // Rebuild the embedded inner graph from the serializable `subcircuitGraph`
            // (a live joint.dia.Graph does NOT survive paper.model.toJSON(), so we keep a
            // clean JSON copy for persistence), then the Subcircuit wrapper.
            const inner = buildInnerGraph(digitaljs, Graph, c.subcircuitGraph || c.graph, paper.model._display3vl);
            const sub = new digitaljs.cells.Subcircuit({
              type: 'Subcircuit',
              graph: inner,
              subcircuitGraph: inner.toJSON(),
              celltype: c.celltype || '',
              position: { x: pos.x || 50, y: pos.y || 50 },
            });
            paper.model.addCell(sub);
            if (c.id) { sub.set('id', c.id); cellMap.set(c.id, sub); }
            continue;
          }
          const cell = spawnCell(c.type, pos.x || 50, pos.y || 50);
          if (cell && c.id) {
            cell.set('id', c.id);
            cellMap.set(c.id, cell);
          }
        }
        // Second pass: rebuild links
        for (const c of saved.cells || []) {
          if (!c.isLink) continue;
          try {
            const src = c.source, tgt = c.target;
            const srcCell = cellMap.get(src?.id);
            const tgtCell = cellMap.get(tgt?.id);
            if (!srcCell || !tgtCell) continue;
            const link = new digitaljs.cells.Wire({
              source: { id: srcCell.id, port: src.port },
              target: { id: tgtCell.id, port: tgt.port },
              signal: 'x',
              netname: `N${++wireCountRef.current}`,
            });
            paper.model.addCell(link);
          } catch { /* skip broken link */ }
        }
      } catch { /* corrupted save — start fresh */ }
    }

    // Click on empty canvas → deselect
    paper.on('blank:pointerdown', () => {
      if (selectedIdRef.current) {
        const prev = paper.model.getCell(selectedIdRef.current);
        prev?.attr('body/stroke', null);
        selectedIdRef.current = null;
        forceUpdate(n => n + 1);
      }
    });

    // Cell interaction: magnet→wire, body→drag+select
    paper.on('cell:pointerdown', (cellView: any, evt: any) => {
      if (typeof cellView.model.isLink === 'function' && cellView.model.isLink()) return;
      const magnet = evt.target?.closest?.('[magnet]');
      const magnetVal = magnet?.getAttribute('magnet');
      const isMagnet = magnetVal && magnetVal !== 'false';

      if (isMagnet) {
        // Start wiring — port name lives on parent .joint-port-body
        evt.stopPropagation();
        evt.preventDefault();
        const sourceCell = cellView.model;
        const portBody = magnet.closest('.joint-port-body');
        const sourcePort = portBody?.getAttribute('port');
        // Convert the pointer's viewport coords to paper-local (model) coords so the
        // loose end tracks the cursor 1:1 at any zoom/pan. Using raw `clientX - rect.left`
        // only works at scale=1/translate=0 and otherwise inflates the endpoint by the
        // zoom factor (the "wire end jumps far / wobbles" symptom).
        const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
        const tempLink = new digitaljs.cells.Wire({
          source: { id: sourceCell.id, port: sourcePort },
          target: { x: startLocal.x, y: startLocal.y },
          signal: 'x',
          netname: `N${++wireCountRef.current}`,
        });
        paper.model.addCell(tempLink);
        tempLink.findView(paper).el.style.pointerEvents = 'none';
        const onMove = (e: MouseEvent) => {
          const p = paper.clientToLocalPoint(e.clientX, e.clientY);
          tempLink.set('target', { x: p.x, y: p.y });
        };
        const onUp = (e: MouseEvent) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const targetMagnet = el?.closest?.('[magnet]');
          const tMagnetVal = targetMagnet?.getAttribute('magnet');
          if (targetMagnet && tMagnetVal && tMagnetVal !== 'false') {
            const tPortBody = targetMagnet.closest('.joint-port-body');
            const targetPort = tPortBody?.getAttribute('port');
            const tCellEl = targetMagnet.closest('[model-id]');
            const targetId = tCellEl?.getAttribute('model-id');
            if (targetId && targetId !== sourceCell.id && targetPort) {
              tempLink.set('target', { id: targetId, port: targetPort });
              tempLink.findView(paper).el.style.pointerEvents = '';
              return;
            }
          }
          tempLink.remove();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      // Body click → drag + select
      evt.stopPropagation();
      evt.preventDefault();

      // Select this cell
      if (selectedIdRef.current && selectedIdRef.current !== cellView.model.id) {
        const prev = paper.model.getCell(selectedIdRef.current);
        prev?.attr('body/stroke', null);
      }
      selectedIdRef.current = cellView.model.id;
      cellView.model.attr('body/stroke', 'var(--accent)');
      cellView.model.attr('body/stroke-width', 2);
      forceUpdate(n => n + 1);

      // Drag — move in model space. Convert the pointer to paper-local coords and add the
      // model-space delta to the original position, so the component tracks the cursor 1:1
      // regardless of zoom (raw screen-delta math multiplies the displacement by the zoom factor).
      const startLocal = paper.clientToLocalPoint(evt.clientX, evt.clientY);
      const origPos = cellView.model.position();
      const onMove = (e: MouseEvent) => {
        const p = paper.clientToLocalPoint(e.clientX, e.clientY);
        cellView.model.set('position', {
          x: origPos.x + (p.x - startLocal.x),
          y: origPos.y + (p.y - startLocal.y),
        });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Delete key
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (!selectedIdRef.current) return;
      const cell = paper.model.getCell(selectedIdRef.current);
      if (cell) cell.remove();
      selectedIdRef.current = null;
      forceUpdate(n => n + 1);
    };
    document.addEventListener('keydown', onKey);

    // Zoom (Ctrl+wheel) and pan (wheel / right-drag)
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const curScale = paper.scale().sx || 1;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const ns = Math.max(0.3, Math.min(3, curScale * delta));
        paper.scale(ns);
      } else {
        e.preventDefault();
        const t = paper.translate();
        paper.translate(t.tx - e.deltaX, t.ty - e.deltaY);
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });

    // Right-drag pan
    let panning = false, panStartX = 0, panStartY = 0, origTx = 0, origTy = 0;
    const onPanDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      panning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      const t = paper.translate();
      origTx = t.tx; origTy = t.ty;
      e.preventDefault();
    };
    const onPanMove = (e: MouseEvent) => {
      if (!panning) return;
      paper.translate(origTx + (e.clientX - panStartX), origTy + (e.clientY - panStartY));
    };
    const onPanUp = () => { panning = false; };
    root.addEventListener('mousedown', onPanDown);
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanUp);
    root.addEventListener('contextmenu', e => e.preventDefault());

    const resize = () => {
      const parent = root.parentElement!;
      paper.setDimensions(parent.clientWidth, parent.clientHeight);
    };
    resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(root.parentElement!);

    root.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';

    return () => {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('mousedown', onPanDown);
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup', onPanUp);
      ro.disconnect();
      try { circuit.stop(); } catch {}
      paper.remove();
    };
  }, [activeFile?.id, theme, spawnCell, resetNonce]);

  const handleNew = () => {
    let n = files.length + 1;
    let name = `circuit_${n}.djs`;
    while (files.some(f => f.name === name)) { n++; name = `circuit_${n}.djs`; }
    const f = sandboxStore.create(name);
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    refreshList();
  };

  const handleOpen = (f: SandboxFile) => {
    if (activeFile && paperRef.current) {
      sandboxStore.save(activeFile.id, JSON.stringify(serializePaper(paperRef.current)));
    }
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    setConfirmDeleteId(null);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    sandboxStore.save(activeFile.id, JSON.stringify(serializePaper(paperRef.current)));
    refreshList();
    forceUpdate(n => n + 1);
  };
  (window as any).__sandboxSave = handleSave; // R13 QC hook: drive the real save logic without the naming UI

  const handleStep = () => {
    const circuit = circuitRef.current;
    if (!circuit) return;
    try { circuit.updateGatesNext?.(); } catch {}
  };

  const handleReset = () => {
    // Capture the LIVE topology (so an unsaved circuit is NOT wiped), then bump
    // resetNonce: the effect rebuilds a fresh circuit from this JSON and the sim
    // returns to power-on (gates re-initialized). This is a true reset, not pause/resume.
    const live = paperRef.current ? serializePaper(paperRef.current) : null;
    pendingResetJsonRef.current = live ? JSON.stringify(live) : (activeFile?.graphJson ?? null);
    try { circuitRef.current?.stop(); } catch {}
    setResetNonce(n => n + 1);
  };

  const handlePlayPause = () => {
    const c = circuitRef.current;
    if (!c) return;
    const next = !running;
    runningRef.current = next;
    setRunning(next);
    try { if (next) c.start(); else c.stop(); } catch {}
  };

  // Clear the current selection's accent outline so it isn't baked into the export
  // (the inline stroke uses var(--accent), which is meaningless outside the live DOM).
  const clearSelection = useCallback(() => {
    if (selectedIdRef.current && paperRef.current) {
      const prev = paperRef.current.model.getCell(selectedIdRef.current);
      prev?.attr('body/stroke', null);
      selectedIdRef.current = null;
      forceUpdate(n => n + 1);
    }
  }, []);

  const handleExportPng = () => {
    if (!paperRef.current) return;
    clearSelection();
    const name = activeFile ? activeFile.name.replace(/\.djs$/i, '') : 'circuit';
    exportPng(paperRef.current, `${name}.png`, 2).catch(() => {});
  };

  const handleExportSvg = () => {
    if (!paperRef.current) return;
    clearSelection();
    const name = activeFile ? activeFile.name.replace(/\.djs$/i, '') : 'circuit';
    exportSvg(paperRef.current, `${name}.svg`).catch(() => {});
  };

  // (R13) Place a custom gate as a digitaljs Subcircuit cell. Its inner graph is
  // rebuilt from the saved gate JSON and embedded in the Subcircuit. We also keep a
  // serializable `subcircuitGraph` copy (a live joint.dia.Graph won't survive toJSON).
  const placeCustomGate = useCallback((gate: CustomGate) => {
    const paper = paperRef.current;
    const digitaljs = (window as any).digitaljs;
    if (!paper || !digitaljs) return;
    let saved: any;
    try { saved = JSON.parse(gate.graphJson); } catch { return; }
    const Graph = (paper.model as any).constructor;
    const inner = buildInnerGraph(digitaljs, Graph, saved, paper.model._display3vl);
    const cx = 100 + Math.round(Math.random() * 200);
    const cy = 100 + Math.round(Math.random() * 200);
    const sub = new digitaljs.cells.Subcircuit({
      type: 'Subcircuit',
      graph: inner,
      // (R13) Store a CLEAN inner-graph JSON (no live joint graph, no Vector3vl wire
      // signals) so it survives JSON.stringify; the live `graph` would break serialization.
      subcircuitGraph: serializePaper({ model: inner }),
      celltype: gate.name,
      position: { x: cx, y: cy },
    });
    paper.model.addCell(sub);
  }, []);

  // Save the current circuit as a custom gate. Requires at least one Input and one
  // Output (the interface pins) so the resulting Subcircuit has real ports.
  const handleSaveGate = () => {
    const paper = paperRef.current;
    if (!paper || !activeFile) return;
    const cells = paper.model.getCells();
    const hasIn = cells.some((c: any) => c.get('type') === 'Input');
    const hasOut = cells.some((c: any) => c.get('type') === 'Output');
    if (!hasIn || !hasOut) {
      setGateError('Need ≥1 Input and ≥1 Output as interface pins');
      return;
    }
    const name = gateName.trim();
    if (!name) {
      setGateError('Enter a gate name');
      return;
    }
    customGateStore.save(name, JSON.stringify(serializePaper(paper)));
    refreshGates();
    setSavingGate(false);
    setGateName('');
    setGateError(null);
    forceUpdate(n => n + 1);
  };

  const handleDeleteGate = (g: CustomGate) => {
    if (deleteGateId !== g.id) {
      setDeleteGateId(g.id);
      return;
    }
    customGateStore.remove(g.id);
    setDeleteGateId(null);
    refreshGates();
  };

  const handleDelete = (f: SandboxFile) => {
    if (confirmDeleteId !== f.id) {
      setConfirmDeleteId(f.id);
      return;
    }
    sandboxStore.remove(f.id);
    if (activeFile?.id === f.id) setActiveFile(null);
    setConfirmDeleteId(null);
    refreshList();
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <div style={{
        width: 180, borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>FILES</span>
            <button onClick={handleNew} title="New file"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3,
                width: 20, height: 20, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>+</button>
          </div>
          {files.map(f => (
            <div key={f.id}
              onClick={() => handleOpen(f)}
              style={{
                padding: '3px 6px', cursor: 'pointer', borderRadius: 3,
                background: activeFile?.id === f.id ? 'var(--accent)' : 'transparent',
                color: activeFile?.id === f.id ? '#fff' : 'var(--text)',
                fontSize: 'var(--fs-xs)', marginBottom: 1,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span
                onClick={(e) => { e.stopPropagation(); handleDelete(f); }}
                style={{
                  cursor: 'pointer', marginLeft: 4,
                  color: confirmDeleteId === f.id ? 'var(--error, #ef4444)' : undefined,
                  fontWeight: confirmDeleteId === f.id ? 700 : 400,
                }}>
                {confirmDeleteId === f.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {files.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '4px 0' }}>No files yet</div>
          )}
        </div>

        <div style={{ padding: 8, overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>GATES</div>
          {GATE_TYPES.map(t => (
            <button key={t} onClick={() => doAddCell(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px',
                marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
              {t}</button>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '6px 0 4px', fontWeight: 600 }}>IO</div>
          {IO_TYPES.map(t => (
            <button key={t} onClick={() => doAddCell(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px',
                marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
              {t}</button>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '6px 0 4px', fontWeight: 600 }}>PORTS</div>
          {PORT_TYPES.map(t => (
            <button key={t} onClick={() => doAddCell(t)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '3px 6px',
                marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
              {t}</button>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>USER</div>
          {gates.map(g => (
            <div key={g.id}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 1, fontSize: 'var(--fs-xs)' }}>
              <button onClick={() => placeCustomGate(g)}
                title={`Place custom gate "${g.name}"`}
                style={{ flex: 1, textAlign: 'left', padding: '3px 6px', background: 'transparent',
                  border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                {g.name}</button>
              <span
                onClick={(e) => { e.stopPropagation(); handleDeleteGate(g); }}
                title="Delete custom gate"
                style={{ cursor: 'pointer', marginLeft: 4,
                  color: deleteGateId === g.id ? 'var(--error, #ef4444)' : 'var(--text-muted)',
                  fontWeight: deleteGateId === g.id ? 700 : 400 }}>
                {deleteGateId === g.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {gates.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Save a circuit as a gate</div>
          )}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>TIPS</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            · 拖 port 圆点连线<br/>
            · 单击选中，Delete 删除<br/>
            · 拖 body 移动<br/>
            · Input/Output 定义自定义门引脚
          </div>
        </div>

        <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={handleStep} disabled={!activeFile} title="Step once (delta cycle)"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              Step
            </button>
            <button onClick={handleReset} disabled={!activeFile} title="Reset simulation"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              Reset
            </button>
            <button onClick={handlePlayPause} disabled={!activeFile} title="Play / Pause simulation"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              {running ? 'Pause' : 'Play'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button onClick={handleExportPng} disabled={!activeFile} title="Export circuit as PNG"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              Export PNG
            </button>
            <button onClick={handleExportSvg} disabled={!activeFile} title="Export circuit as SVG"
              style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
              Export SVG
            </button>
          </div>
          <button onClick={handleSave} disabled={!activeFile}
            style={{ width: '100%', padding: '6px', background: activeFile ? 'var(--accent)' : 'var(--border)',
              color: activeFile ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 4, cursor: activeFile ? 'pointer' : 'not-allowed',
              fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
            {activeFile ? `Save ${activeFile.name}` : 'Open a file first'}
          </button>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {savingGate ? (
              <>
                <input
                  autoFocus
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveGate(); if (e.key === 'Escape') { setSavingGate(false); setGateName(''); setGateError(null); } }}
                  placeholder="Gate name"
                  disabled={!activeFile}
                  style={{ flex: 1, padding: '4px', fontSize: 'var(--fs-xs)', background: 'var(--surface)',
                    color: 'var(--text)', border: '1px solid var(--border-subtle)', borderRadius: 3 }} />
                <button onClick={handleSaveGate} title="Confirm save as custom gate"
                  style={{ padding: '4px 8px', background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 3, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>OK</button>
                <button onClick={() => { setSavingGate(false); setGateName(''); setGateError(null); }} title="Cancel"
                  style={{ padding: '4px 8px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-subtle)',
                    borderRadius: 3, cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>×</button>
              </>
            ) : (
              <button onClick={() => setSavingGate(true)} disabled={!activeFile} title="Save current circuit as a custom gate (needs Input/Output pins)"
                style={{ flex: 1, padding: '4px', background: activeFile ? 'var(--surface)' : 'var(--border)',
                  color: activeFile ? 'var(--text)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)',
                  borderRadius: 3, cursor: activeFile ? 'pointer' : 'not-allowed', fontSize: 'var(--fs-xs)' }}>
                Save as Gate
              </button>
            )}
          </div>
          {gateError && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #ef4444)', marginTop: 2, marginBottom: 4 }}>{gateError}</div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div ref={wrapperRef} data-sandbox-wrapper style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        {!activeFile && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
          }}>
            Click + to create a new sandbox file
          </div>
        )}
      </div>
    </div>
  );
}

export default SandboxCanvas;
