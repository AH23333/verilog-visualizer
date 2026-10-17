// ============================================================================
// 真宿主集成测试（`--extensionTestsPath` 通道，2026-10-17）
// 与 vitest 桩的分工：**这里的 vscode.* 全是真宿主**——真实磁盘/真实 Uri/真实 watcher/
// 真实回收站（useTrash）/真实命令注册。专门钉「桩保真度债」：copy 静默 no-op、dirs 回填、
// Uri.parse 形状之类在桩上测不出的差异。
// 纪律：⛔ modal（HITL/确认弹窗在真机会等人）——本套件全走 CALLER_UI（交互豁免）+ 非模态告示。
// 结果：逐步写 `VV_REAL_RESULTS`（JSON）——启动器读它当真值，宿主退出码只作参考。
// ============================================================================
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { executeTool, CALLER_UI } from '../toolRegistry';
import { registerFilesystemTools } from '../toolsFs';
import { registerDomainTools } from '../toolsDomain';
import { registerRpcTools } from '../dispatch';
import { flushAudit } from '../apiAudit';

interface StepResult { step: string; ok: boolean; ms: number; error?: string }
const results: StepResult[] = [];
const resultsPath = process.env.VV_REAL_RESULTS || path.join(os.tmpdir(), 'vv-real-results.json');

function flushResults(): void {
  try { fs.writeFileSync(resultsPath, JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2)); } catch { /* 尽力而为 */ }
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e) });
    flushResults();
    throw e;
  }
  flushResults();
}

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

