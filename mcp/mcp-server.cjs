#!/usr/bin/env node
// ============================================================================
// MCP 活编辑器桥·客户端侧（批次三 A 案）：stdio 上的 MCP(JSON-RPC 2.0) ↔ 扩展命名管道(NDJSON)。
// agent 配置示例（Claude/Trae 等 MCP 客户端）：
//   command: node, args: ["<本仓绝对路径>/mcp/mcp-server.cjs", "--project", "<工程文件夹>"]
// 前置：该工程正开在 Verilog Visualizer 基座里（桥不代办——探不到活服务就明确报错退出，
//   ⛔ 静默空转；agent 拿到 stderr 就知道要先把编辑器开起来）。
//
// 纪律对齐（toolRegistry 头注）：本进程**零判断**——闸/账/HITL 全在扩展侧 executeTool
//   （caller 固化 mcp/agent/非交互）。tools/list 的清单来自 sys.listTools 现读并过滤
//   surfaces∋mcp（⛔ 在这里抄一份工具表——抄＝第二真源＝漂移）。
// 协议形状与 mcpBridge.ts 逐字对齐：请求 {id,tool,args} → 回 {id,ok,result|code,message,traceId}。
// ============================================================================
'use strict';
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const PROTOCOL_VERSION = '2024-11-05';

// 与 mcpBridge.pipeNameFor 逐字同算法（台架锁双向钉；改一处必改两处+跑锁）。
// ⚠ 导出给台架 require——主循环守卫在下面（require ⛔ 带起服务）。
function pipeNameFor(rootFsPath) {
  const norm = rootFsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const h = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\vv-mcp-${h}` : path.join(os.tmpdir(), `vv-mcp-${h}.sock`);
}
module.exports = { pipeNameFor };
if (require.main !== module) return;   // 被 require＝只取算法，⛔ 起服务/吃 stdin

const argv = process.argv.slice(2);
let project = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--project' && argv[i + 1]) project = path.resolve(argv[++i]);
}
if (!project) {
  process.stderr.write('用法：node mcp-server.cjs --project <工程文件夹>（该工程须正开在 Verilog Visualizer 基座里）\n');
  process.exit(2);
}
const PIPE = pipeNameFor(project);

/** 向扩展打一发 NDJSON 请求并等回包（一连接一枪：简单、无队头纠缠）。 */
function callPipe(tool, args) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PIPE);
    let buf = '';
    const req = JSON.stringify({ id: Date.now(), tool, args: args || {} }) + '\n';
    s.setTimeout(30000);
    s.once('error', (e) => reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED'
      ? `连不上 ${PIPE}——该工程没在基座里开（或 mcp 开关关着）。把 ${project} 打开再试。` : String(e.message))));
    s.once('timeout', () => { s.destroy(); reject(new Error(`${tool} 超时（30s）`)); });
    s.once('connect', () => s.write(req));
    s.on('data', (d) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) { s.destroy(); try { resolve(JSON.parse(buf.slice(0, nl))); } catch (e) { reject(e); } }
    });
    s.on('close', () => { if (!buf) reject(new Error('管道无回包即断开')); });
  });
}

let toolCache = null;
async function mcpToolList() {
  if (!toolCache) {
    const r = await callPipe('sys.listTools', {});
    if (!r.ok) throw new Error(`sys.listTools 被拒：${r.code} ${r.message}（traceId=${r.traceId}）`);
    toolCache = (r.result.tools || []).filter((t) => (t.surfaces || []).includes('mcp'))
      .map((t) => ({ name: t.id, title: t.title, description: `${t.description || ''}（perm=${t.perm}；sideEffects=${t.sideEffects}${t.requiresApproval ? '；须用户批准' : ''}）`, inputSchema: t.schema }));
  }
  return toolCache;
}

// ---- MCP stdio：换行分隔 JSON-RPC 2.0（stdin 进、stdout 出；stderr 只放人读日志） ----
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') {
        reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'verilog-visualizer', version: '0.1.0' } });
      } else if (method === 'notifications/initialized' || (method || '').startsWith('notifications/')) {
        // 通知不回包（JSON-RPC：无 id）
      } else if (method === 'ping') {
        reply(id, {});
      } else if (method === 'tools/list') {
        reply(id, { tools: await mcpToolList() });
      } else if (method === 'tools/call') {
        const r = await callPipe(String(params && params.name), (params && params.arguments) || {});
        reply(id, r.ok
          ? { content: [{ type: 'text', text: JSON.stringify(r.result, null, 2) }] }
          : { content: [{ type: 'text', text: `[${r.code}] ${r.message}（traceId=${r.traceId || '-'}）` }], isError: true });
      } else if (id !== undefined) {
        replyErr(id, -32601, `方法不支持：${method}`);
      }
    } catch (e) {
      if (id !== undefined) replyErr(id, -32603, String(e && e.message ? e.message : e));
      process.stderr.write(`[vv-mcp] ${method} 失败：${e && e.message ? e.message : e}\n`);
    }
  }
});
process.stderr.write(`[vv-mcp] 桥起在 ${PIPE}（project=${project}）\n`);
