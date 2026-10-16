// 统一调用层（src/lib/host/*）的单测安全网。
// 为什么这批值得钉：宿主探测与"不支持=抛错"这两条形状一旦改坏，后果不是"报错"而是**静默换路径**——
// ① 探测在模块加载期求值 ⇒ r12 的 [F] 三格（点击前注入 `acquireVsCodeApi` 桩验原生另存为）永远测不到
//    vscode 分支，绿灯是假的；② browserHost 若把"不支持"做成"返回空结果"，调用方的
//    `.catch(console.warn)` 会把失败当成功吞掉。两条都在无头环境里可判，⛔ 留给浏览器闸门。
// 片 5（全面原生）：接口 18 颗收到 6 颗——文件 CRUD/配置/剪贴板那批随旧 React UI 退役，
// 现在的面＝getConfig / saveExportFile / publishProblems / appendOutput / copyToSandbox / jumpToSource。
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Handler = (ev: any) => void;

/** 造一颗最小可用的假 window：带 message 监听表与宿主标记开关 */
function makeWindow(marks: { vscode?: boolean } = {}) {
  const listeners: Record<string, Handler[]> = {};
  const win: any = {
    addEventListener: (type: string, fn: Handler) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type: string, fn: Handler) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    __fire: (type: string, data: any) => { for (const f of (listeners[type] || [])) f({ data }); },
    __listenerCount: (type: string) => (listeners[type] || []).length,
  };
  if (marks.vscode) win.acquireVsCodeApi = () => ({ postMessage: () => { }, getState: () => undefined, setState: () => { } });
  return win;
}

const setWindow = (w: any) => { (globalThis as any).window = w; };

beforeEach(() => { vi.resetModules(); });
afterEach(() => { delete (globalThis as any).window; });

describe('宿主探测（每次现读，⛔ 模块加载期求值）', () => {
  it('两档标记各归一个宿主，且**同一模块实例**内随标记变化而变', async () => {
    setWindow(makeWindow({}));
    const host = await import('../../src/lib/host/host');
    expect(host.hostId()).toBe('browser');
    (globalThis as any).window.acquireVsCodeApi = () => ({ postMessage: () => { } });
    expect(host.hostId()).toBe('vscode');          // r12 [F] 靠的就是这一变
    delete (globalThis as any).window.acquireVsCodeApi;
    expect(host.hostId()).toBe('browser');         // 桩撤掉也必须能变回来（⛔ 记牢第一次的结果）
  });

  it('getHost() 按当前宿主换实现（缓存 keyed by id，不是"第一次算完就不管"）', async () => {
    setWindow(makeWindow({}));
    const host = await import('../../src/lib/host/host');
    expect((await host.getHost()).id).toBe('browser');
  });

  it('没有 window（纯 Node / SSR 角）时不炸，判成 browser', async () => {
    delete (globalThis as any).window;
    const host = await import('../../src/lib/host/host');
    expect(host.hostId()).toBe('browser');
  });
});

describe('browserHost：不支持必须抛，⛔ 返回空结果', () => {
  it('能力类方法全部 reject（HostUnsupported）', async () => {
    setWindow(makeWindow({}));
    const { browserHost } = await import('../../src/lib/host/browserHost');
    const calls: Array<Promise<unknown>> = [
      browserHost.copyToSandbox([{ name: 'a.djs', content: '{}' }]),
      browserHost.importLegacyData([{ name: 'a.v', content: 'x' }]),
      browserHost.getAllBindings(),
      browserHost.setDocBindings('a.djs', {}),
      browserHost.jumpToSource('a.v', 3),
    ];
    for (const p of calls) {
      await expect(p).rejects.toThrow(/不支持/);
      await expect(p).rejects.toMatchObject({ name: 'HostUnsupported' });
    }
  });

  it('Problems/Output 是 no-op（浏览器无 workbench 可挂，resolve 掉让调用方无感）', async () => {
    setWindow(makeWindow({}));
    const { browserHost } = await import('../../src/lib/host/browserHost');
    await expect(browserHost.publishProblems([{ fileName: 'a.v', line: null, message: 'x', severity: 'error' }])).resolves.toBeUndefined();
    await expect(browserHost.appendOutput('log\n')).resolves.toBeUndefined();
  });

  it('getConfig 回默认值（浏览器没有 Settings UI，画布要能起）', async () => {
    setWindow(makeWindow({}));
    const { browserHost } = await import('../../src/lib/host/browserHost');
    const cfg = await browserHost.getConfig();
    expect(cfg.sandbox.wireStyle).toBe('metro');
    expect(cfg.compile.autoRecompile).toBe(true);
  });

  it('导出走 <a download>：文件名与 mime 都按调用方给的走，返回 true', async () => {
    const win = makeWindow({});
    const clicks: string[] = [];
    (win as any).document = {
      createElement: (tag: string) => {
        const el: any = { tagName: tag, style: {}, click: () => { clicks.push(el.download); }, remove: () => { } };
        return el;
      },
      body: { appendChild: () => { }, removeChild: () => { } },
    };
    setWindow(win);
    (globalThis as any).document = (win as any).document;
    (globalThis as any).URL = Object.assign(globalThis.URL || {}, {
      createObjectURL: (b: any) => { (win as any).__blobType = b.type; return 'blob:fake'; },
      revokeObjectURL: () => { },
    });
    const { browserHost } = await import('../../src/lib/host/browserHost');
    const okFlag = await browserHost.saveExportFile(new TextEncoder().encode('<svg/>'), 'a_circuit.svg', 'image/svg+xml;charset=utf-8');
    expect(okFlag).toBe(true);
    expect(clicks).toEqual(['a_circuit.svg']);
    expect((win as any).__blobType).toBe('image/svg+xml;charset=utf-8'); // mime 不许在宿主层丢掉
    delete (globalThis as any).document;
  });
});

