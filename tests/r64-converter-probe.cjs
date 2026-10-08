// r64 只读探针：拖一根**位宽不相等**的线，看应用自动插的那颗转换器到底建成了什么。
// 起因（r63/r23 实测）：5 颗器件拖完变 8 颗（ZeroExtend×2 + BusSlice），
//   数据那颗 1→8 传播正常（in=0 → out=00000000），
//   地址那两颗 2→3 的 **in 恒 x**，而它的上游 Input.out 明明有定义（00）。
// 这里把三件事一次打清：
//   ① 转换器的 ports.items（真正的口 id / group / 方向）；
//   ② 每条 link 的 source/target **全对象**（含 selector/magnet —— 建链时把口名写错就是这个形状）；
//   ③ 拨一下上游 Input 的输出，看转换器的 in 会不会跟着动（不动 ⇒ 引擎压根没把它当输入）。
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PW = require(path.join(ROOT, 'node_modules/playwright-core'));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 1657; const URL = `http://localhost:${PORT}/`;
const UI = require('./_ui.cjs');
const sleep = UI.sleep;
const J = (o) => JSON.stringify(o);

const portCenter = (page, id, port) => page.evaluate(({ id, port }) => {
  const p = window.__sandboxPaper;
  const c = p.model.getCell(id); if (!c) return null;
  const v = c.findView(p); if (!v) return null;
  const el = v.el.querySelector(`.joint-port-body[port="${port}"] circle`) || v.el.querySelector(`[port="${port}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, { id, port });

const drag = async (page, a, b) => {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(150);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 }); await sleep(120);
  await page.mouse.move(b.x, b.y, { steps: 8 }); await sleep(300);
  await page.mouse.up(); await sleep(800);
};

const dump = (page, tag) => page.evaluate((t) => {
  const p = window.__sandboxPaper;
  const cells = p.model.getCells().filter((c) => !c.isLink());
  const sig = (c, key) => Object.entries(c.get(key) || {}).map(([k, v]) => k + '=' + String(v)).join(',');
  return {
    tag: t,
    cells: cells.map((c) => ({
      id: String(c.id).slice(0, 6), type: String(c.get('type')),
      ports: ((c.get('ports') || {}).items || []).map((x) => ({ id: x.id, group: x.group })),
      in: sig(c, 'inputSignals'), out: sig(c, 'outputSignals'),
    })),
    links: p.model.getLinks().map((lk) => ({
      src: lk.get('source'), dst: lk.get('target'),
    })),
  };
}, tag);

(async () => {
  let server, browser;
  try {
    UI.freePort(PORT);
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
    const dl = Date.now() + 45000; while (Date.now() < dl) { try { if ((await fetch(URL)).ok) break; } catch { } await sleep(500); }
    if (!await fetch(URL).then((r) => r.ok).catch(() => false)) { console.log('FATAL 服务没起来'); process.exit(1); }
    browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 140)));
    await page.goto(URL, { waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }
    await page.evaluate(() => import('/src/store/fileStore.ts').then(() => 1).catch(() => 0));
    await sleep(1200);
    await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
    try { await page.locator('button:has-text("跳过"), button:has-text("Skip")').first().click({ timeout: 2500 }); } catch { }

    await UI.enterSandbox(page);
    for (const t of ['Input', 'Memory']) await UI.clickGate(page, t);
    await sleep(500);
    const ids = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter((c) => !c.isLink()).forEach((c) => { (by[String(c.get('type'))] = by[String(c.get('type'))] || []).push(c.id); });
      return by;
    });
    console.log('器件 =', J(Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.map((x) => x.slice(0, 6))]))));
    const inp = ids.Input[0], mem = ids.Memory[0];

    // 把器件摆开，直线不穿第三颗
    await page.evaluate((a) => {
      const p = window.__sandboxPaper;
      p.model.getCell(a.i).position({ x: 80, y: 120 });
      p.model.getCell(a.m).position({ x: 620, y: 80 });
    }, { i: inp, m: mem });
    await sleep(600);
    console.log('\n[拖之前]', J(await dump(page, 'before')));

    const a = await portCenter(page, inp, 'out');
    const b = await portCenter(page, mem, 'wr0addr');
    if (!a || !b) { console.log('FATAL 端口中心拿不到：Input.out=' + J(a) + ' mem.wr0addr=' + J(b)); process.exit(1); }
    await drag(page, a, b);
    const d1 = await dump(page, '拖完（未拨输入）');
    console.log('\n[拖完]', J(d1));
    const ze = d1.cells.find((c) => /ZeroExtend|BusSlice|SignExtend/.test(c.type));
    console.log('  自动插的转换器 =', J(ze || null));

    // 拨一下上游 Input 的输出，看转换器的 in 跟不跟着动
    const before = d1.cells.find((c) => c.id === inp.slice(0, 6));
    const ip = await page.evaluate((id) => {
      const p = window.__sandboxPaper; const v = p.model.getCell(id).findView(p);
      const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, inp);
    await page.mouse.click(ip.x, ip.y); await sleep(900);
    const d2 = await dump(page, '拨过 Input 之后');
    const after = d2.cells.find((c) => c.id === inp.slice(0, 6));
    const ze2 = d2.cells.find((c) => /ZeroExtend|BusSlice|SignExtend/.test(c.type));
    console.log('\n[拨过 Input]', J(d2.links));
    console.log('  Input.out :', J(before && before.out), '→', J(after && after.out));
    console.log('  转换器 in :', J(ze && ze.in), '→', J(ze2 && ze2.in));
    console.log('  转换器 out:', J(ze && ze.out), '→', J(ze2 && ze2.out));
    const memCell = d2.cells.find((c) => c.type === 'Memory');
    console.log('  Memory in :', J(memCell && memCell.in));

    // ④ 扇出：同一颗 Input 再接第二颗入口（rd0addr）。r23 留下的 in=xx 就出现在这一跳之后，
    //    所以这一格专门分清"第二跳把第一跳刚建好的转换器输入侧拆了"还是别的。
    const c3 = await portCenter(page, inp, 'out');
    const d3 = await portCenter(page, mem, 'rd0addr');
    if (c3 && d3) {
      await drag(page, c3, d3);
      const t1 = await dump(page, '第二跳（扇出到 rd0addr）之后');
      console.log('\n[第二跳之后] links =', J(t1.links));
      console.log('  器件 =', J(t1.cells.map((c) => c.id + ':' + c.type + ' in[' + c.in + '] out[' + c.out + ']')));
      // 再拨一次，看两跳是否都跟着动
      await page.mouse.click(ip.x, ip.y); await sleep(900);
      const t2 = await dump(page, '再拨一次');
      console.log('  再拨之后 器件 =', J(t2.cells.map((c) => c.id + ':' + c.type + ' in[' + c.in + '] out[' + c.out + ']')));
      const bad = t2.cells.filter((c) => /x/.test(c.in) && c.type !== 'Memory');
      console.log('  ⇒ 输入侧仍带 x 的非-Memory 器件 =', J(bad.map((c) => c.id + ':' + c.type + ' in[' + c.in + ']')));
      console.log('  ⇒ links 里 target 口名与各器件 ports.items 的 id 对照 =',
        J(t2.links.map((l) => {
          const src = t2.cells.find((c) => String(l.src.id).startsWith(c.id));
          const dst = t2.cells.find((c) => String(l.dst.id).startsWith(c.id));
          const okS = src && src.ports.some((p) => p.id === l.src.port);
          const okT = dst && dst.ports.some((p) => p.id === l.dst.port);
          return (src && src.id) + '.' + l.src.port + (okS ? '' : '(口不存在)') + '→' + (dst && dst.id) + '.' + l.dst.port + (okT ? '' : '(口不存在)');
        })));
    } else console.log('\n第二跳端口中心拿不到：Input.out=' + J(c3) + ' mem.rd0addr=' + J(d3) + '（这一格不作数）');
    console.log('\n判读提示：Input.out 变了而转换器 in 不动 ⇒ 链路在引擎里没接上（看 links 里 target 的口名与 ports.items 的 id 是否一致）。');
    console.log('  links 里 target.port 与转换器 ports.items 的 id **对不上** ⇒ 建链时口名写错；对得上还不传 ⇒ 引擎侧的端口绑定问题。');

    // ⑤ 最后一个没试过的变量：**先把 Input 位宽从 1 改成 2（右键菜单），再接线** —— 这正是 r23 的顺序。
    //    上面 ①～④ 都没改位宽，所以 r23 的 in=xx 只可能和这一步有关。
    const setBits = async (pg, id, n) => {
      const pt = await pg.evaluate((x) => {
        const p = window.__sandboxPaper; const v = p.model.getCell(x).findView(p);
        const r = v.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, id);
      await pg.mouse.click(pt.x, pt.y, { button: 'right' }); await sleep(500);
      const inp = pg.locator('input[placeholder="bits"]');
      if (!(await inp.count())) throw new Error('setBits: 右键菜单里没有 bits 输入框');
      await inp.fill(String(n)); await sleep(200);
      await inp.press('Enter'); await sleep(600);
      await pg.keyboard.press('Escape'); await sleep(400);
    };
    await UI.newSandboxFile(page);
    await sleep(600);
    for (const t of ['Input', 'Memory']) await UI.clickGate(page, t);
    const ids2 = await page.evaluate(() => {
      const p = window.__sandboxPaper; const by = {};
      p.model.getCells().filter((c) => !c.isLink()).forEach((c) => { (by[String(c.get('type'))] = by[String(c.get('type'))] || []).push(c.id); });
      return by;
    });
    const inp2 = ids2.Input[0], mem2 = ids2.Memory[0];
    await page.evaluate((a) => {
      const p = window.__sandboxPaper;
      p.model.getCell(a.i).position({ x: 80, y: 320 });
      p.model.getCell(a.m).position({ x: 620, y: 280 });
    }, { i: inp2, m: mem2 });
    await sleep(500);
    await setBits(page, inp2, 2);
    const pre = await dump(page, '⑤ 改位宽后、接线前');
    console.log('\n[⑤ 改过位宽的 Input] =', J(pre.cells.find((c) => c.id === inp2.slice(0, 6))));
    const a5 = await portCenter(page, inp2, 'out');
    const b5 = await portCenter(page, mem2, 'wr0addr');
    if (a5 && b5) {
      await drag(page, a5, b5);
      const d5 = await dump(page, '⑤ 接线完');
      console.log('  ⑤ links =', J(d5.links));
      console.log('  ⑤ 器件 =', J(d5.cells.map((c) => c.id + ':' + c.type + ' in[' + c.in + '] out[' + c.out + ']')));
      const ze5 = d5.cells.filter((c) => /ZeroExtend|BusSlice|SignExtend/.test(c.type));
      const xSide = ze5.filter((c) => /x/.test(c.in));
      console.log('  ⇒ 转换器', ze5.length, '颗，输入侧带 x 的 =', J(xSide.map((c) => c.id + ':' + c.type + ' in[' + c.in + '] out[' + c.out + ']')));
      console.log('  ⇒ 上游 Input 现在是', J(d5.cells.find((c) => c.id === inp2.slice(0, 6))));
      console.log(xSide.length
        ? '  ⚠ 复现成功：先改位宽再接线 ⇒ 转换器输入侧读 x（r23 那三格红就是这条，属产品侧）'
        : '  没复现：改位宽后链路仍正常 ⇒ r23 的 x 另有原因，得回 r23 现场继续找');
    } else console.log('  ⑤ 端口中心拿不到（这一格不作数）：', J(a5), J(b5));
    console.log('页面异常=', perr.slice(0, 3));
  } catch (e) { console.log('FATAL ' + String(e.stack || e).slice(0, 400)); }
  finally { if (browser) await browser.close().catch(() => { }); if (server) server.kill(); UI.freePort(PORT); }
})();
