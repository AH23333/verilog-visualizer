// Live waveform viewer — samples named nets from the running digitaljs engine
import { X } from 'lucide-react';
// (poll link.get('signal') + circuit.tick) and renders a scrolling digital
// waveform. Self-drawn canvas; no joint/MonitorView coupling (per feasibility doc).

import { useEffect, useRef, useState, useCallback } from 'react';

interface WaveformPanelProps {
  getChannels: () => { name: string; bits: number }[];
  getSample: () => { tick: number; values: Record<string, string> } | null;
  /** change to reset history (new circuit / drill) */
  resetKey: string;
  onClose: () => void;
}

const WINDOW_TICKS = 600;     // visible time span
const ROW_H = 26;
const GUTTER = 110;
const POLL_MS = 60;

interface Transition { t: number; v: string }

function hexVal(bin: string): string {
  if (!bin || /[xz]/i.test(bin)) return 'x';
  const n = parseInt(bin, 2);
  return isNaN(n) ? 'x' : n.toString(16);
}

export default function WaveformPanel({ getChannels, getSample, resetKey, onClose }: WaveformPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const histRef = useRef<Map<string, Transition[]>>(new Map());
  const lastRef = useRef<Map<string, string>>(new Map());
  const curTickRef = useRef(0);
  const [channels, setChannels] = useState<{ name: string; bits: number }[]>([]);

  // reset history when the displayed circuit changes
  useEffect(() => {
    histRef.current = new Map();
    lastRef.current = new Map();
    const chs = getChannels();
    setChannels(chs);
    for (const c of chs) histRef.current.set(c.name, []);
  }, [resetKey, getChannels]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = channels.length * ROW_H + 26;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--canvas-bg').trim() || '#0d0d13';
    const fg = css.getPropertyValue('--text-muted').trim() || '#888';
    const accent = css.getPropertyValue('--accent').trim() || '#6366f1';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const t1 = curTickRef.current;
    const t0 = t1 - WINDOW_TICKS;
    const plotW = W - GUTTER - 8;
    const x = (t: number) => GUTTER + Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) * plotW;

    channels.forEach((ch, i) => {
      const base = 20 + i * ROW_H;
      ctx.fillStyle = fg;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(ch.name.slice(0, 15), 6, base + 4);

      const hist = histRef.current.get(ch.name) || [];
      if (ch.bits === 1) {
        ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 1;
        ctx.beginPath();
        let started = false;
        let prevY = 0;
        for (const tr of hist) {
          const px = x(tr.t);
          const py = tr.v[0] === '1' ? base - 7 : tr.v[0] === '0' ? base + 5 : base - 1;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else { ctx.lineTo(px, prevY); ctx.lineTo(px, py); }
          prevY = py;
        }
        ctx.stroke();
      } else {
        // bus: alternate shaded segments + hex labels
        ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = 1;
        let idx = 0;
        for (const tr of hist) {
          const xa = x(tr.t), xb = x(idx + 1 < hist.length ? hist[idx + 1].t : t1);
          if (xb - xa > 1) {
            ctx.globalAlpha = idx % 2 === 0 ? 0.35 : 0.12;
            ctx.beginPath();
            const off = xb - xa > 8 ? 4 : 0;
            ctx.moveTo(xa + off, base - 7); ctx.lineTo(xb, base - 7); ctx.lineTo(xb - off, base + 5); ctx.lineTo(xa, base + 5);
            ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
            if (xb - xa > 26) { ctx.fillStyle = fg; ctx.fillText('h' + hexVal(tr.v), xa + off + 3, base + 3); ctx.fillStyle = accent; }
          }
          idx++;
        }
        ctx.globalAlpha = 1;
      }
    });
  }, [channels]);

  // poll + redraw
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = getSample();
      if (!s) return;
      curTickRef.current = s.tick;
      for (const [name, v] of Object.entries(s.values)) {
        const last = lastRef.current.get(name);
        const hist = histRef.current.get(name);
        if (!hist) continue;
        if (last === undefined) { hist.push({ t: s.tick, v }); lastRef.current.set(name, v); }
        else if (last !== v) { hist.push({ t: s.tick, v }); lastRef.current.set(name, v); }
        if (hist.length > 900) hist.splice(0, hist.length - 900);
      }
      draw();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [getSample, draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', maxHeight: 240 }}>
      <div className="flex items-center justify-between" style={{ padding: '4px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[0.75rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Waveform {channels.length === 0 && '— no named nets'}
        </span>
        <button onClick={onClose} title="Close waveform"
          className="border-0 cursor-pointer px-2 py-0.5 rounded text-[0.9rem]"
          style={{ background: 'transparent', color: 'var(--text-muted)' }}><X size={14} /></button>
      </div>
      <div ref={wrapRef} style={{ overflowY: 'auto', padding: '2px 0' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
