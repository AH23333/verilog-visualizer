// 夹具解析器自己的证人（R153 之后的裁决：闸门⛔ 认死 test_files 路径）。
// 三颗臂各对应 `bin/C3/bench_c3_fixture.py` 里一颗变异（⛔ 让任何一格没有臂能打破——名册尺口径）。
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fixture, fixtureText, FIXTURE_DIR } = require('../fixtures.cjs');

describe('夹具按末段名解析', () => {
  it('正件：叫得出名字就拿得到文件，且**只锁末段**（用户把夹具搬进任何子目录都⛔ 打断闸门）', () => {
    const abs = fixture('adder.v');
    expect(path.basename(abs)).toBe('adder.v');
    expect(abs.startsWith(FIXTURE_DIR)).toBe(true);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fixtureText('adder.v')).toContain('module');
    // 这颗断言⛔ 写成"必须在 examples/ 或必须在顶层"——那就回到认死路径了
    expect(path.relative(FIXTURE_DIR, abs).split(path.sep).length).toBeGreaterThanOrEqual(1);
  });

  it('同名多颗＝报清单停手（⛔ 挑一颗：那会让闸门在"看起来绿"的状态下测到别的东西）', () => {
    const dir = path.join(FIXTURE_DIR, '__dup_probe__');
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.copyFileSync(fixture('adder.v'), path.join(dir, 'adder.v'));
      let msg = '';
      try { fixture('adder.v'); } catch (e) { msg = String(e.message); }
      expect(msg).toContain('同名多颗');
      expect(msg).toContain('__dup_probe__');      // 两颗候选都得念出来
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(fs.existsSync(dir)).toBe(false);        // 探针档⛔ 留在仓库里
  });

  it('查无＝抛并报出现场（⛔ 交回空串让上层 readFileSync 报一颗看不懂的 ENOENT）', () => {
    let msg = '';
    try { fixture('__这名字谁都没用过.v__'); } catch (e) { msg = String(e.message); }
    expect(msg).toContain('夹具查无');
    expect(/现有 \d+ 颗/.test(msg)).toBe(true);
    expect(msg).toContain('adder.v');              // 现场清单里能看到真有的那颗
  });
});
