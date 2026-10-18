// ============================================================================
// 统一调用层·批次三 A 案（用户拍板 2026-10-19）：MCP 活编辑器桥的**服务端**。
// 扩展在命名管道上听 NDJSON（一行一枪）；`mcp/mcp-server.cjs`（stdio↔管道桥）把这一枪
// 原样转给 executeTool——外部 agent 由此看着**活着的**编辑器工程调用工具，HITL 弹窗落在用户屏幕上。
//
// 传输固化（卷六十二纪律）：这条线上的 caller 永远是
//   { surface:'mcp', subject:'agent', interactive:false }
// ——身份由传输层钉死，业务代码⛔ 自造；interactive:false ⇒ requiresApproval 工具走执行器 HITL 弹窗
// （toolRegistry 第④闸），用户不批＝NOT_APPROVED 上账回错。
//
// 管道名＝工程根路径的 sha1（两边各自现算，⛔ 发现文件进用户仓库——"⛔ 在他的仓库里造
// 没人要求的文件"是 dispatch.configRoot 的旧教训）。Windows `\\.\pipe\…`（默认 ACL＝同用户会话，
// 本地他用户/远程不可达）；POSIX 落 tmp 的 unix socket。双开同工程：后起者先探活，
// 已有活服务就让位（一个工程一根管子，agent 连谁都是同一份闸与账）。
//
// 开关语义：只在**生效契约** surfacesGlobal.mcp===true 且开了工作区文件夹时听——
// 关闸＝零监听面（不是"听了再逐枪拒"，门压根不开）。工程 .vv/api.json 只能把它再关掉（AND），
// 想开＝改内置契约（产品权力）。改开关后需重载窗口（契约在 activate 一次性落定，与 grants 同口径）。
//
// 协议（与 mcp-server.cjs 逐字对齐，⛔ 版本漂移）：
//   请求  {"id":<any>,"tool":"<id>","args":{…}?}
//   回包  {"id":…,"ok":true,"result":…} | {"id":…,"ok":false,"code":"…","message":"…","traceId":"…"}
//   code ＝ ToolError 的机读码（API_* 壳已剥）或 "HANDLER_ERROR"/"BAD_REQUEST"。
//   审计：闸/账全在 executeTool（channel=mcp、subject=agent 上账），本文件⛔ 另记一套。
// ============================================================================
import * as vscode from 'vscode';
import * as net from 'net';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { executeTool, ToolError, type ToolCaller } from './toolRegistry';
import { loadApiContract } from './apiSurface';
import { projectRoot } from './dispatch';

/** 传输固化的调用方档案：这条线上⛔ 任何"看起来更像 ui"的身份。 */
export const CALLER_AGENT: ToolCaller = { surface: 'mcp', subject: 'agent', interactive: false };

/** 单行请求的硬帽（防呆：agent 塞 50MB 的 args 不是我们想伺候的调用方）。 */
const MAX_LINE = 1024 * 1024;

