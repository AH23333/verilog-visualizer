// R150b bundle 完整性闸门：真机加载的是 dist/extension.cjs，不是 src——esbuild 构建后
// 核 webview 注入脚本的关键骨件全在（反引号撕串事故里 tsc/esbuild/vm三闸集体失明，这颗兜底）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const CWD = 'D:/Visual Studio Code/Something/verilog-visualizer/extension';
const b = spawnSync(process.execPath, ['esbuild.js'], { cwd: CWD, encoding: 'utf8', windowsHide: true });
if (b.status !== 0) { console.error('esbuild FAIL\n' + (b.stdout || '') + (b.stderr || '')); process.exit(1); }
const d = fs.readFileSync(CWD + '/dist/extension.cjs', 'utf8');
const anchors = {
  '折叠逻辑 applyFold': 'applyFold',
  '祖链函数 ancestorsOf': 'ancestorsOf',
  '点击路由 postMessage': 'postMessage',
  'API 句柄': 'acquireVsCodeApi',
  '折叠标记 data-under': 'data-under',
  '目录行 data-vvd': 'data-vvd',
  '逐行缩进（文件夹层级）': 'padding-left:',
  '左键断流大声报错（锚 _onOpen 三元）': 'showErrorMessage',
};
let bad = 0;
for (const [label, s] of Object.entries(anchors)) {
  const hit = d.includes(s);
  if (!hit) { bad++; console.log('MISS', label, '=', s); }
}
// ⛔ 双箭头图标与"注释反引号撕串"的残骸：模板区不许再出现 `as` TS 断言
// script 区窗口＝从 render 模板的 `<script nonce=` 到其后的 `</script>`（bundle 里该字面串唯一）
const openScript = d.indexOf('<script nonce="');
const closeScript = d.indexOf('</script>', openScript);
const scriptZone = openScript >= 0 && closeScript > openScript ? d.slice(openScript, closeScript) : '';
if (/\bas HTMLElement\b/.test(scriptZone)) { bad++; console.log('MISS 纯JS保证：脚本区混着 TS as 断言'); }
if (!scriptZone.includes('applyFold')) { bad++; console.log('MISS 脚本被截断（fold 逻辑不在闭合区内）'); }
console.log(bad ? `BUNDLE_GATE_FAIL(${bad})` : 'BUNDLE_GATE_OK');
process.exit(bad ? 1 : 0);