export async function run(): Promise<void> {
  try {
    registerFilesystemTools();
    registerDomainTools();
    registerRpcTools();     // 与 activate 那条线同一份清单（按 id 幂等：activate 已登记过＝空转）
    const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(wsUri, '真机测试需要工作区（启动器传入临时工程）');
    const root = wsUri.fsPath;
    const jp = (...p: string[]): string => path.join(root, ...p);
    const ctx = {
      subscriptions: [],
      extensionUri: vscode.Uri.file(path.dirname(root)),
      globalStorageUri: vscode.Uri.file(path.join(os.tmpdir(), 'vv-real-globalstorage')),
      extensionMode: vscode.ExtensionMode.Production,
    } as unknown as vscode.ExtensionContext;

  await step('sys.getStatus：真宿主工程根', async () => {
    const st = await executeTool(ctx, CALLER_UI, 'sys.getStatus', {}) as any;
    // 35＝批次一 10 + 批次二 14 + 阶段三收编的 RPC 9 + 诊断新 2。这颗数⛔ 靠"存在"，它证明的是
    // **真宿主这一条装载线也登记了 `host.*` 那九颗**（漏登记时这里是 26，而 webview 侧照样能用⇒看不见）。
    assert.ok(st.registeredTools >= 35, `registeredTools=${st.registeredTools}`);
    assert.ok(st.projectRoot.toLowerCase().includes('vv-real-e2e'), st.projectRoot);
  });

  await step('host.getAllBindings：RPC 那颗在真宿主也走 executeTool（含幽灵 method 进账＋traceId 对得上）', async () => {
    const RPC = { surface: 'rpc', subject: 'ui', interactive: false } as const;
    const out = await executeTool(ctx, RPC, 'host.getAllBindings', {}) as any;
    assert.equal(typeof out, 'object', `回的不是绑定表：${JSON.stringify(out)}`);
    let caught: any = null;
    try { await executeTool(ctx, RPC, 'host.noSuchTool', {}); } catch (e) { caught = e; }
    assert.ok(caught && /\[API_NOT_REGISTERED\]/.test(String(caught.message)), `幽灵 method 的拒单形状不对：${caught && caught.message}`);
    assert.ok(/^[0-9a-f]{8}$/.test(String(caught.traceId)), `调用方手里那串形状不对：${caught.traceId}`);
    await new Promise((r) => setTimeout(r, 30));          // 审计是 fire-and-forget：等它进缓冲再催落盘
    await flushAudit(ctx);
    const day = new Date().toISOString().slice(0, 10);
    const raw = fs.readFileSync(path.join(root, '.vv', 'audit', `trace-${day}.jsonl`), 'utf8');
    assert.ok(raw.includes(caught.traceId), `账上找不到调用方那串 ${caught.traceId}＝号在落账侧现算，两界永远对不上`);
    assert.ok(raw.includes('"verdict":"not-registered"'), '幽灵 method 那行⛔ 进账＝§9.5「每次调用必进账，含被拒」破了');
  });

  await step('sys.listTools：discoverTools 权威 schema', async () => {
    const out = await executeTool(ctx, CALLER_UI, 'sys.listTools', {}) as any;
    const mv = out.tools.find((t: any) => t.id === 'fs.move');
    assert.deepEqual(mv.schema.required, ['src', 'destDir']);
    assert.equal(mv.perm, 'file-write');
  });

  await step('fs.createFile：真磁盘落盘 + 内容逐字', async () => {
    const r = await executeTool(ctx, CALLER_UI, 'fs.createFile', { name: 'adder.djs', kind: 'sandbox' }) as any;
    assert.ok(fs.existsSync(r.uri), `真盘缺文件: ${r.uri}`);
    assert.equal(fs.readFileSync(r.uri, 'utf8'), '{"cells":[]}');
  });

  await step('fs.move：真搬家 + G1 绑定随迁（真盘 json 断言）', async () => {
    const r = await executeTool(ctx, CALLER_UI, 'fs.move', { src: jp('fsm.djs'), destDir: jp('gates') }) as any;
    assert.ok(!fs.existsSync(jp('fsm.djs')), '旧位置应已空');
    assert.ok(fs.existsSync(r.uri), '新位置应有文件');
    const meta = readJson(jp('.verilogviz.json'));
    assert.equal(meta.bindings.fsm, 'gates/fsm.djs');
  });

  await step('fs.rename：真改名 + circuits 根表随迁', async () => {
    const r = await executeTool(ctx, CALLER_UI, 'fs.rename', { uri: jp('parts/counter.djs'), newName: 'counter2.djs' }) as any;
    assert.ok(r.ok);
    assert.ok(fs.existsSync(jp('parts/counter2.djs')));
    assert.ok(!fs.existsSync(jp('parts/counter.djs')));
    const meta = readJson(jp('.verilogviz.json'));
    assert.deepEqual(meta.circuits, ['parts/counter2.djs']);
  });

  await step('fs.move：自环拒（真宿主错误链）', async () => {
    await assert.rejects(
      executeTool(ctx, CALLER_UI, 'fs.move', { src: jp('gates'), destDir: jp('gates/sub') }),
      /移动失败|子目录/,
    );
    assert.ok(fs.existsSync(jp('gates/fsm.djs')), '自环拒后目录原样');
  });

  await step('fs.delete：真删除（回收站通道）+ 绑定随清', async () => {
    await executeTool(ctx, CALLER_UI, 'fs.delete', { uri: jp('main.djs') });
    assert.ok(!fs.existsSync(jp('main.djs')));
    const meta = readJson(jp('.verilogviz.json'));
    assert.equal(meta.bindings.main, undefined);
  });

  await step('res.readProjectFile：真读 + 穿越拒', async () => {
    const r = await executeTool(ctx, CALLER_UI, 'res.readProjectFile', { path: 'gates/fsm.djs' }) as any;
    assert.ok(r.content.includes('cells'));
    await assert.rejects(executeTool(ctx, CALLER_UI, 'res.readProjectFile', { path: '../escape.v' }));
  });

  await step('bindings.set：真写目录层 json（同目录裸名）', async () => {
    await executeTool(ctx, CALLER_UI, 'bindings.set', { dir: 'gates', celltype: 'half', part: 'gates/fsm.djs' });
    const meta = readJson(jp('gates/.verilogviz.json'));
    assert.equal(meta.bindings.half, 'fsm.djs');
  });

  await step('fs.copyPath + sys.readAudit：真审计账本（写侧↔读侧同口径）', async () => {
    await executeTool(ctx, CALLER_UI, 'fs.copyPath', { uri: jp('gates/fsm.djs') });
    await flushAudit(ctx);
    const log = await executeTool(ctx, CALLER_UI, 'sys.readAudit', {}) as any;
    assert.equal(log.exists, true, '审计 jsonl 应真落盘');
    assert.ok(log.lines.some((l: any) => l.tool === 'fs.copyPath' && l.verdict === 'auto'));
  });

  await step('闸①-b BAD_ARGS：真宿主缺参拒', async () => {
    await assert.rejects(executeTool(ctx, CALLER_UI, 'fs.copyPath', {}), /\[API_BAD_ARGS\]/);
  });
  } finally {
    // 完成哨兵：启动器轮询它收结果（真机宿主可能不自退——fork 的 agent host 占着句柄）
    flushResults();
    try { fs.writeFileSync(resultsPath + '.done', new Date().toISOString()); } catch { /* 尽力而为 */ }
  }
}