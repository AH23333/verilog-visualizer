// R48 只读探针：枚举 digitaljs 从「器件 JSON」里真正读取的属性名，
// 与本项目 cellsToCircuitJson / circuitJsonToCells 的白名单对账。
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'public/digitaljs.js', 'utf8');

// minified 包里属性访问一定是 `.foo` 或 `["foo"]` 形式；抓 .foo 的标识符
const seen = new Map();
for (const m of src.matchAll(/\.([A-Za-z_$][\w$]*)/g)) {
  seen.set(m[1], (seen.get(m[1]) || 0) + 1);
}

// 候选：设备构造相关（来自 digitaljs 文档/上游 dev/*.mjs 的字段名）
const CAND = ['angle', 'bits', 'net', 'order', 'groups', 'slice', 'abits', 'constant', 'polarity',
  'initial', 'propagation', 'rdports', 'wrports', 'dataBusWidth', 'addressBusWidth', 'initValue',
  'displayType', 'commonAnode', 'period', 'celltype', 'label', 'size', 'position', 'type',
  'hiddenTabs', 'clockPolarity', 'edge', 'delay', 'busName', 'value', 'invert', 'address',
  'data', 'writeEnable', 'outputEnable', 'signed', 'baseType', 'shape', 'body', 'attrs', 'styles'];

console.log('== 候选属性在 bundle 中出现次数（.name 形式） ==');
for (const n of CAND) console.log(String(n).padEnd(18), seen.get(n) || 0);

// 找出 _makeGraph / createClass 附近实际读了哪些字段：按 dev./d./celltype. 前缀抓
const prefixed = new Set();
for (const m of src.matchAll(/\b(dev|device|d|conf|cfg|spec|celltype)\.([A-Za-z_$][\w$]*)/g)) prefixed.add(`${m[1]}.${m[2]}`);
console.log('\n== 带前缀读取（前 80 个去重） ==');
console.log([...prefixed].sort().slice(0, 80).join(', '));
