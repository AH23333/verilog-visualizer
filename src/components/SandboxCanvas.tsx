import { useState, useEffect, useRef, useCallback } from 'react';
import { sandboxStore, type SandboxFile } from '../store/sandboxStore';

export interface SandboxHandle {
  addCell: (type: string) => void;
  saveCurrent: () => void;
}

interface Props {
  theme: 'dark' | 'light';
}

const GATE_TYPES = ['And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Xnor'];
const IO_TYPES = ['Button', 'Clock', 'Input', 'Output', 'Lamp', 'Dff'];

function SandboxCanvas({ theme }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any>(null);
  const paperRef = useRef<any>(null);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFile, setActiveFile] = useState<SandboxFile | null>(null);
  const [, forceUpdate] = useState(0);

  const refreshList = useCallback(() => {
    setFiles(sandboxStore.list());
  }, []);

  const doAddCell = useCallback((type: string) => {
    const paper = paperRef.current;
    if (!paper) { console.warn('[sandbox] no paper'); return; }
    const digitaljs = (window as any).digitaljs;
    const cells = digitaljs?.cells;
    const CellClass = cells?.[type];
    if (!CellClass) { console.warn('[sandbox] unknown cell type:', type); return; }
    try {
      // Place at fixed paper coords with jitter (avoid wrapper center calc issues)
      const cx = 100 + Math.round(Math.random() * 200);
      const cy = 100 + Math.round(Math.random() * 200);
      const cellJson = {
        type: type,
        position: { x: cx, y: cy },
        bits: 1,
        size: { width: 60, height: 32 },
      };
      const cell = new CellClass(cellJson);
      paper.model.addCell(cell);
      console.log('[sandbox] cell attrs:', JSON.stringify(cell.attr()), 'interactive:', cell.get('interactive'), 'draggable:', cell.get('draggable'));
      console.log('[sandbox] added', type, 'at', cx, cy, 'total:', paper.model.getCells().length);
    } catch (e) { console.error('[sandbox] addCell failed:', e); }
  }, []);

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
    // Query DOM directly — wrapperRef may point to a stale detached node
    const wrapper = document.querySelector('[data-sandbox-wrapper]') as HTMLElement;
    if (!wrapper) return;
    console.log('[sandbox] useEffect: wrapper connected:', wrapper.isConnected, 'children:', wrapper.children.length);
    const digitaljs = (window as any).digitaljs;

    // Cleanup old
    if (circuitRef.current) {
      try { circuitRef.current.stop(); } catch {}
      paperRef.current?.remove();
    }

    const circuit = new digitaljs.Circuit({ devices: {}, connectors: [], subcircuits: {} }, { layoutEngine: false });
    circuitRef.current = circuit;
    const paper = circuit.displayOn(wrapper);
    paperRef.current = paper;
    paper.options.interactive = false; // we handle drag manually
    // Reset paper view — digitaljs may auto-fit on empty model
    paper.scale(1);
    paper.translate(0, 0);

    // Load active file's graph
    if (activeFile && activeFile.graphJson && activeFile.graphJson !== JSON.stringify({ cells: [] })) {
      try {
        paper.model.fromJSON(JSON.parse(activeFile.graphJson));
      } catch (e) { console.warn('[sandbox] load failed:', e); }
    }

    // Manual drag — digitaljs gates intercept pointerdown for wiring
    paper.on('cell:pointerdown', (cellView: any, evt: any) => {
      if (typeof cellView.model.isLink === 'function' && cellView.model.isLink()) return;
      const magnet = evt.target?.closest?.('[magnet]');
      if (magnet && magnet.getAttribute('magnet') !== 'false') return;
      evt.stopPropagation();
      evt.preventDefault();
      const el = cellView.el as SVGGElement;
      const t = el.getAttribute('transform') || 'translate(0,0)';
      const m = t.match(/translate\(([\d.-]+),\s*([\d.-]+)\)/);
      const startX = evt.clientX, startY = evt.clientY;
      const origX = m ? parseFloat(m[1]) : 0;
      const origY = m ? parseFloat(m[2]) : 0;
      const onMove = (e: MouseEvent) => {
        const nx = origX + (e.clientX - startX);
        const ny = origY + (e.clientY - startY);
        el.setAttribute('transform', `translate(${nx},${ny})`);
      };
      const onUp = () => {
        cellView.model.set('position', { x: origX + (evt.clientX - startX), y: origY + (evt.clientY - startY) });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Size paper — use parent (canvas area) dimensions directly
    const resize = () => {
      const parent = wrapper.parentElement!;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      paper.setDimensions(w, h);
    };
    resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 200);
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper.parentElement!);

    wrapper.style.backgroundColor = theme === 'dark' ? '#1e1e2e' : '#ffffff';

    return () => {
      console.log('[sandbox] cleanup');
      ro.disconnect();
      try { circuit.stop(); } catch {}
      paper.remove();
    };
  }, [activeFile?.id, theme]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleNew = () => {
    const f = sandboxStore.create(`circuit_${files.length + 1}`);
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
    refreshList();
  };

  const handleOpen = (f: SandboxFile) => {
    // Save current before switching
    if (activeFile && paperRef.current) {
      sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    }
    sandboxStore.setActiveId(f.id);
    setActiveFile(f);
  };

  const handleSave = () => {
    if (!activeFile || !paperRef.current) return;
    sandboxStore.save(activeFile.id, JSON.stringify(paperRef.current.model.toJSON()));
    refreshList();
    forceUpdate(n => n + 1);
  };

  const handleDelete = (f: SandboxFile) => {
    if (!confirm(`Delete ${f.name}?`)) return;
    sandboxStore.remove(f.id);
    if (activeFile?.id === f.id) setActiveFile(null);
    refreshList();
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* Left panel: file list + palette */}
      <div style={{
        width: 180, borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        background: 'var(--surface)',
      }}>
        {/* File list */}
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
              <span onClick={(e) => { e.stopPropagation(); handleDelete(f); }}
                style={{ cursor: 'pointer', opacity: 0.5, marginLeft: 4 }}>×</span>
            </div>
          ))}
          {files.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '4px 0' }}>No files yet</div>
          )}
        </div>

        {/* Palette */}
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
        </div>

        {/* Save button */}
        <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={handleSave} disabled={!activeFile}
            style={{ width: '100%', padding: '6px', background: activeFile ? 'var(--accent)' : 'var(--border)',
              color: activeFile ? '#fff' : 'var(--text-muted)', border: 'none', borderRadius: 4, cursor: activeFile ? 'pointer' : 'not-allowed',
              fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
            {activeFile ? `Save ${activeFile.name}` : 'Open a file first'}
          </button>
        </div>
      </div>

      {/* Canvas */}
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
