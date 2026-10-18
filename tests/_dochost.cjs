// 浏览器侧的**假宿主**（片 C5）：一张会说话的工作区。
//
// 为什么要这颗：`.djs` 的真身已经搬到工作区文件，文档编辑器（`doc.html`）与画布之间只剩两条线——
// `{vvh:'req'}` RPC（9 颗，正本 `extension/src/dispatch.ts`）与 `{vvh:'doc'}` 推送
// （init/revert ⇄ ready/edit，正本 `extension/src/customEditors.ts` + `src/doc/DocApp.tsx`）。
// 老闸门在浏览器里量的是「旧 React 单页 + localStorage 沙盒库」那条已退役的路，于是整族红；
// 而真壳（`pnpm app`）里我又⛔ 逐格自动点。⇒ 正解是给 webview 造一颗**同协议**的假宿主：
//  · 文件表落 `localStorage['vv-fake-fs']`＝跨 reload 存活 ⇒ 「编辑→保存→刷新→重开」第一次能在浏览器里真验；
//  · `window.__vvHost` 把 RPC 流水/落盘正文/doc 消息序全交回判据（读的是**发出去的字节**，⛔ 猜）。
//
// ⚠ 这颗⛔ 是产品代码的替身，只在 `tests/` 下用；产品那侧的主人是 `dispatch.ts` + `customEditors.ts`。
// ⚠ `acquireVsCodeApi` 必须**在应用挂载前**就挂在 window 上：DocApp 在 mount 的 `ready` 握手时 lazy 取一次
//   （`src/doc/DocApp.tsx` 的 bridge），`getHost()` 也按那颗决定宿主 ⇒ 只能走 `page.addInitScript`。
const DOC_URL = (port) => `http://localhost:${port}/doc.html`;

// 形状正本＝`src/lib/host/host.ts` 的 HostConfig（缺字段会被 settingsStore 读成 undefined）
const DEFAULT_CONFIG = {
  compile: { topModule: '', yosysOptions: '', noFlatten: false, noOpt: false, autoRecompile: false },
  sandbox: {},
  bindings: { policy: 'auto' },
  editorFontSize: 12,
};

/**
 * 装假宿主。`seed = { seedId, docName, files: { 'dir/x.djs': 正文 }, roles?: {名:'circuit'}, config? }`。
 * `seedId` 换＝重铺磁盘；同一颗 seedId 下 reload＝沿用已落盘正文（持久化判据要的正是这个语义）。
 * `docName` 由测试给：真宿主知道自己在开哪颗文档（是它建的 webview），`ready` 握手⛔ 带这个名字。
 */
