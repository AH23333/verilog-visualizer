// MCP 活编辑器桥·协议台架（批次三 A 案）：handleMcpLine 纯函数直调（闸行为）＋
// 管道名算法双源锁（mcpBridge.ts ↔ mcp/mcp-server.cjs 逐字对齐——两边各算各的，漂一字符＝桥永远连不上，
// 所以读源码文本比函数，⛔ 运行期互 require）。管道真往返归真宿主 harness（net 真模块）。
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
type Stub = typeof import('./vscodeApiStub');
const GLOBAL_HOME = 'C:/Users/x/AppData/Roaming/VV/User/globalStorage/local.verilog-visualizer-vscode';
const EXT_DIR = 'D:/vv-studio/vscode/extensions/verilog-visualizer';

let vscode: Stub;
beforeEach(async () => {
  vi.resetModules();
  vscode = await import('vscode') as unknown as Stub;
  vscode.resetMachine({ workspaceFolders: [{ uri: vscode.Uri.file('D:/p'), name: 'p', index: 0 }] });
  const { __resetAuditForTest } = await import('../../extension/src/apiAudit');
  __resetAuditForTest();
  (await import('../../extension/src/toolsFs')).registerFilesystemTools();
  (await import('../../extension/src/toolsDomain')).registerDomainTools();
  (await import('../../extension/src/dispatch')).registerRpcTools();
});

const ctx = () => ({
  subscriptions: [] as any[],
  extensionUri: vscode.Uri.file(EXT_DIR),
  globalStorageUri: vscode.Uri.file(GLOBAL_HOME),
  extensionMode: 1,
});

/** 打一行协议进 handleMcpLine，拿回解析后的回包对象 */
async function line(req: unknown): Promise<any> {
  const { handleMcpLine } = await import('../../extension/src/mcpBridge');
  return JSON.parse(await handleMcpLine(ctx() as any, typeof req === 'string' ? req : JSON.stringify(req)));
}

describe('MCP 桥·管道名算法双源锁', () => {
  // 只比函数体（TS 侧签名带类型注解，CJS 侧没有——签名逐字比＝必红；算法全在体内）。
  const grab = (src: string): string => {
    const m = /const norm =[\s\S]*?vv-mcp-\$\{h\}\.sock`\);/.exec(src);
    expect(m, 'pipeNameFor 算法体必须找得到（⛔ 正则失配造成的空对空恒绿）').toBeTruthy();
    return m![0].replace(/\s+/g, ' ').trim();
  };
  it('服务端与桥脚本的算法逐字同文（归一空白后相等）', () => {
    expect(grab(fs.readFileSync(path.join(ROOT, 'extension/src/mcpBridge.ts'), 'utf8')))
      .toBe(grab(fs.readFileSync(path.join(ROOT, 'mcp/mcp-server.cjs'), 'utf8')));
  });
  it('形状与归一：大小写/正反斜杠/尾斜杠同根同管；win 走 \\\\.\\pipe', async () => {
    const { pipeNameFor } = await import('../../extension/src/mcpBridge');
    expect(pipeNameFor('D:\\p')).toBe(pipeNameFor('d:/p/'));
    expect(pipeNameFor('D:/p')).not.toBe(pipeNameFor('D:/pp'));
    expect(pipeNameFor('D:/p')).toMatch(process.platform === 'win32'
      ? /^\\\\\.\\pipe\\vv-mcp-[0-9a-f]{12}$/ : /vv-mcp-[0-9a-f]{12}\.sock$/);
  });
});

describe('MCP 桥·协议与闸行为（caller 固化 mcp/agent/非交互）', () => {
  it('只读工具放行：bindings.get 回 ok+result', async () => {
    vscode.seedText('D:/p/.verilogviz.json', JSON.stringify({ circuits: [], bindings: { 'top.v::adder': 'adder.v' } }));
    const r = await line({ id: 1, tool: 'bindings.get', args: { doc: 'top.v' } });
    expect(r.ok).toBe(true);
    expect(r.result.bindings['top.v::adder']).toBe('adder.v');
    expect(r.id).toBe(1);
  });
  it('写工具在 mcp 面**执行**（2026-10-19 拍板写面放开；闸②开放后走全闸链，执行单同样带调用号）', async () => {
    const r = await line({ id: 2, tool: 'bindings.set', args: { celltype: 'adder', part: 'adder.v' } });
    expect(r.ok).toBe(true);
    // 成功回包不带 traceId（traceId 在审计账上，错误回包才带）——写了要看得见：回读绑定表
    const g = await line({ id: 21, tool: 'bindings.get', args: { doc: 'top.v' } });
    expect(g.ok).toBe(true);
    expect(JSON.stringify(g.result)).toContain('adder.v');
  });
  it('fs.delete（HITL）在 mcp 面：面闸开放后审批闸生效——非交互调用＝NOT_APPROVED', async () => {
    const r = await line({ id: 3, tool: 'fs.delete', args: { uri: 'D:/p/x.v' } });
    expect(r.code).toBe('NOT_APPROVED');
  });
  it('未登记工具＝NOT_REGISTERED（registry∧契约双查）', async () => {
    const r = await line({ id: 4, tool: 'nope.such', args: {} });
    expect(r.code).toBe('NOT_REGISTERED');
  });
  it('缺必填＝BAD_ARGS（实参形状当场点名列）', async () => {
    const r = await line({ id: 5, tool: 'bindings.audit', args: {} });
    expect(r.code).toBe('BAD_ARGS');
    expect(r.message).toContain('doc');
  });
  it('烂行＝BAD_REQUEST（⛔ 抛穿连接）', async () => {
    expect((await line('not json at all')).code).toBe('BAD_REQUEST');
    expect((await line({ id: 6, args: {} })).code).toBe('BAD_REQUEST');   // 缺 tool
  });
  it('sys.getStatus：mcp 总开关在账（开闸的事实源＝契约）', async () => {
    const r = await line({ id: 7, tool: 'sys.getStatus', args: {} });
    expect(r.ok).toBe(true);
    expect(r.result.surfacesGlobal.mcp).toBe(true);
    expect(r.result.projectRoot).toBe('D:/p');
  });
});
