// 闸门夹具的一颗解析器（R153 之后的裁决：⛔ 认死路径）。
//
// 为什么要有这一层：`test_files/` 同时是两样东西——
//   ① Playwright 闸门的夹具库（38 个文件、39 处读它）；
//   ② 用户在产品里做真机验收的试验台（他会用拖拽把 `.v` 搬进子目录、建文件夹、改名）。
// 认死路径（`test_files/adder.v`）意味着：用户整理自己的文件＝把我的验证打断（上一轮就撞了
// 18 颗 ENOENT）。按**末段名**递归解析后，夹具怎么摆都认，前提是名字唯一——
// 同名多颗时**报清单停手**（⛔ 挑一颗：那会让闸门在"看起来绿"的状态下测到另一颗东西）。
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DIR = path.join(REPO, 'test_files');

/** 递归列 test_files/ 下的全部文件（跳过配置表与点开头目录；深度护栏挡软链环） */
function list(dir, depth = 8, acc = []) {
  if (depth <= 0) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      list(abs, depth - 1, acc);
    } else if (e.isFile() && e.name !== '.verilogviz.json') {
      acc.push(abs);
    }
  }
  return acc;
}

/** 按末段名取夹具的绝对路径。查无／同名多颗都抛，并把现场一起报出来。 */
function fixture(name) {
  const hits = list(DIR).filter((p) => path.basename(p) === name);
  if (hits.length === 1) return hits[0];
  const corpus = list(DIR).map((p) => path.relative(DIR, p).replace(/\\/g, '/')).sort();
  if (hits.length === 0) {
    throw new Error(`夹具查无：${name}｜test_files/ 现有 ${corpus.length} 颗：\n  ${corpus.join('\n  ')}`);
  }
  throw new Error(`夹具同名多颗（${name}）⇒ ${hits.join(' , ')}｜先起个不撞名的名字再跑闸门`);
}

const fixtureText = (name) => fs.readFileSync(fixture(name), 'utf8');

module.exports = { fixture, fixtureText, FIXTURE_DIR: DIR, REPO };