/** 工程根 → 管道名（服务端与 mcp-server.cjs 各算一遍必须逐字相同——台架钉死形状）。 */
export function pipeNameFor(rootFsPath: string): string {
  const norm = rootFsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const h = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\vv-mcp-${h}` : path.join(os.tmpdir(), `vv-mcp-${h}.sock`);
}

/**
 * 协议纯函数：一行请求文本 → 一行回包文本（socket 层只做收发，判全在这——台架可测，
 * 真宿主 harness 再从管道外打一发真的）。⛔ 抛：一切异常都折成 ok:false 回包（连接要活到下一枪）。
 */
export async function handleMcpLine(context: vscode.ExtensionContext, line: string): Promise<string> {
  const reply = (id: unknown, ok: boolean, extra: Record<string, unknown>): string =>
    JSON.stringify({ id: id ?? null, ok, ...extra });
  let req: { id?: unknown; tool?: unknown; args?: unknown };
  try {
    req = JSON.parse(line);
    if (!req || typeof req !== 'object' || typeof req.tool !== 'string') throw new Error('缺 tool 字段');
  } catch (e) {
    return reply(null, false, { code: 'BAD_REQUEST', message: `请求不是合法的一枪 JSON（{id,tool,args}）：${String(e instanceof Error ? e.message : e)}` });
  }
  try {
    const result = await executeTool(context, CALLER_AGENT, req.tool,
      (req.args && typeof req.args === 'object' && !Array.isArray(req.args)) ? req.args as Record<string, unknown> : {});
    return reply(req.id, true, { result });
  } catch (e) {
    if (e instanceof ToolError) return reply(req.id, false, { code: e.code, message: e.message, traceId: e.traceId });
    return reply(req.id, false, { code: 'HANDLER_ERROR', message: String(e instanceof Error ? e.message : e).slice(0, 400) });
  }
}

/** 探活：管道上有没有活的服务端（双开让位用）。连上即断，⛔ 发枪。 */
function probeAlive(pipe: string): Promise<boolean> {
  return new Promise((res) => {
    const s = net.connect(pipe);
    const done = (v: boolean): void => { s.destroy(); res(v); };
    s.setTimeout(1500);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

/** 桥的活体读数（sys.ping/getStatus 用，P10）：listening＝门开没开；pipe＝门在哪；conns＝几条 agent 线挂着。 */
const bridgeState: { listening: boolean; pipe: string | null; skipped: string | null } = { listening: false, pipe: null, skipped: null };
export function bridgeSnapshot(): { listening: boolean; pipe: string | null; conns: number; skipped: string | null } {
  return { ...bridgeState, conns: liveConns.size };
}
const liveConns = new Set<net.Socket>();

/**
 * 起桥（activate 在契约落定后调）。返回 Disposable＝真起了；undefined＝没起
 * （开关关/没开文件夹/双开让位/listen 失败——都不算错，静默是常态）。
 */
export async function startMcpBridge(context: vscode.ExtensionContext): Promise<vscode.Disposable | undefined> {
  const skip = (why: string): undefined => { bridgeState.skipped = why; return undefined; };
  if (process.env.VV_MCP === 'off') return skip('env VV_MCP=off（台架）');
  if (!vscode.workspace.workspaceFolders?.length) return skip('无工作区文件夹');             // agent 的 --project 对着文件夹，没根没桥
  if ((loadApiContract().surfacesGlobal?.mcp ?? true) === false) return skip('契约 mcp 关');  // 关闸＝门不开
  const pipe = pipeNameFor(projectRoot(context).fsPath);
  if (await probeAlive(pipe)) return skip('双开让位（他窗在服务）');
  const conns = liveConns;
  const server = net.createServer((sock) => {
    conns.add(sock);
    sock.on('error', () => sock.destroy());
    sock.on('close', () => conns.delete(sock));
    let buf = '';
    let overflow = false;
    sock.on('data', (chunk) => {
      if (overflow) return;
      buf += chunk.toString('utf8');
      if (buf.length > MAX_LINE * 2) { overflow = true; sock.destroy(); return; }   // 没有换行的巨物＝流弹，掐线
      let nl: number;
      const lines: string[] = [];
      while ((nl = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.length > MAX_LINE) { sock.write(JSON.stringify({ id: null, ok: false, code: 'BAD_REQUEST', message: `单行超 ${MAX_LINE}B 帽` }) + '\n'); continue; }
        // 逐枪串行回包（⛔ 并发乱序——协议简单性的代价，读侧工具本就毫秒级）
        void handleMcpLine(context, line).then((out) => { if (!sock.destroyed) sock.write(out + '\n'); });
      }
    });
  });
  return await new Promise((res) => {
    server.once('error', () => { server.close(); skip('listen 失败（他窗抢先/环境不支持）'); res(undefined); });   // EADDRINUSE/权限问题＝不起了（另一颗抢先/环境不支持）
    server.listen(pipe, () => {
      bridgeState.listening = true; bridgeState.pipe = pipe; bridgeState.skipped = null;
      const disp: vscode.Disposable = {
        dispose: () => {
          for (const s of conns) s.destroy();
          server.close();
          bridgeState.listening = false; bridgeState.pipe = null;
          if (process.platform !== 'win32') { try { require('fs').unlinkSync(pipe); } catch { /* 已没了＝正常 */ } }
        },
      };
      context.subscriptions.push(disp);
      res(disp);
    });
  });
}
