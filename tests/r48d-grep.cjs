// 只读：在 digitaljs bundle 里找这几个标识符的用法上下文（判定它们是不是真被消费）
const fs = require('fs');
const s = fs.readFileSync(process.argv[2] || 'public/digitaljs.js', 'utf8');
for (const name of ['arst_value', 'hide_label', 'extend', 'initial', 'angle', 'order', 'groups', 'slice', 'abits', 'rdports', 'wrports']) {
  const hits = [];
  let i = -1;
  while ((i = s.indexOf(name, i + 1)) !== -1 && hits.length < 6) {
    hits.push(s.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' '));
  }
  console.log(`\n### ${name}  命中 ${hits.length}${hits.length === 6 ? '+' : ''}`);
  for (const h of hits) console.log('   ', h);
}
