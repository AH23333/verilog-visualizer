// Theme store: light/dark mode with CSS variable support

export type Theme = 'dark' | 'light';

const THEME_KEY = 'verilog-viz-theme';

function getSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

let currentTheme: Theme = getSavedTheme();
let listeners: Array<() => void> = [];

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function notify() {
  listeners.forEach((fn) => fn());
}

// Apply on load
applyTheme(currentTheme);

export const themeStore = {
  get(): Theme {
    return currentTheme;
  },

  toggle(): Theme {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
    notify();
    return currentTheme;
  },

  set(theme: Theme): void {
    currentTheme = theme;
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};