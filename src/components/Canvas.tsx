import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';

export interface CanvasHandle {
  resetZoom: () => void;
  fitToWindow: () => void;
}

interface CanvasProps {
  circuitJson: any;
  theme: 'dark' | 'light';
  onError: (msg: string) => void;
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { circuitJson, theme, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const circuitRef = useRef<any | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  const applyTransform = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const { x, y } = panRef.current;
    const z = zoomRef.current;
    wrapper.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    wrapper.style.transformOrigin = '0 0';
  }, []);

  // Apply theme to the DigitalJS paper element background
  const applyThemeToPaper = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // Try .joint-paper first, then .djs (DigitalJS adds this class), then any SVG
    const paper =
      (wrapper.querySelector('.joint-paper') as HTMLElement | null) ||
      (wrapper.querySelector('.djs') as HTMLElement | null) ||
      (wrapper.querySelector('svg') as HTMLElement | null);
    if (!paper) return;

    const bgColor = theme === 'dark' ? '#1e1e1e' : '#ffffff';
    paper.style.backgroundColor = bgColor;
    paper.style.setProperty('background-color', bgColor, 'important');

    // Also set the wrapper background as fallback
    wrapper.style.backgroundColor = bgColor;

    // Toggle theme classes for potential future use
    if (theme === 'dark') {
      paper.classList.add('joint-theme-dark');
      paper.classList.remove('joint-theme-default');
    } else {
      paper.classList.add('joint-theme-default');
      paper.classList.remove('joint-theme-dark');
    }
  }, [theme]);

  // Update paper theme when theme changes
  useEffect(() => {
    applyThemeToPaper();
  }, [theme, applyThemeToPaper]);

  // Fit the circuit to fill the container at initial scale
  const fitToWindow = useCallback(() => {
    const el = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!el || !wrapper) return;

    const svg = wrapper.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    const containerRect = el.getBoundingClientRect();
    let svgW = 0;
    let svgH = 0;

    const widthAttr = svg.getAttribute('width');
    const heightAttr = svg.getAttribute('height');
    if (widthAttr && heightAttr) {
      svgW = parseFloat(widthAttr);
      svgH = parseFloat(heightAttr);
    }

    if (svgW <= 0 || svgH <= 0) {
      try {
        const bbox = svg.getBBox();
        svgW = bbox.width;
        svgH = bbox.height;
      } catch {
        svgW = 800;
        svgH = 600;
      }
    }

    if (svgW <= 0 || svgH <= 0) return;

    const padding = 40;
    const scale = Math.min(
      (containerRect.width - padding * 2) / svgW,
      (containerRect.height - padding * 2) / svgH,
      1
    );
    zoomRef.current = scale;
    panRef.current = {
      x: (containerRect.width - svgW * scale) / 2,
      y: (containerRect.height - svgH * scale) / 2,
    };
    applyTransform();
  }, [applyTransform]);

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  useImperativeHandle(ref, () => ({ resetZoom, fitToWindow }), [resetZoom, fitToWindow]);

  // Initialize or update circuit
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !circuitJson) return;

    if (circuitRef.current) {
      try { circuitRef.current.stop?.(); } catch {}
      try { circuitRef.current.shutdown?.(); } catch {}
      circuitRef.current = null;
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

    try {
      const circuit = new window.digitaljs.Circuit(circuitJson, {
        layoutEngine: 'elkjs',
      });
      circuit.displayOn(wrapper);
      circuit.start();

      circuitRef.current = circuit;

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
        });
      });
    } catch (err: any) {
      onError(err.message || 'Failed to render circuit');
    }

    return () => {
      if (circuitRef.current) {
        try { circuitRef.current.stop?.(); } catch {}
        try { circuitRef.current.shutdown?.(); } catch {}
        circuitRef.current = null;
      }
    };
  }, [circuitJson, onError, fitToWindow, applyThemeToPaper]);

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
        background: 'var(--canvas-bg)',
        overflow: 'hidden',
        position: 'relative',
      }}
    />
  );
});

export default Canvas;