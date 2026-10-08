// R83 验收（深度自检卷五新增缺陷 V2）：**错误态与空态那几句界面文字必须是中文**，
// 而且要在**屏幕上**成立（形状闸门绿不等于屏幕对——那句英文可以躲在没被渲染到的分支里）。
//
// 修前的实锤（卷五 s1 截图）：门级网表拒编译之后，画布中央整段是英文
//   「Compilation error」/「Interface validation failed: 4 error(s)」/「No problems. Code is clean.」。
// 这一轮已把它们换进中文（App.tsx / OutputPanel.tsx 各若干处）。
//
// 臂（射程各自说清）：
//   [1] 输出面板**空态**两颗标签：屏幕上看不到那两句英文，且看得到对应中文；
//   [2] 真编译 test_counter.v（拿不到 net 名的门级网表）⇒ 状态条 + 画布占位是中文，
//       并含「接口校验未通过：4 处错误」这句；
//   [3] PROBLEMS 列表里四行行号互不相同且等于 8/9/10/11 —— 这是 V1 的修复**在屏幕上**的再证一次
//       （r81 钉的是结构化字段，那一臂看不见渲染层）；
//   [4] 形状闸门：源码里不许再出现那四句英文（整句 + 关键子串两种措辞各咬一次，防换词绕过）。
//   [6] 句式·屏幕层：状态栏那颗 `[data-status-message]` 上**显示出来的**句子不许是整句英文
//       （采样两颗时刻：错误态那句＋点 PROBLEMS 跳行之后那句）。⛔ 不扫整页——整页含 Verilog 源码，
//       那样判据恒红。
//   [7] 句式·源码层：`App.tsx` 里 `setMessage(...)` 实参按同一条句式规则数出来必须是 0 句英文
//       （V2b 的完整射程＝50 处，见 docs/PROJECT_DEEP_REVIEW §卷六；摘取器与 [6] 共用 `_ui.cjs` 一份）。
//       ⚠ `Compiling...` 这类**单词句**不在句式规则射程内（规则要 ≥2 个单词），但这一批也一并改成了中文。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1583;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1583)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);
let pass = 0, fail = 0, unverified = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const skip = (n, d) => { unverified++; console.log(`  UNVERIFIED  ${n}（${d}）`); };

const EN = [
  'No problems. Code is clean.',
  'No output yet. Press F5 to compile.',
  'Interface validation failed:',
  'Compilation error',
  'Press F5 to compile. Check Output panel for details.',
  'Not compiled',
];
const ZH = ['没有问题', '还没有输出', '接口校验未通过', '编译出错', '按 F5'];

