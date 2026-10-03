import { useState } from 'react';
import { Cpu, Play, MousePointerClick, ArrowRight, X } from 'lucide-react';

interface OnboardingDialogProps {
  onClose: () => void;
  onOpenExample: () => void;
}

const STEPS = [
  {
    icon: <MousePointerClick size={28} />,
    title: '1. Pick an example',
    body: 'Open the Examples gallery (or press Ctrl+N to start from scratch). We ship 5 known-good designs — an AND gate up to a 4-bit counter.',
  },
  {
    icon: <Cpu size={28} />,
    title: '2. Watch it synthesize',
    body: 'Yosys (running entirely in your browser via WASM) compiles the Verilog to a gate-level netlist, then digitaljs renders the interactive schematic.',
  },
  {
    icon: <Play size={28} />,
    title: '3. Toggle switches to simulate',
    body: 'Click the green buttons (inputs / clock) to drive signals. Lamps and numeric displays light up in real time. Double-click any gate to jump back to its source line.',
  },
];

export default function OnboardingDialog({ onClose, onOpenExample }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;

  const next = () => {
    if (isLast) { finish(); return; }
    setStep((s) => s + 1);
  };

  const finish = () => {
    try { localStorage.setItem('verilog-viz-onboarded', '1'); } catch {}
    onClose();
  };

  const stepData = STEPS[step];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={finish}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, maxWidth: '92vw',
          background: 'var(--dropdown-bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 28,
          animation: 'scaleIn 160ms ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 'var(--radius-md)',
            background: 'var(--accent-muted)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {stepData.icon}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 'var(--fs-lg)', color: 'var(--text)' }}>
              {stepData.title}
            </h2>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              {stepData.body}
            </p>
          </div>
          <button onClick={finish} className="icon-btn" style={{ width: 22, height: 22, color: 'var(--text-muted)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Dots */}
        <div style={{ display: 'flex', gap: 6, marginTop: 20 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? 'var(--accent)' : 'var(--border)',
              transition: 'all var(--transition-fast)',
            }} />
          ))}
          <span style={{ flex: 1 }} />
          <button
            onClick={finish}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: '4px 8px',
            }}
          >
            Skip
          </button>
          {step === 0 && (
            <button
              onClick={() => { finish(); onOpenExample(); }}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                color: 'var(--text)', fontSize: 'var(--fs-sm)', padding: '4px 12px',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              Open Examples <ArrowRight size={13} />
            </button>
          )}
          {step > 0 && (
            <button
              onClick={next}
              style={{
                background: 'var(--accent)', border: 'none',
                borderRadius: 'var(--radius-md)', cursor: 'pointer',
                color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600,
                padding: '4px 14px',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {isLast ? 'Get Started' : 'Next'} <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
