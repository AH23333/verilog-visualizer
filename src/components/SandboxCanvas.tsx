import { useState, useEffect, useRef, useCallback } from 'react';
import { sandboxStore, type SandboxFile } from '../store/sandboxStore';

interface Props {
  theme: 'dark' | 'light';
}

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Lamp'];

function SandboxCanvas({ theme }: Props) {
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const selectedIdRef = useRef<string | null>(null);
  const wireCountRef = useRef(0);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const refreshList = useCallback(() => {
    setFiles(sandboxStore.list());
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
    spawnCell(type, cx, cy);
  }, [spawnCell]);

  // Load file list on mount
  useEffect(() => {
    refreshList();
    const activeId = sandboxStore.getActiveId();
    if (activeId) {
      const f = sandboxStore.get(activeId);
      if (f) setActiveFile(f);
    }
  }, [refreshList]);

  // (Re)build paper when active file changes
  useEffect(() => {
    if (!activeFile) return;
    const wrapper = document.querySelector('[data-sandbox-wrapper]') as HTMLElement;
    if (!wrapper) return;
    const digitaljs = (window as any).digitaljs;

    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    const paper = circuit.displayOn(wrapper);
    paperRef.current = paper;
    paper.options.interactive = false;
    paper.off('render:done');
    paper.scale(1);
    paper.translate(0, 0);
    circuit.start();
    (window as any).__sandboxPaper = paper; // for QC tests // R7.2: simulation engine must run for signal propagation

    // Load saved cells + links
    if (activeFile.graphJson && activeFile.graphJson !== JSON.stringify({ cells: [] })) {
      try {
        const saved = JSON.parse(activeFile.graphJson);
        const cellMap = new Map<string, any>();
        // First pass: re-instantiate all cells
        for (const c of saved.cells || []) {
          if (c.isLink) continue;
          const pos = c.position || { x: 50, y: 50 };
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
        const rect = wrapper.getBoundingClientRect();
        const tempLink = new digitaljs.cells.Wire({
          source: { id: sourceCell.id, port: sourcePort },
          target: { x: evt.clientX - rect.left, y: evt.clientY - rect.top },
          signal: 'x',
          netname: `N${++wireCountRef.current}`,
        });
        paper.model.addCell(tempLink);
        tempLink.findView(paper).el.style.pointerEvents = 'none';
        const onMove = (e: MouseEvent) => {
          tempLink.set('target', { x: e.clientX - rect.left, y: e.clientY - rect.top });
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

      // Drag
      const origPos = cellView.model.position();
      const startX = evt.clientX, startY = evt.clientY;
      const onMove = (e: MouseEvent) => {
        cellView.model.set('position', {
          x: origPos.x + (e.clientX - startX),
          y: origPos.y + (e.clientY - startY),
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
    wrapper.addEventListener('wheel', onWheel, { passive: false });

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
    wrapper.addEventListener('mousedown', onPanDown);
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanUp);
    wrapper.addEventListener('contextmenu', e => e.preventDefault());

    const resize = () => {
      const parent = wrapper.parentElement!;
      paper.setDimensions(parent.clientWidth, parent.clientHeight);
    };
    resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper.parentElement!);

    wrapper.style.backgroundColor = theme === 'dark' ? 'var(--surface)' : '#ffffff';

    return () => {
      document.removeEventListener('keydown', onKey);
      wrapper.removeEventListener('wheel', onWheel);
      wrapper.removeEventListener('mousedown', onPanDown);
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup', onPanUp);
      ro.disconnect();
      try { circuit.stop(); } catch {}
      paper.remove();
    };
  }, [activeFile?.id, theme, spawnCell]);

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
      sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    }
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    setConfirmDeleteId(null);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    refreshList();
    forceUpdate(n => n + 1);
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
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>TIPS</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            · 拖 port 圆点连线<br/>
            · 单击选中，Delete 删除<br/>
            · 拖 body 移动
          </div>
        </div>

        <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={handleSave} disabled={!activeFile}
            style={{ width: '100%', padding: '6px', background: activeFile ? 'var(--accent)' : 'var(--border)',
              color: activeFile ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 4, cursor: activeFile ? 'pointer' : 'not-allowed',
              fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
            {activeFile ? `Save ${activeFile.name}` : 'Open a file first'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div data-sandbox-wrapper style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
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
