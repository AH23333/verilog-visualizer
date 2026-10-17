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
//   [7] 句式·源码层：**生产侧文件集合**（`App.tsx` + 组件 + `src/hooks/*`）里 `setMessage(...)` 实参
//       按同一条句式规则数出来必须是 0 句英文（V2b 的完整射程＝50 处，见 docs/PROJECT_DEEP_REVIEW §卷六；
//       摘取器与 [6] 共用 `_ui.cjs` 一份）。⚠ 集合含 hooks 是 R136 补的：R132 把编译管线搬进
//       `useCompilePipeline.ts` 后，只扫 App.tsx 会让这一格**看不见搬家后的句子**（假绿灯）。
//       ⚠ `Compiling...` 这类**单词句**不在句式规则射程内（规则要 ≥2 个单词），但这一批也一并改成了中文。
const { spawn } = require('child_process');
const path = require('path'); const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules', 'playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1583;
try { process.on('exit', () => require('./_ui.cjs').reapViteByPort(1583)); } catch { } const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
// 夹具按末段名解析（test_files/ 会被用户在产品里整理）：见 tests/fixtures.cjs
const { fixture } = require('./fixtures.cjs');
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

/** 屏幕上可见的**整句英文**行（用 _ui.cjs 那份共用的句式规则，⛔ 列禁字清单） */
const screenEnglishLines = (page) => page.evaluate(() => {
  return (document.body.innerText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}).then((lines) => lines.filter((l) => UI.isEnglishSentence(l)));

/** 屏幕上有汉字（"没把句子删光冒充修好"的分母） */
const screenHasChinese = (page) => page.evaluate(() => /[一-鿿]/.test(document.body.innerText || ''));

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn(process.execPath, [require('path').join(__dirname, '..', 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { windowsHide: true, cwd: ROOT, stdio: 'ignore' });
    server.unref?.();
    const dl = Date.now() + 45000;
    while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 160)));
    // ⛔ 用 UI.boot（它等 `button[data-activity]`，那颗活动栏只活在 gates.html 的外壳里）：
    // 这一档量的是编译画布＝index.html（CanvasApp 残体），照 tests/r42-verify.cjs 的 L1 走 goto。
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    // 宿主桩：片 5「全面原生」后错误的出口只剩 `host.publishProblems`/`appendOutput`
    //（旧 OutputPanel / PROBLEMS 面板随旧 React UI 退役）⇒ 屏幕判据之外，问题单从宿主 RPC 载荷现读。
    await UI.installHostStub(page);

    // [1] 空态：还没有电路那一屏（旧那颗「切换输出面板」的状态栏按钮随旧 UI 退役，
    //     现在屏幕上唯一的空态文字就是画布占位那两句 ⇒ 判据同一件事：看得见的是中文、没有英文残留）
    await sleep(800);
    const emptyHit = await screenHas(page, EN.slice(0, 2));
    const emptyEng = await screenEnglishLines(page);
    const emptyZh = await screenHasChinese(page);
    console.log('  [空态] 命中英文=', J(emptyHit), ' 整句英文行=', J(emptyEng), ' 有中文=', emptyZh);
    (emptyHit.length === 0 && emptyEng.length === 0 && emptyZh ? ok : bad)('[1] 空态那几句是中文（屏幕上直接读：无英文残留 + 确有中文）',
      `英文残留=${J(emptyHit)} 整句英文=${J(emptyEng)} 中文=${emptyZh}`);

    // 装一份门级网表并真编译（旧 fileStore.addFile + 『编译』按钮 → 宿主推送单，同一条 yosys-wasm 路径）
    await UI.pushCompile(page, {
      files: [{ name: 'test_counter.v', content: fs.readFileSync(fixture('test_counter.v'), 'utf8') }],
      topModule: 'counter', entryName: 'test_counter.v',
    });
    // 读屏：错误态的落点是「问题单 + 画布上没有电路」，⛔ 读内部 store 状态
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      const got = await page.evaluate(() => {
        const req = (window.__vvReq || []).find((x) => x.method === 'publishProblems');
        const r = (window.__djsDebug && window.__djsDebug.getPaper && window.__djsDebug.getPaper());
        return {
          items: req && req.args ? (req.args.items || []) : null,
          cells: r ? r.model.getCells().filter((c) => c.get('type') !== 'link').length : 0,
        };
      });
      if (got.items) st = { status: got.items.length ? 'error' : 'compiled', items: got.items, cells: got.cells };
      if (st) break;
    }
    await sleep(2000);
    console.log('  [编译后状态]', J(st && { status: st.status, 条数: st.items.length, cells: st.cells, 首条: st.items[0] }));

    const hit2 = await screenHas(page, EN);
    const eng2 = await screenEnglishLines(page);
    const zh2 = await screenHasChinese(page);
    const msgs = st && st.items ? st.items.map((i) => String(i.message || '')) : [];
    const msgEng = msgs.filter((m) => UI.isEnglishSentence(m));
    console.log('  [错误态屏幕] 英文残留=', J(hit2), ' 整句英文行=', J(eng2), ' 有中文=', zh2, ' 问题单=', J(msgs.slice(0, 4)));
    (st && st.status === 'error' && hit2.length === 0 && eng2.length === 0 && zh2 && msgs.length > 0 && msgEng.length === 0 ? ok : bad)(
      '[2] 门级网表拒编译后：屏幕与交给宿主的问题单都是中文（英文残留为零）',
      `status=${J(st && st.status)} 英文=${J(hit2)} 整句英文=${J(eng2)} 中文=${zh2} 问题单英文句=${J(msgEng)}`);
    // ⚠ 那三句**具体措辞**（'接口校验未通过'/'编译出错'/'按 F5'）的主人是旧 OutputPanel 与状态栏，
    // 两颗都随旧 React UI 退役了（`src/App.tsx`、`src/components/OutputPanel.tsx` 已不在仓里）
    // ⇒ 新屏幕上没有任何一颗控件承载它们，这一臂不作数（照本档 skip 的口径登记）。
    const retiredPhrases = await page.evaluate((list) => {
      const t = (document.body.innerText || '').replace(/\s+/g, ' ');
      return list.filter((s) => t.includes(s));
    }, ['接口校验未通过', '编译出错', '按 F5']);
    skip('[2b] 旧三句措辞（接口校验未通过 / 编译出错 / 按 F5）在屏幕上可见',
      `命中=${J(retiredPhrases)}｜那三句的宿主（OutputPanel/状态栏）已退役，问题单现在由 workbench 渲染`);

    // PROBLEMS 的行号（宿主 RPC 载荷层再证一次 V1：workbench 就是把这份 items 画进 PROBLEMS 的）
    const items = st && st.items ? st.items : [];
    const nums = items.map((i) => (i && i.line != null ? Number(i.line) : null));
    console.log('  [问题单]', J(items.map((i) => `${i.fileName}:${i.line}`).slice(0, 6)), ' 读到行号=', J(nums));
    (items.length === 0 ? skip : J(nums) === J([8, 9, 10, 11]) ? ok : bad)(
      '[3] PROBLEMS 列表里显示的行号＝8/9/10/11（V1 在屏幕层的再证）',
      items.length === 0 ? '一条都没读到（宿主没收到 publishProblems，不作数）' : `读到=${J(nums)}（共 ${items.length} 条）`);
    await UI.uninstallHostStub(page);

    // 形状闸门：源码里那四句英文必须绝迹（整句 + 子串两种措辞）
    // ⚠ 集合要跟着"文案住在哪"长：R132 的 `App.tsx`/`OutputPanel.tsx` 与 R153 的
    //   `hooks/useCompilePipeline.ts` 都随旧 React UI 退役了（仓里已不存在）。
    //   只盯那两颗已删的文件＝看不见东西的**假绿灯** ⇒ 现在按**整棵 src/ 生产侧**递归扫，
    //   射程只会比旧集合大，不会变小。
    const walkSrc = (rel, acc = []) => {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) return acc;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const p = rel + '/' + e.name;
        if (e.isDirectory()) { walkSrc(p, acc); continue; }
        if (/[.](ts|tsx|js)$/.test(e.name)) acc.push(p);
      }
      return acc;
    };
    const presentFiles = walkSrc('src');
    const joined = presentFiles.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    const whole = EN.filter((s) => joined.includes(s));
    const parts = ['Code is clean', 'No output yet', 'validation failed', 'No problems'].filter((s) => joined.includes(s));
    (whole.length === 0 && parts.length === 0 ? ok : bad)('[4] 这几句英文在源码里绝迹（整句与关键子串各查一遍，防换词绕过）',
      `整句命中=${J(whole)} 子串命中=${J(parts)}（扫过 ${presentFiles.length} 颗 src 文件）`);
    const hasZh = ZH.filter((s) => joined.includes(s));
    // 那五句中文的宿主（OutputPanel 空态 + 状态栏）已整颗退役 ⇒ 源码里本来就没有它们，
    // 这一臂今天够不着判据（⛔ 把"文件没了"记成产品坏了，也⛔ 记成通过）。
    (hasZh.length >= 4 ? ok
      : (!fs.existsSync(path.join(ROOT, 'src/App.tsx')) && !fs.existsSync(path.join(ROOT, 'src/components/OutputPanel.tsx')) ? skip : bad))(
      '[4b] 对应中文确实在源码里（不是把句子删了冒充修好）',
      `命中 ${hasZh.length}/${ZH.length}：${J(hasZh)}｜那五句的主人 App.tsx / OutputPanel.tsx 已随旧 UI 删除，` +
      `新屏上唯一的中文字出口是 ${J(presentFiles.filter((f) => /CanvasApp|useHostCompile|verilogParse/.test(f)).map((f) => path.basename(f)))}`);

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
    const litByFile = presentFiles.map((f) => ({
      f, hits: UI.setMessageLiterals(fs.readFileSync(path.join(ROOT, f), 'utf8')),
    }));
    const lit = litByFile.reduce((n, x) => n + x.hits.length, 0);
    const apiGone = !/setMessage\(/.test(joined);
    (apiGone ? skip : lit === 0 ? ok : bad)(
      '[7] 生产侧（App + 组件 + 编译 hooks）里 setMessage 的实参按句式数出来是 0 句英文（V2b 全量）',
      apiGone ? `整棵 src/ 的 ${presentFiles.length} 颗生产侧文件里共 0 处 \`setMessage(\`：那颗状态栏出口随旧 React UI 退役，这条句式尺今天没有被测对象`
        : `命中 ${lit} 处：${J(litByFile.filter((x) => x.hits.length).slice(0, 5).map((x) => `${x.f}@${x.hits[0].line}:${x.hits[0].text}`))}｜扫过 ${presentFiles.length} 颗文件`);
    const zh2b = ['正在编译', '已保存文件', '剪贴板', '仿真运行中', '已跳到', '缺少模块实现', '浏览模式', '高亮'];
    const gotZh = zh2b.filter((w) => joined.includes(w));
    (gotZh.length === zh2b.length ? ok : apiGone ? skip : bad)('[7b] 对应中文确实在源码里（不是把句子删了冒充修好）',
      `命中 ${gotZh.length}/${zh2b.length}，缺=${J(zh2b.filter((w) => !gotZh.includes(w)))}（扫过 ${presentFiles.length} 颗 src 文件${apiGone ? '；那批句子原本住在已退役的状态栏/OutputPanel' : ''}）`);

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
