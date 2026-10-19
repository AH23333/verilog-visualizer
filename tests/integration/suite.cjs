// 真宿主集成套件（R159）：跑在 fork 基座的**真 electron 扩展宿主**里（--extensionTestsPath）。
// 使命＝假件测不出的那半边：真 createQuickPick 叠放语义、语言/语法真注册、custom editor 真打开、
// 扩展真激活。结果写 env.VV_IT_OUT 指向的 JSON，再 closeWindow 收窗（父脚本等进程退出读账）。
// ⚠ 这颗套件是"证人"不是"判卷"——断言写的是**真 VS Code 会怎么干**（台架只证"我们这边的接线对"）。
const fs = require('fs');
const vscode = require('vscode');

const results = [];
let _out = '';
const flush = () => { if (_out) { try { fs.writeFileSync(_out, JSON.stringify({ started: true, results, failed: results.filter((r) => !r.pass).length }, null, 2)); } catch { /* 尽力 */ } } };
const ok = (name, pass, note) => { results.push({ name, pass: !!pass, note: note || '' }); flush(); };   // 每步落盘：挂中途也有半账
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const out = process.env.VV_IT_OUT;
  _out = out || '';
  const write = (obj) => { if (out) { try { fs.writeFileSync(out, JSON.stringify(obj, null, 2)); } catch { /* 尽力 */ } } };
  write({ started: true, at: new Date().toISOString() });   // 心跳：区分"模块没被加载"与"跑了但挂中途"
  try {
    // 1) 扩展真激活（真 package.json 解析、真 contributes 装载——manifest 写歪这里先炸）
    const ext = vscode.extensions.getExtension('local.verilog-visualizer-vscode');
    ok('extension-present', !!ext, ext ? '' : 'getExtension 查无 local.verilog-visualizer-vscode');
    if (ext) {
      try { await ext.activate(); ok('activate', true); }
      catch (e) { ok('activate', false, String((e && e.message) || e)); }
    }

    // 2) QuickPick 叠放**证人记录**（信息项，⛔ 判方向——R159 两跑读数相反：宿主失焦时二级 show
    //    顶没一级、聚焦时存活＝真宿主行为不确定 ⇒ 产品结论只能是"单颗 picker 两级导航"，
    //    弹窗代码（bindingPanel）已按此实现；这颗探针只留读数。）
    {
      const qp1 = vscode.window.createQuickPick();
      let hidden1 = false;
      qp1.onDidHide(() => { hidden1 = true; });
      qp1.items = [{ label: '一级：实例' }];
      qp1.show();
      await wait(200);
      const qp2 = vscode.window.createQuickPick();
      qp2.items = [{ label: '二级：部件' }];
      qp2.show();
      await wait(400);
      ok('quickpick-stacking-reading', true, hidden1 ? '本跑：二级 show 顶没一级（onDidHide 触发）' : '本跑：一级存活（窗口焦点态相关，读数漂移）');
      let throwNote = '';
      try { qp1.items = [{ label: '顶没之后再赋' }]; } catch (e) { throwNote = String((e && e.message) || e); }
      ok('quickpick-write-after-hide', true, throwNote || '顶没/存活后赋 items 均不抛');
      qp2.dispose(); qp1.dispose();
    }

    // 3) 语言/语法真注册：.v 打开应得 languageId=verilog（⛔ 只判 manifest 自说自话）
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!ws) { ok('workspace', false, '无工作区文件夹'); }
    else {
      try {
        const vUri = vscode.Uri.joinPath(ws.uri, 'it_top.v');
        await vscode.workspace.fs.writeFile(vUri, new TextEncoder().encode('module it_top;\n  sub s1();\nendmodule\n'));
        const doc = await vscode.workspace.openTextDocument(vUri);
        ok('language-verilog', doc.languageId === 'verilog', 'languageId=' + doc.languageId);
      } catch (e) { ok('language-verilog', false, String((e && e.message) || e)); }

      // 4) custom editor 真打开（.djs → verilogViz.doc 画布编辑器）
      try {
        const dUri = vscode.Uri.joinPath(ws.uri, 'it_main.djs');
        await vscode.workspace.fs.writeFile(dUri, new TextEncoder().encode('{"cells":[]}'));
        await vscode.commands.executeCommand('vscode.openWith', dUri, 'verilogViz.doc');
        await wait(2500);
        const tg = vscode.window.tabGroups;
        const tabs = (tg && tg.all) ? tg.all.flatMap((g) => g.tabs) : [];
        const hit = tabs.find((t) => t.input && String(t.input.viewType || '') === 'verilogViz.doc');
        ok('openWith-doc', !!hit, hit ? '' : '没找到 verilogViz.doc 的 tab（共 ' + tabs.length + ' 颗）');
      } catch (e) { ok('openWith-doc', false, String((e && e.message) || e)); }

      // 5) bindParts 命令路真执行（第一刀只证"命令在真宿主活着、不抛"；弹窗内容断言等单颗导航版）
      try {
        await vscode.commands.executeCommand('verilogViz.bindParts', vscode.Uri.joinPath(ws.uri, 'it_main.djs'));
        await wait(400);
        ok('bindParts-no-throw', true);
      } catch (e) { ok('bindParts-no-throw', false, String((e && e.message) || e)); }

      // 6) R160 批次三：MCP 活编辑器桥真管道往返（net 真模块、闸真跑——caller 固化 mcp/agent 在扩展侧，
      //    这里只当最挑剔的 agent：一枪只读要过、一枪写面要 SURFACE_DENIED 且带 traceId）。
      //    管道名算法⛔ 第三份拷贝＝直接 require 桥脚本那颗（台架双源锁钉的是 mcpBridge↔mcp-server）。
      try {
        const net = require('net');
        const { pipeNameFor } = require(require('path').join(__dirname, '..', '..', 'mcp', 'mcp-server.cjs'));
        const pipe = pipeNameFor(ws.uri.fsPath);
        const shot = (tool, args) => new Promise((res, rej) => {
          const s = net.connect(pipe);
          let buf = '';
          s.setTimeout(8000);
          s.once('error', rej);
          s.once('timeout', () => { s.destroy(); rej(new Error('管道超时')); });
          s.once('connect', () => s.write(JSON.stringify({ id: 1, tool, args: args || {} }) + '\n'));
          s.on('data', (d) => { buf += d.toString('utf8'); const nl = buf.indexOf('\n'); if (nl >= 0) { s.destroy(); res(JSON.parse(buf.slice(0, nl))); } });
        });
        await wait(1200);   // activate 里桥在契约落定的 promise 链尾起——给它一拍
        const g = await shot('sys.getStatus');
        ok('mcp-pipe-roundtrip', g.ok === true && !!(g.result && g.result.projectRoot),
          g.ok ? 'root=' + g.result.projectRoot : JSON.stringify(g));
        // 2026-10-19 拍板写面放开：bindings.set 经 mcp 真**执行**（旧 mcp-write-denied 证人翻面）；
        //   拒收路径的覆盖转由 host.*（rpc-only）继续把守——面闸的「关」与「开」两态都有证人。
        const d = await shot('bindings.set', { celltype: 'x', part: 'y.djs' });
        ok('mcp-write-allowed', d.ok === true && !!d.result && !!d.result.dir, JSON.stringify(d).slice(0, 160));
        const hst = await shot('host.copyToSandbox', { uri: 'y.djs' });
        ok('mcp-host-rpc-denied', hst.ok === false && hst.code === 'SURFACE_DENIED' && !!hst.traceId, JSON.stringify(hst).slice(0, 160));
        // 四-1 活体探针：真宿主里 ping 必须报"活到底"（检查点全程＋桥 listening）；ctxSnapshot 如实转述（此窗必有工作区根）
        const p = await shot('sys.ping', {});
        ok('mcp-ping-alive', p.ok === true && p.result.alive === true && p.result.activation.done === true
          && p.result.bridge.listening === true,
          p.ok ? 'stages=' + p.result.activation.checkpoints.map((c) => c.stage).join(',') + ' bridge=' + JSON.stringify(p.result.bridge) : JSON.stringify(p));
        const c = await shot('sys.ctxSnapshot', {});
        ok('mcp-ctx-snapshot', c.ok === true && typeof c.result.compilePanel.open === 'boolean' && Array.isArray(c.result.visibleTabs),
          c.ok ? 'panelOpen=' + c.result.compilePanel.open + ' tabs=' + c.result.visibleTabs.length : JSON.stringify(c));
        // 四-2 可解释性双枪：it_top.v 的 sub s1() 无绑定记录 ⇒ BINDING_MISSING＋hint；逐层表原文可读
        const ex = await shot('bindings.explain', { doc: 'it_top.v', instance: 'sub' });
        ok('mcp-explain-missing', ex.ok === true && ex.result.verdict === 'BINDING_MISSING' && String(ex.result.hint).includes('bindings.set'),
          ex.ok ? 'verdict=' + ex.result.verdict : JSON.stringify(ex));
        const tb = await shot('res.readBindingTables', { doc: 'it_top.v' });
        ok('mcp-tables-chain', tb.ok === true && Array.isArray(tb.result.chain) && tb.result.chain.length >= 1,
          tb.ok ? 'layers=' + tb.result.chain.map((l) => l.dir + (l.exists ? '*' : '')).join(',') : JSON.stringify(tb));
        // 四-3 双枪（自给探针件）：parseFile 并呈的 P5 案底在真宿主可见（dff 族）；hierarchy 沿链展开 defFile 落地
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(ws.uri, 'it_p43_top.v'), new TextEncoder().encode('module it_p43_top(input a, output y); dff u_d(.d(a)); it_p43_mid u_m(); endmodule\n'));
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(ws.uri, 'it_p43_mid.v'), new TextEncoder().encode('module it_p43_mid; it_p43_leaf l1(); endmodule\n'));
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(ws.uri, 'it_p43_leaf.v'), new TextEncoder().encode('module it_p43_leaf; endmodule\n'));
        const pf = await shot('res.parseFile', { path: 'it_p43_top.v' });
        ok('mcp-parse-file-divergence', pf.ok === true && pf.result.kind === 'verilog'
          && pf.result.parsers.lite.instances.includes('dff') && pf.result.divergence.mainSelfDiff.includes('dff')
          && pf.result.parsers.main.instances.some((x) => x.name === 'u_m'),
          pf.ok ? 'lite=' + JSON.stringify(pf.result.parsers.lite.instances) + ' mainSelf=' + JSON.stringify(pf.result.divergence.mainSelfDiff) : JSON.stringify(pf));
        const hh = await shot('compile.hierarchy', { entry: 'it_p43_top.v' });
        ok('mcp-hierarchy-chain', hh.ok === true && hh.result.nodes.some((x) => x.chain === 'it_p43_mid/it_p43_leaf')
          && hh.result.nodes.some((x) => x.defFile === 'it_p43_leaf.v' && typeof x.line === 'number'),
          hh.ok ? 'total=' + hh.result.total + ' chains=' + hh.result.nodes.map((x) => x.chain).join(',') : JSON.stringify(hh));
        // 四-4 两枪：doctor 真管道聚合在场；拒单 hint 过传输（v2 硬要求的管道实证）
        const dc = await shot('project.doctor', {});
        ok('mcp-doctor-agg', dc.ok === true && Array.isArray(dc.result.verdicts) && typeof dc.result.infoSuppressed === 'number'
          && dc.result.closure && typeof dc.result.closure.ok === 'boolean',
          dc.ok ? 'verdicts=' + dc.result.verdicts.length + ' suppressed=' + dc.result.infoSuppressed : JSON.stringify(dc));
        const nope = await shot('sys.nope', {});
        ok('mcp-hint-on-wire', nope.ok === false && nope.code === 'NOT_REGISTERED' && typeof nope.hint === 'string' && nope.hint.includes('sys.listTools') && !!nope.traceId,
          JSON.stringify(nope).slice(0, 220));
      } catch (e) { ok('mcp-pipe-roundtrip', false, String((e && e.message) || e)); }
    }
  } catch (e) {
    ok('suite-crash', false, String((e && e.stack) || e));
  }

  const failed = results.filter((r) => !r.pass).length;
  if (out) { try { fs.writeFileSync(out, JSON.stringify({ results, failed }, null, 2)); } catch { /* 尽力 */ } }
  console.log('[vv-it] ' + JSON.stringify(results));
  await wait(300);
  try { await vscode.commands.executeCommand('workbench.action.closeWindow'); } catch { /* 收窗失败也由父脚本超时兜底 */ }
  return failed;
}

exports.run = run;
