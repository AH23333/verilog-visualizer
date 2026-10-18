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

    // 2) QuickPick 叠放证人（台架假件测不出、真机"越修越坏"的头号嫌疑人）：
    //    真宿主同一时刻只显示一颗 QuickPick——第二颗 show() 会不会把第一颗顶没（onDidHide 触发）？
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
      ok('quickpick-stacking-hides-first', hidden1,
        hidden1 ? '证人到手：二级 show 顶没一级（onDidHide 已触发）⇒ 弹窗⛔ 叠放，得单颗两级导航'
          : '意外：一级存活（叠放可行）');
      let throwNote = '';
      try { qp1.items = [{ label: '顶没之后再赋' }]; } catch (e) { throwNote = String((e && e.message) || e); }
      ok('quickpick-write-after-hide', true, throwNote || '顶没后赋 items 不抛（dispose 前仍可写）');
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
