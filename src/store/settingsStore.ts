// Global settings store
// Manages font size, default view mode, and other UI preferences

const FONT_SIZE_KEY = 'verilog-viz-font-size';
const DEFAULT_VIEW_KEY = 'verilog-viz-default-view';

export type ViewMode = 'circuit' | 'code';

function getSavedFontSize(): number {
  try {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (n >= 8 && n <= 36) return n;
    }
  } catch {}
  return 13;
}

function getSavedDefaultView(): ViewMode {
  try {
    const saved = localStorage.getItem(DEFAULT_VIEW_KEY);
    if (saved === 'code' || saved === 'circuit') return saved;
  } catch {}
  return 'circuit';
}

let fontSize: number = getSavedFontSize();
let defaultViewMode: ViewMode = getSavedDefaultView();
let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach((fn) => fn());
}

// Apply font size to document root
function applyFontSize(size: number) {
  document.documentElement.style.fontSize = `${size}px`;
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
}

applyFontSize(fontSize);

export const settingsStore = {
  getFontSize(): number {
    return fontSize;
  },

  setFontSize(size: number): void {
    fontSize = Math.min(36, Math.max(8, size));
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    applyFontSize(fontSize);
    notify();
  },

  increaseFontSize(): void {
    this.setFontSize(fontSize + 1);
  },

  decreaseFontSize(): void {
    this.setFontSize(fontSize - 1);
  },

  resetFontSize(): void {
    this.setFontSize(13);
  },

  getDefaultViewMode(): ViewMode {
    return defaultViewMode;
  },

  setDefaultViewMode(mode: ViewMode): void {
    defaultViewMode = mode;
    localStorage.setItem(DEFAULT_VIEW_KEY, mode);
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};