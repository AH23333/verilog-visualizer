// R90 静态形状闸门：**"从路径里取所在文件夹"这一件事只许有一个主人**。
//
// 为什么钉这个（不是洁癖）：这条逻辑正是**部件绑定作用域**的地基——`resolvePartRef(name, scope)`
// 的 scope、`carryPartDefsAfterMove` 落去哪个文件夹、部件清单里那列 `folder`、总览里「实际解析」
// 显示什么、侧边栏拖放的落点文件夹，全建立在"文件名里的 `/` 之前就是文件夹"这一条上
// （两个模式的文件树都没有维护 `folder` 字段）。
// 现场读数（2026-10-06 批次 R90 之前，两种拼法各自手写共 **15 处**）：
//   拼法甲 `slice(0, …lastIndexOf('/')…)` 9 处：src/store/sandboxStore.ts:272/290/305、
//     src/lib/gateSystem.ts:39、src/components/SandboxCanvas.tsx:565/1283/2964/3045/3121
//   拼法乙 `split('/').slice(0,-1).join('/')` 6 处：src/store/fileStore.ts:255/282/309/399/427、
//     src/components/Sidebar.tsx:370
// ⚠ 本闸门**初版只认拼法甲**，于是"收成一份"实际只收了 9 处、另外 6 处换个词就绕过去了
//   （记忆里"禁字面清单会被换词绕过 ⇒ 同一桩罪至少两种措辞各咬一次"同一族）。现在两种拼法都扫。
// 本仓还栽过另一坑：两颗闸门各写一份"找那一行开关"，一份飘掉 ⇒ 选中了别的人。
//
// 判据（射程只有一条，别扩大）：`src/**` 里出现**这两种形状之一**的，只许在主人
// `src/lib/vpath.ts` 里，且主人内部恰好一条实现。
// ⛔ 不管别的 `lastIndexOf('.')`（那是取扩展名，另一件事）。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OWNER = 'src/lib/vpath.ts';
const SANDBOX_ALIAS = 'src/store/sandboxStore.ts';
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };

const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : (/\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []))
  .map((p) => p.split(path.sep).join('/'));   // ⚠ Windows 下 path.join 给反斜杠，主人判定会因此恒不命中

// 两种拼法各一条正则——只认一种就是给"换个词"留门。
const SHAPES = [
  { id: '甲 slice(0, …lastIndexOf(\'/\'))', re: /slice\(\s*0\s*,.*lastIndexOf\(\s*['"]\/['"]\s*\)/ },
  { id: '乙 split(\'/\').slice(0, -1).join(\'/\')', re: /split\(\s*['"]\/['"]\s*\)\s*\.slice\(\s*0\s*,\s*-1\s*\)\s*\.join\(\s*['"]\/['"]\s*\)/ },
];

const hits = [];
// ⚠ 先抹注释：主人在自己的文件里**写明**这两种拼法（文档就是要说清它在管什么），
//   不抹就把注释当成实现数，判据会因为"解释了自己"而红（口径：读文本先抹注释）。
//   只按行首判定，行尾的 `x = 1; /* … */` 这种不在射程内——现场没有这种写法。
const codeLines = (src) => src.split(/\r?\n/).map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l));
for (const rel of walk('src')) {
  codeLines(fs.readFileSync(path.join(ROOT, rel), 'utf8')).forEach((l, i) => {
    // ⚠ 形状要能盖住"中间套了函数调用"的写法（`slice(0, String(f.name).lastIndexOf('/'))`），
    //   否则就是"扫出来 8 处、其实 9 处"——扫描面少一处的 0 里没有任何信息（记忆里 #286 同一族）。
    for (const s of SHAPES) if (s.re.test(l)) hits.push({ rel, line: i + 1, shape: s.id, owner: rel === OWNER });
  });
}
const offenders = hits.filter((h) => !h.owner);
const byShape = (id) => hits.filter((h) => h.shape === id).length;
console.log(`  [现场] 取所在文件夹的形状 ${hits.length} 处（甲 ${byShape(SHAPES[0].id)}／乙 ${byShape(SHAPES[1].id)}；主人在 ${OWNER}，${hits.filter((h) => h.owner).length} 处）`);
for (const h of offenders.slice(0, 14)) console.log(`    ★${h.rel}:${h.line} [${h.shape}]`);
(hits.length === 0 ? bad : offenders.length === 0 ? ok : bad)(
  '[1] "从路径取所在文件夹"只有一个主人（两种拼法都不许在别的文件手写）',
  hits.length === 0 ? '★一处都没扫到（扫描形状或路径变了，不作数）'
    : offenders.length ? `${offenders.length} 处各写一份：${J(offenders.map((o) => `${o.rel}:${o.line}[${o.shape[0]}]`))}`
      : `${hits.length} 处全在主人文件里（两种措辞都咬到了）`);

// 主人要真的实现了一条，且只有一条；空文件／只有注释不算主人。
const ownerSrc = fs.existsSync(path.join(ROOT, OWNER)) ? fs.readFileSync(path.join(ROOT, OWNER), 'utf8') : '';
const ownerCode = codeLines(ownerSrc).join('\n');
const ownerImpls = SHAPES.reduce((n, s) => n + (ownerCode.match(new RegExp(s.re.source, 'g')) || []).length, 0);
const exportsFn = /export (const|function) parentDir\b/.test(ownerSrc);
(exportsFn && ownerImpls === 1 ? ok : bad)(
  '[2] 主人确实导出了 parentDir，且内部实现恰好一条',
  `export parentDir=${exportsFn} 内部形状次数=${ownerImpls}`);

// 沙盒侧的两个入口（string 形态与 file 形态）要还在并**转发**给主人，
// 否则"收成一份"可能只是把调用点全删了（反向臂：不许靠删掉消费者让 [1] 变绿）。
const aliasSrc = fs.existsSync(path.join(ROOT, SANDBOX_ALIAS)) ? fs.readFileSync(path.join(ROOT, SANDBOX_ALIAS), 'utf8') : '';
const hasName = /export (const|function) dirOfName\b/.test(aliasSrc);
const hasFile = /export (const|function) dirOf\b/.test(aliasSrc);
const delegates = /dirOfName[\s\S]{0,120}?\bparentDir\(/.test(aliasSrc);
const consumers = walk('src').reduce((n, rel) =>
  n + (fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/\b(parentDir|dirOfName|dirOf)\s*\(/g) || []).length, 0);
(hasName && hasFile && delegates ? ok : bad)(
  '[3] 反向臂：沙盒侧两个输入形状都还在并转发给主人（不许靠删消费者变绿）',
  `dirOfName=${hasName} dirOf=${hasFile} 转发=${delegates}｜全仓这三个名字的共现读数=${consumers}`);

console.log(`\n===== 结果: ${pass} pass, ${fail} fail =====`);
process.exit(fail > 0 ? 1 : 0);