/** 屏幕上有没有出现某句英文（整页 innerText，含状态条/画布占位/面板） */
const screenHas = (page, needles) => page.evaluate((list) => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  return list.filter((s) => t.includes(s));
}, needles);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    await UI.boot(page, URL);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    // 先把输出面板打开（空态），读两颗标签。锚点＝状态栏那颗「输出」（App.tsx 里 title="切换输出面板 (Ctrl+J)"）
    const outBtn = page.locator('span[title^="切换输出面板"]').first();
    if (!(await outBtn.count())) { console.log('FATAL 状态栏没有「切换输出面板」那颗，前置没成'); process.exit(1); }
    await outBtn.click();
    await sleep(1200);
    const emptyHit = await screenHas(page, EN.slice(0, 2));
    const emptyZh = await page.evaluate((list) => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ');
      return list.filter((s) => t.includes(s));
    }, ['没有问题', '还没有输出']);
    console.log('  [空态] 命中英文=', J(emptyHit), ' 命中中文=', J(emptyZh));
    (emptyHit.length === 0 && emptyZh.length >= 1 ? ok : bad)('[1] 输出面板空态那两句是中文（屏幕上直接读）',
      `英文残留=${J(emptyHit)} 中文=${J(emptyZh)}`);

    // 装一份门级网表并真点编译
    await page.evaluate(async (src) => {
      const { fileStore } = await import('/src/store/fileStore.ts');
      fileStore.addFile('test_counter.v', src);
    }, fs.readFileSync(path.join(ROOT, 'test_files', 'test_counter.v'), 'utf8'));
    await sleep(1200);
    await page.locator('[title="test_counter.v"]').first().click({ force: true }).catch(() => { });
    await sleep(900);
    const compBtn = page.locator('button[title^="编译"], button[title^="Compile"]').first();
    if (!(await compBtn.count())) { console.log('FATAL 找不到编译按钮'); process.exit(1); }
    await compBtn.click();
    let st = null;
    for (let i = 0; i < 70; i++) {
      await sleep(700);
      st = await page.evaluate(async () => {
        const { fileStore } = await import('/src/store/fileStore.ts');
        const f = fileStore.getAll().find((x) => x.name === 'test_counter.v') || fileStore.getAll()[0];
        return f ? { status: String(f.status), errorMessage: String(f.errorMessage || '') } : null;
      });
      if (st && (st.status === 'error' || st.status === 'compiled')) break;
    }
    await sleep(3000);
    console.log('  [编译后状态]', J(st));

    const hit2 = await screenHas(page, EN);
    const zh2 = await page.evaluate((list) => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ');
      return list.filter((s) => t.includes(s));
    }, ['接口校验未通过', '编译出错', '按 F5']);
    console.log('  [错误态屏幕] 英文残留=', J(hit2), ' 中文=', J(zh2));
    (st && st.status === 'error' && hit2.length === 0 && zh2.length >= 1 ? ok : bad)(
      '[2] 门级网表拒编译后：状态条与画布占位都是中文（英文残留为零）',
      `status=${J(st && st.status)} 英文=${J(hit2)} 中文=${J(zh2)}`);

    // PROBLEMS 那几行的行号（屏幕层再证一次 V1）
    const rows = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[title*="点击跳转"], [title*="未定位到行"]'));
      return els.map((e) => String(e.getAttribute('title') || ''));
    });
    // 标题形状是「test_counter.v:8 — 点击跳转到该行」（行号后面还有话），别按"结尾"取数
    const nums = rows.map((r) => { const m = r.match(/:(\d+)\s*—/); return m ? Number(m[1]) : null; });
    console.log('  [PROBLEMS 行]', J(rows.slice(0, 6)), ' 读到行号=', J(nums));
    (rows.length === 0 ? skip : J(nums) === J([8, 9, 10, 11]) ? ok : bad)(
      '[3] PROBLEMS 列表里显示的行号＝8/9/10/11（V1 在屏幕层的再证）',
      rows.length === 0 ? '一行都没读到（锚点或面板状态不对，不作数）' : `读到=${J(nums)}（共 ${rows.length} 行）`);

    // 形状闸门：源码里那四句英文必须绝迹（整句 + 子串两种措辞）
    const srcFiles = ['src/App.tsx', 'src/components/OutputPanel.tsx', 'src/components/Canvas.tsx'];
    const joined = srcFiles.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    const whole = EN.filter((s) => joined.includes(s));
    const parts = ['Code is clean', 'No output yet', 'validation failed', 'No problems'].filter((s) => joined.includes(s));
    (whole.length === 0 && parts.length === 0 ? ok : bad)('[4] 这几句英文在源码里绝迹（整句与关键子串各查一遍，防换词绕过）',
      `整句命中=${J(whole)} 子串命中=${J(parts)}`);
    const hasZh = ZH.filter((s) => joined.includes(s));
    (hasZh.length >= 4 ? ok : bad)('[4b] 对应中文确实在源码里（不是把句子删了冒充修好）', `命中 ${hasZh.length}/${ZH.length}：${J(hasZh)}`);

    // ===== [6] 状态栏那句反馈语按**句式**验（V2b 的射程：不列禁字清单）=====
    // ⚠ 只读那颗 `[data-status-message]`，不能扫整页 innerText：编辑器里就是 Verilog 源码，
    //   整页必然含英文句子（那样判据恒红，等于没有判据）。
    const grab = () => page.evaluate(() => (document.querySelector('[data-status-message]') || {}).textContent ?? null);
    const samples = [{ at: '接口校验失败后', text: await grab() }];
    const firstProblem = page.locator('[title*="点击跳转"]').first();
    if (await firstProblem.count()) {
      await firstProblem.click(); await sleep(1000);
      samples.push({ at: '点 PROBLEMS 跳行之后', text: await grab() });
    }
    const offenders = samples.filter((s) => s.text && UI.isEnglishSentence(s.text));
    console.log('  [状态栏采样]', J(samples));
    (samples.every((s) => !s.text) ? skip : offenders.length === 0 ? ok : bad)(
      '[6] 状态栏实际显示出来的那句话里没有"整句英文"（采样两颗时刻）',
      samples.every((s) => !s.text) ? '一颗都没读到（`[data-status-message]` 锚点或前置不对，不作数）'
        : `采样=${J(samples.map((s) => s.text))} 违例=${J(offenders.map((o) => o.text))}`);

    // ===== [7] 源码层同一条句式规则：`setMessage(...)` 里不许再留整句英文 =====
    //   与 [6] 配对：[6] 管"看得见的"，[7] 管"躲在没被走到的分支里"的（那一族屏幕闸门看不见）。
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const lit = UI.setMessageLiterals(appSrc);
    (lit.length === 0 ? ok : bad)('[7] App.tsx 里 setMessage 的实参按句式数出来是 0 句英文（V2b 全量）',
      `命中 ${lit.length} 处：${J(lit.slice(0, 5).map((h) => `${h.line}:${h.text}`))}`);
    const zh2b = ['正在编译', '已保存文件', '剪贴板', '仿真运行中', '已跳到', '缺少模块实现', '浏览模式', '高亮'];
    const present = zh2b.filter((s) => appSrc.includes(s));
    (present.length === zh2b.length ? ok : bad)('[7b] 对应中文确实在源码里（不是把句子删了冒充修好）',
      `命中 ${present.length}/${zh2b.length}，缺=${J(zh2b.filter((s) => !present.includes(s)))}`);

    (perr.length ? bad : ok)('[5] 全程无页面异常', perr.slice(0, 3).join(' | '));
    console.log(`\n===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    await browser.close();
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    fail++;
    console.log('FATAL', String(e).slice(0, 300));
    console.log(`===== 结果: ${pass} pass, ${fail} fail, ${unverified} 未验证 =====`);
    try { await browser?.close(); } catch { }
    process.exit(1);
  } finally {
    try { server?.kill('SIGKILL'); } catch { }
  }
})();
