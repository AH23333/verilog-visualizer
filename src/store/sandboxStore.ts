// Sandbox file system — independent from .v verilog files.
// Each .djs file stores a digitaljs circuit graph as JSON.

export interface SandboxFile {
  id: string;
  name: string;
  graphJson: string;  // serialized joint graph
  updatedAt: number;
}

// A user-defined gate: an inner circuit graph (with Input/Output cells as the
// interface) that can be placed into any sandbox file as a digitaljs Subcircuit.
export interface CustomGate {
  id: string;
  name: string;
  graphJson: string;  // serialized inner joint graph
}

const SANDBOX_KEY = 'verilog-viz-sandbox-files';
const SANDBOX_ACTIVE = 'verilog-viz-sandbox-active';
const GATES_KEY = 'verilog-viz-sandbox-gates';

function loadAll(): Record<string, SandboxFile> {
  try {
    const raw = localStorage.getItem(SANDBOX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAll(files: Record<string, SandboxFile>) {
  localStorage.setItem(SANDBOX_KEY, JSON.stringify(files));
}

export const sandboxStore = {
  list(): SandboxFile[] {
    const files = loadAll();
    return Object.values(files).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  get(id: string): SandboxFile | null {
    return loadAll()[id] ?? null;
  },

  getActiveId(): string | null {
    return localStorage.getItem(SANDBOX_ACTIVE);
  },

  setActiveId(id: string | null) {
    if (id) localStorage.setItem(SANDBOX_ACTIVE, id);
    else localStorage.removeItem(SANDBOX_ACTIVE);
  },

  create(name: string): SandboxFile {
    const files = loadAll();
    const id = 'sb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const file: SandboxFile = {
      id,
      name: name.endsWith('.djs') ? name : name + '.djs',
      graphJson: JSON.stringify({ cells: [] }),
      updatedAt: Date.now(),
    };
    files[id] = file;
    saveAll(files);
    return file;
  },

  save(id: string, graphJson: string) {
    const files = loadAll();
    if (!files[id]) return;
    files[id].graphJson = graphJson;
    files[id].updatedAt = Date.now();
    saveAll(files);
  },

  rename(id: string, name: string) {
    const files = loadAll();
    if (!files[id]) return;
    files[id].name = name.endsWith('.djs') ? name : name + '.djs';
    saveAll(files);
  },

  remove(id: string) {
    const files = loadAll();
    delete files[id];
    saveAll(files);
    if (localStorage.getItem(SANDBOX_ACTIVE) === id) localStorage.removeItem(SANDBOX_ACTIVE);
  },
};

function loadGates(): CustomGate[] {
  try {
    const raw = localStorage.getItem(GATES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveGates(gates: CustomGate[]) {
  localStorage.setItem(GATES_KEY, JSON.stringify(gates));
}

export const customGateStore = {
  list(): CustomGate[] {
    return loadGates().sort((a, b) => a.name.localeCompare(b.name));
  },

  get(id: string): CustomGate | null {
    return loadGates().find(g => g.id === id) ?? null;
  },

  save(name: string, graphJson: string): CustomGate {
    const gates = loadGates();
    const gate: CustomGate = {
      id: 'gate_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      graphJson,
    };
    gates.push(gate);
    saveGates(gates);
    return gate;
  },

  remove(id: string) {
    saveGates(loadGates().filter(g => g.id !== id));
  },
};