describe('vscodeHost：Webview RPC 的形状', () => {
  let sent: any[] = [];
  let win: any;

  async function load() {
    win = makeWindow({ vscode: true });
    sent = [];
    win.acquireVsCodeApi = () => ({ postMessage: (m: any) => sent.push(m) });
    setWindow(win);
    return await import('../../src/lib/host/vscodeHost');
  }

  it('请求带自增 id 与方法名；应答按 id 认领（并发两问不许串号）', async () => {
    const { vscodeHost } = await load();
    const p1 = vscodeHost.copyToSandbox([{ name: '我的电路.djs', content: '{"cells":[]}' }]);
    const p2 = vscodeHost.getConfig();
    expect(sent.length).toBe(2);
    expect(sent[0].method).toBe('copyToSandbox');
    expect(sent[0].args).toEqual({ files: [{ name: '我的电路.djs', content: '{"cells":[]}' }] });
    expect(sent[1].id).not.toBe(sent[0].id);
    // 后到的问题先答：谁认领自己的 id
    win.__fire('message', { vvh: 'res', id: sent[1].id, ok: true, data: { compile: {}, sandbox: {} } });
    win.__fire('message', { vvh: 'res', id: sent[0].id, ok: true, data: ['我的电路.djs'] });
    expect((await p2).sandbox).toEqual({});
    expect(await p1).toEqual(['我的电路.djs']);
  });

  it('ok:false 转成 Error（带宿主给的话），不静默 resolve', async () => {
    const { vscodeHost } = await load();
    const p = vscodeHost.jumpToSource('x.v', 1);
    win.__fire('message', { vvh: 'res', id: sent[0].id, ok: false, error: '没有权限' });
    await expect(p).rejects.toThrow('没有权限');
  });

  it('没人应答会超时 reject（⛔ 让调用方永远挂着）', async () => {
    vi.useFakeTimers();
    try {
      const { vscodeHost } = await load();
      const p = vscodeHost.getConfig();
      let settled = 'pending';
      p.then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });
      await vi.advanceTimersByTimeAsync(21000);   // 默认 20s
      expect(settled).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('导出字节走 base64（webview 消息是 JSON 序列化的，⛔ 直接发 Uint8Array）', async () => {
    const { vscodeHost } = await load();
    const big = new Uint8Array(40000).fill(65);   // 超过分块阈值 0x8000 才看得出没栈溢出
    const p = vscodeHost.saveExportFile(big, 'c.svg', 'image/svg+xml');
    expect(sent[0].method).toBe('saveExportFile');
    expect(typeof sent[0].args.base64).toBe('string');
    expect(atob(sent[0].args.base64).length).toBe(40000);
    win.__fire('message', { vvh: 'res', id: sent[0].id, ok: true, data: false });  // 用户取消＝正常回 false
    expect(await p).toBe(false);
  });
});

describe('hostFire：fire-and-forget 的留痕语义', () => {
  it('宿主不支持时只 warn，且 warn 前缀原样保留（那些 "Failed to ..." 是有人在读的）', async () => {
    setWindow(makeWindow({}));
    const { hostFire } = await import('../../src/lib/host/host');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    hostFire('Failed to copy circuit to sandbox:', (h) => h.copyToSandbox([{ name: 'a.djs', content: '{}' }]));
    await new Promise((r) => setTimeout(r, 10));        // 等那条后台 promise 落地
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('Failed to copy circuit to sandbox:');
    expect(warn.mock.calls[0][1]).toBeInstanceOf(Error);
    warn.mockRestore();
  });

  it('成功路径不打扰调用方（不返回 promise、不抛）', async () => {
    setWindow(makeWindow({}));
    const { hostFire } = await import('../../src/lib/host/host');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const ran: string[] = [];
    hostFire('ok', (h) => { ran.push(h.id); return Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toEqual(['browser']);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
