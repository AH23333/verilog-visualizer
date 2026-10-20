#!/usr/bin/env node
/**
 * MCP 连接冒烟自检（R161 批次七·开道件）：以标准 MCP stdio 客户端身份完整走一遍
 * `node mcp/mcp-server.cjs --project <工程根>` —— initialize → tools/list → 四枪只读真调用，
 * 逐发报时延与形状判定，退出码＝失败数。外部 agent 接入前/升版后各跑一次即可证明全链在线。
 * 用法：node mcp/smoke.cjs [projectDir]   （缺省当前目录）
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const PROJECT = path.resolve(process.argv[2] || process.cwd());
const SERVER = path.join(__dirname, 'mcp-server.cjs');
const child = spawn(process.execPath, [SERVER, '--project', PROJECT], { stdio: ['pipe', 'pipe', 'pipe'] });
let fail = 0;
let seq = 0;
const pending = new Map();
const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m && m.id != null && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error))); else p.resolve({ msg: m, ms: Date.now() - p.t0 });
  }
});
child.stderr.on('data', (d) => { const s = String(d); if (/失败|ERR/i.test(s)) console.error('  [server]', s.trim().slice(0, 160)); });
function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, t0: Date.now() });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 15000);
  });
}
const note = (name, pass, extra) => { console.log((pass ? 'OK  ' : 'FAIL') + '  ' + name + (extra ? '  [' + extra + ']' : '')); if (!pass) fail++; };

(async () => {
  const ini = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vv-smoke', version: '1.0' } });
  note('initialize', !!ini.msg.result && ini.msg.result.serverInfo?.name === 'verilog-visualizer',
    ini.ms + 'ms server=' + JSON.stringify(ini.msg.result?.serverInfo || {}));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const ls = await rpc('tools/list', {});
  const tools = ls.msg.result?.tools || [];
  const names = new Set(tools.map((t) => t.name));
  // 下限 35（契约 mcp 面在册 37，批次六终账；工程 .vv/api.json 只许再关 ⇒ 留 2 颗余量）。
  // 逐颗名册对账⛔ 在这里做——那是台架契约锁⑤的主人；这颗只证"全链在线且形状齐"。
  const badShape = tools.filter((t) => !t.description || !t.inputSchema).map((t) => t.name);
  note('tools/list', tools.length >= 35 && badShape.length === 0,
    tools.length + ' 颗在册' + (badShape.length ? '，缺形状：' + badShape.join(',') : '，描述/schema 齐全'));
  note('名册·近期新面代表在场', ['sys.listTools', 'project.doctor', 'compile.hierarchy', 'res.parseFile', 'compile.compileAndShow'].every((n) => names.has(n)),
    'ping/doctor/hierarchy/parseFile/compileAndShow');

  for (const [name, args, judge, label] of [
    ['sys.ping', {}, (r) => r && r.activation != null, '活体探针'],
    ['res.listProject', {}, (r) => Array.isArray(r.files), '编译域清单'],
    ['sys.describeTool', { tool: 'sys.ping' }, (r) => r && (r.tool === 'sys.ping' || r.schema), 'D1 预演'],
    ['project.doctor', { deep: false }, (r) => Array.isArray(r.verdicts), '总检聚合'],
  ]) {
    try {
      const call = await rpc('tools/call', { name, arguments: args });
      const txt = ((call.msg.result || {}).content || []).map((c) => c.text).join('');
      let body; try { body = JSON.parse(txt); } catch { body = txt; }
      note(name + '（' + label + '）', !(call.msg.result || {}).isError && judge(body), call.ms + 'ms');
    } catch (e) { note(name + '（' + label + '）', false, String(e.message || e)); }
  }
  console.log(fail === 0 ? '\nSMOKE PASS — MCP 全链在线，外部 agent 按 docs/MCP_CONNECT.md 接入即可' : '\nSMOKE FAILED ' + fail);
  rl.close(); child.kill();
  process.exit(fail);
})().catch((e) => { console.error('smoke 炸：', e && e.message); rl.close(); child.kill(); process.exit(1); });
