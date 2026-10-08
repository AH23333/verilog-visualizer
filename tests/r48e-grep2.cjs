// 只读：digitaljs 里属性是按字符串取的（this.get("arst_value")），
// 所以要搜「带引号的名字」才可靠；顺便定位类名附近读了哪些 key。
const fs = require('fs');
const s = fs.readFileSync(process.argv[2] || 'public/digitaljs.js', 'utf8');
const NAMES = ['arst_value', 'srst_value', 'hide_label', 'extend', 'angle', 'order', 'groups',
  'slice', 'abits', 'rdports', 'wrports', 'initial', 'polarity', 'constant', 'propagation',
  'bits', 'net', 'label', 'celltype', 'data', 'address', 'output', 'input', 'no_data',
  'enable_srst', 'displayType', 'base'];

console.log('== 带引号出现次数（"name" 或 \'name\'） ==');
for (const n of NAMES) {
  const q = (s.match(new RegExp('["\']' + n + '["\']', 'g')) || []).length;
  console.log(String(n).padEnd(14), q);
}

console.log('\n== hide_label / extend 的带引号上下文 ==');
for (const n of ['hide_label', 'extend']) {
  let i = -1, c = 0;
  const re = new RegExp('["\']' + n + '["\']', 'g');
  let m;
  while ((m = re.exec(s)) && c < 8) {
    console.log(`  [${n}] …${s.slice(Math.max(0, m.index - 90), m.index + 90).replace(/\s+/g, ' ')}…`);
    c++;
  }
  if (!c) console.log(`  [${n}] 无带引号出现`);
}

console.log('\n== BitExtend / Gate 类定义附近（找它消费的参数名） ==');
for (const cls of ['BitExtend', 'ZeroExtend', 'SignExtend', 'Dff', 'FlipFlop']) {
  const i = s.indexOf(cls);
  console.log(`\n  --${cls} @${i}--`);
  if (i > 0) console.log('   ', s.slice(Math.max(0, i - 200), i + 700).replace(/\s+/g, ' '));
}
