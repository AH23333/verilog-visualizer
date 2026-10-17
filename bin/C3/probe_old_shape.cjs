// 成对判据的探针（C3 台架用）：**旧形状**（认死 test_files/<名>）到底还能不能读到夹具。
// 退出码：
//   0 ＝ 读不到（前提成立：夹具已被用户搬进子目录，认死路径确实打断闸门）
//   3 ＝ 不适用（夹具此刻就在顶层，旧形状也读得到——这条判据今天无从对照，⛔ 拿它说事）
//   7 ＝ 解析器说在别处、旧路径却还读得到（两颗并存＝有副本，台架该知道）
//   1 ＝ 别的意外
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..', '..');
const { fixture } = require(path.join(REPO, 'tests', 'fixtures.cjs'));
const name = 'adder.v';
const OLD = path.join(REPO, 'test_files', name);
const readOld = () => { try { fs.readFileSync(OLD, 'utf8'); return true; } catch { return false; } };
let where;
try { where = fixture(name); } catch { console.error('解析器本身读不到 ' + name); process.exit(1); }
const samePlace = path.resolve(where) === path.resolve(OLD);
if (samePlace) { console.log('不适用：' + name + ' 就在顶层'); process.exit(3); }
if (readOld()) { console.log('意外：旧路径还读得到，而解析器指去 ' + where); process.exit(7); }
console.log('成立：旧路径读不到，解析器指去 ' + path.relative(REPO, where));
process.exit(0);