async function installFakeHost(page, seed) {
  if (!seed || !seed.seedId || !seed.docName) throw new Error('installFakeHost 要 seedId + docName');
  await page.addInitScript((s) => {
    const KEY = 'vv-fake-fs';
    const MARK = 'vv-fake-fs-seed';
    const CFG = {
      compile: { topModule: '', yosysOptions: '', noFlatten: false, noOpt: false, autoRecompile: false },
      sandbox: {}, bindings: { policy: 'auto' }, editorFontSize: 12,
    };
    let cur = null;
    try { cur = localStorage.getItem(MARK); } catch { cur = null; }
    if (cur !== s.seedId) {
      try {
        localStorage.setItem(KEY, JSON.stringify(s.files || {}));
        localStorage.setItem(MARK, s.seedId);
      } catch { /* about:blank 之类没有 localStorage 的文档：下面全靠闭包内读写兜底 */ }
    }
    const mem = {};                                  // localStorage 读不到时的兜底盘
    const readFs = () => {
      try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : Object.assign({}, mem); }
      catch { return Object.assign({}, mem); }
    };
    const writeFs = (fs) => {
      try { localStorage.setItem(KEY, JSON.stringify(fs)); } catch { /* 换个写法继续活 */ }
      Object.keys(mem).forEach((k) => delete mem[k]);
      Object.assign(mem, fs);
    };
    const hist = { reqs: [], edits: [], problems: [], outputs: [], docMessages: [], unknown: [] };
    window.__vvHost = { files: readFs(), docName: s.docName, hist, get lastEdit() { return hist.edits.length ? hist.edits[hist.edits.length - 1] : null; } };
    const reply = (id, data, err) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
      data: err ? { vvh: 'res', id, ok: false, error: err } : { vvh: 'res', id, ok: true, data },
    })), 0);
    // 落盘名算法照抄宿主：无扩展名补 `.djs`（dispatch 的 copyToSandbox / importLegacyData 分支）
    const withDjs = (n) => (/\.[A-Za-z0-9]+$/.test(n) ? n : `${n}.djs`);
    const siblings = (fs, exclude) => Object.entries(fs)
      .filter(([n]) => n.endsWith('.djs') && n !== exclude)
      .map(([n, content]) => ({ name: n, content, role: (s.roles && s.roles[n]) || 'part' }));
    const sendDoc = (op) => {
      const fs = readFs();
      window.__vvHost.files = fs;
      window.dispatchEvent(new MessageEvent('message', {
        data: { vvh: 'doc', op, docName: s.docName, content: fs[s.docName] ?? '', siblings: siblings(fs, s.docName) },
      }));
    };
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.vvh === 'req' && m.id) {
          const args = m.args || {};
          hist.reqs.push(m.method);
          if (m.method === 'copyToSandbox' || m.method === 'importLegacyData') {
            const fs = readFs();
            const written = (args.files || args.items || []).map((f) => {
              const n = withDjs(String(f.name)); fs[n] = String(f.content ?? ''); return n;
            });
            writeFs(fs); window.__vvHost.files = fs;
            return reply(m.id, written);
          }
          if (m.method === 'getAllBindings') return reply(m.id, {});
          if (m.method === 'setDocBindings') return reply(m.id, null);
          if (m.method === 'getConfig') return reply(m.id, s.config || CFG);
          if (m.method === 'saveExportFile') return reply(m.id, true);
          if (m.method === 'publishProblems') { hist.problems.push(args.items || []); return reply(m.id, null); }
          if (m.method === 'appendOutput') { hist.outputs.push(String(args.text || '')); return reply(m.id, null); }
          if (m.method === 'jumpToSource') return reply(m.id, null);
          hist.unknown.push(m.method);
          return reply(m.id, null, `假宿主不认识的调用：${m.method}`);
        }
        if (m.vvh === 'doc') {
          hist.docMessages.push(m.op);
          if (m.op === 'ready') return sendDoc('init');
          if (m.op === 'edit') {
            const fs = readFs();
            fs[s.docName] = String(m.content ?? '');
            writeFs(fs); window.__vvHost.files = fs;
            hist.edits.push(String(m.content ?? ''));
            return;
          }
          if (m.op === 'completeBindings') {
            window.dispatchEvent(new MessageEvent('message', { data: { vvh: 'doc', op: 'bindingsWritten' } }));
          }
        }
      },
      getState: () => window.__vvState,
      setState: (v) => { window.__vvState = v; },
    });
  }, Object.assign({ config: DEFAULT_CONFIG }, seed));
}

/** 开 doc 入口并等文档编辑器把画布挂出来（`data-sandbox-sidebar`／`data-sandbox-wrapper` 是 SandboxCanvas 的锚点）。 */
async function bootDoc(page, port, { settle = 2600 } = {}) {
  await page.goto(DOC_URL(port), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('[data-sandbox-sidebar]') || !!document.querySelector('[data-sandbox-wrapper]'), null, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, settle));
}

/** 入口自证用的屏幕读数（三颗 doc 档共用一份，⛔ 各写一遍 querySelector 形状）。 */
async function mountProbe(page) {
  return page.evaluate(() => ({
    paper: !!window.__sandboxPaper,
    sidebar: !!document.querySelector('[data-sandbox-sidebar]'),
    gates: document.querySelectorAll('button[data-gate]').length,
    toolbar: !!document.querySelector('button[title="运行 / 暂停仿真"]'),
    cells: window.__sandboxPaper ? window.__sandboxPaper.model.getCells().length : -1,
  }));
}

/** 交回假宿主读到的一切（正文＝**发出去过的字节**，⛔ 再从别处复算） */
async function fakeHostReadout(page) {
  return page.evaluate(() => {
    const h = window.__vvHost;
    if (!h) return null;
    return {
      files: h.files,
      lastEdit: h.lastEdit,
      reqs: h.hist.reqs.slice(),
      unknown: h.hist.unknown.slice(),
      edits: h.hist.edits.length,
      problems: h.hist.problems.length,
      outputs: h.hist.outputs.length,
      docMessages: h.hist.docMessages.slice(),
    };
  });
}

module.exports = { installFakeHost, bootDoc, fakeHostReadout, mountProbe, DOC_URL, DEFAULT_CONFIG };
