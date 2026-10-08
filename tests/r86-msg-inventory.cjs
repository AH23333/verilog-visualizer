// V2b 现场清单（**纯静态读源码，不起浏览器**）：状态栏还有几处整句英文反馈语。
// 判据与摘取器都住在 `tests/_ui.cjs`（`isEnglishSentence` / `setMessageLiterals`）——
// 闸门 r83 [7] 用的是同一份，⛔ 不许在这里再抄一遍（两份飘掉一份是本仓的老病，见 qc-audit 那颗开关）。
// 为什么先跑这颗：判据里"还剩 N 处"这种期望，必须先见过现场读数才能钉（记忆 VZ／#259）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const UI = require('./_ui.cjs');
const FILES = ['src/App.tsx', 'src/components/Canvas.tsx', 'src/components/SandboxCanvas.tsx', 'src/components/OutputPanel.tsx'];

// 自证：摘取器要能咬住"三元分支里的那句"（第一版正则就是漏在这一族上，把 50 读成 32）
const FIXTURE = `
  setMessage('File saved.');
  setMessage(ok ? 'SVG exported.' : 'Export cancelled or no circuit.');
  setMessage(\`Moved \${ids.length} file(s) to \${targetFolder || 'root'}.\`);
  setMessage('Compiling...');                       // 单词句：句式规则刻意不算它
  setMessage(\`已保存 \${n} 个文件。\`);
`;
const self = UI.setMessageLiterals(FIXTURE).map((h) => h.text);
console.log('[自证] 摘取器命中', JSON.stringify(self));
const bite = self.length === 4 && !self.some((s) => /Compiling|已保存/.test(s));
console.log(`[自证] ${bite ? 'OK' : '★不成立'}：要 4 条（三元的两个分支各算一条、单词句与中文句不算），实际 ${self.length} 条`);

let total = 0;
for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const hits = UI.setMessageLiterals(fs.readFileSync(p, 'utf8'));
  total += hits.length;
  console.log(`\n=== ${f}：整句英文 ${hits.length} 处 ===`);
  for (const h of hits) console.log(`  ${String(h.line).padStart(4)}  ${h.text.slice(0, 92)}`);
}
console.log(`\n===== 合计 ${total} 处 =====`);
process.exit(bite ? 0 : 1);
