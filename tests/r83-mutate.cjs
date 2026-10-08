// R83 反向探针（V2b 那三颗新臂）：把「已跳到 …」那句改回英文，[6]/[7]/[7b] 必须同时红，其余各臂必须绿。
//
// ⚠ 这一颗自己就出过一次事故（记在这里免得再犯）：原来在 `try` 里就 `process.exit()`，
//   `finally` 的还原没走完 ⇒ **两行英文留在了 src/App.tsx 上**，而台架自己报"已还原"。
//   现在改成：判定先记账，跑完必还原，**还原后重读文件逐字节比对**，比对不上就非零退出并大声说。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'App.tsx');
const ORIG = fs.readFileSync(FILE, 'utf8');
const FROM = 'setMessage(`已跳到 ${fileName}:${line}`);';
const TO = 'setMessage(`Jumped to ${fileName}:${line}`);';

let verdict = 0;
try {
  const n = ORIG.split(FROM).length - 1;
  if (n !== 2) { console.log(`★锚点 ${n} 次（要 2）—— 不动文件`); verdict = 1; }
  else {
    fs.writeFileSync(FILE, ORIG.split(FROM).join(TO));
    const r = spawnSync('node', ['tests/r83-errorcopy-gate.cjs'], { cwd: ROOT, encoding: 'utf8', timeout: 420000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const map = {};
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*(PASS|FAIL|UNVERIFIED)\s+\[([\w.]+)\]/.exec(line);
      if (m && !map[m[2]]) map[m[2]] = m[1];
    }
    console.log('  逐格', Object.keys(map).sort().map((k) => `${k}:${map[k]}`).join(' '));
    const wantRed = ['6', '7', '7b'], wantGreen = ['1', '2', '3', '4', '4b', '5'];
    const hit = wantRed.every((k) => map[k] === 'FAIL');
    const kept = wantGreen.every((k) => map[k] === 'PASS');
    console.log(`${hit && kept ? '咬住' : '★没咬住'}：该红=${JSON.stringify(wantRed)} 该绿=${JSON.stringify(wantGreen)} 实际=${JSON.stringify(map)}`);
    if (!hit || !kept) verdict = 1;
  }
} finally {
  fs.writeFileSync(FILE, ORIG);
  const back = fs.readFileSync(FILE, 'utf8');
  if (back !== ORIG) { console.log('★还原后内容与快照不一致（这跑不作数，先手工核对 src/App.tsx）'); verdict = 1; }
  else console.log(`  已还原并逐字节比对一致（「已跳到」${(back.match(/已跳到/g) || []).length} 处、'Jumped to' ${(back.match(/Jumped to/g) || []).length} 处）`);
  process.exit(verdict);
}
