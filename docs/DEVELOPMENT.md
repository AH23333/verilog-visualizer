# 开发与测试 / Development

> 贡献者指南：环境、脚本、闸门体系、提交与账本规范。
> Contributor guide: environment, scripts, the gate system, commit & ledger conventions.

---

## 中文

### 环境与脚本

```bash
pnpm install
pnpm dev            # Vite dev server → http://localhost:1420（浏览器预览）
pnpm tauri dev      # 桌面窗口（需 Rust；Windows 另需 MSVC + WebView2）
pnpm build          # tsc --noEmit && vite build —— 提交前必过
pnpm tauri build    # 发布构建
```

TypeScript `strict` 全开（含 noUnusedLocals/noUnusedParameters）；**0 错误是最低门槛**。

### 质量闸门体系（本项目核心纪律）

`tests/` 是 Playwright 驱动的验收闸门（headless Edge 对本地 Vite，端口各自独立、自管理）。

```bash
node tests/run-all.cjs              # 全量跑批（70+ 格）
node tests/r123-cycle-gate.cjs      # 单跑一个闸门
node tests/r84-mutate.cjs           # 变异台架：破坏功能验证闸门真的会红
node tests/r84-mutate.cjs --check   # 只读校验台账（不实际打补丁）
```

**规矩**（每条都有过血泪史，违反即返工）：
1. **新能力必配新闸门**，闸门进 `run-all.cjs` GATES 清单才算存在。
2. **三态判定**：pass / fail / **未验证**。「环境没跑成」不许冒充绿灯（NOVERDICT 有专门记法）。
3. **判据读模型与 DOM 读数，不读 toast 文案**——UI 文案会改，断言不许硬编码界面字符串。
4. **闸门红了先归因三选**：脚本前置错误 / 断言语义错 / 真回归——用诊断探针取读数再定性，
   禁止放宽断言放行（改信号守闸门，不改闸门迁就信号）。
5. **变异台架**：feature 闸门配 mutate 脚本，摘掉实现必须咬红对应格；证人名单与
   预期红绿登记在 mutate 台账里。
6. 夹具公共层在 `tests/_ui.cjs`（boot 不等 networkidle、palette 展开、遮罩安全点击、
   reapViteByPort 端口回收）——新闸门复用，不复制粘贴。
7. **成品类判据读产物字节，并与现态配对**：导出（SVG/JSON/网表）一律下载文件后解析文件内容，
   再与 live paper 的读数比对（底色、文字色、器件数…）。⛔ 把导出的 SVG `innerHTML` 注回本页面量它——
   那棵子树里 `getComputedStyle(el).fill` 读出**空串**、`getBBox()` 恒 0，会把好文件判成坏文件（R135 实测）。
8. `page.waitForEvent('download')` 这类"先挂等再点"的 promise **必须当场 catch 一个空转**：
   点击一失败就没人等它，20s 后以 unhandled rejection 打死整个闸门进程，读起来像产品崩了。

### lib 层单测（vitest）

```bash
pnpm test                 # = vitest run，命中 tests/unit/**.test.ts
```

- 用途：锁定 `src/lib/*` 纯函数的**当前实测行为**（Verilog 解析、冲突分级、电路后处理…）。
  UI 层重写（VS Code 套壳）时 lib 不动，这层就是迁移安全网；UI 行为仍归 Playwright 闸门。
- `tests/unit` 已进 `tsconfig.include` ⇒ 单测文件也受 `tsc` 检查（⛔ 让它游离在外，等于没有证人）。
- ⚠ 仓内**没有 vitest 配置**：默认 include 恰好只命中 `tests/unit/**.test.ts`；若往 `src` 下放
  `*.test.ts`，会被 `pnpm test` 一起收走——要隔离就先加 `test.include`，别到时无处解释。
- 期望值一律"按实测写"（R135：`parseVerilogInstances` 返回的是**外部模块名**而非实例名、
  `normalizeIoLabels` 只在 `attrs.label.text` 已存在时同步）。凭函数名/印象写用例＝当场红。

### 提交规范

- 格式：`type(scope): 摘要`（feat/fix/test/docs/refactor/chore + 中文摘要可）；
  批次号 `R<n>` 前缀沿用（`feat(沙盒): R124 …`）。
- 每个 R 批次 = **实现 + 闸门 + 账本** 三笔（或一个提交序列），缺一视为半成品
  （R122 半成品被驳回的教训，账本卷二十八有全案）。
- 多行/含引号消息**一律落盘临时文件 `git commit -F`**（PowerShell 内嵌引号必炸）。
- 作者身份经环境变量注入（`GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL`），**不改 git config**。
- push 前 `git fetch` + 核对 `ahead/behind`（历史上发生过本地/远端双向分叉）。

### 账本规范

`docs/PROJECT_DEEP_REVIEW_2026-10-05.md` 是持续追加的整改账本：
- 每卷 = 一个批次或一次报障的「**根因 → 修复 → 验证读数**」全链；
- 判据自身的错误要**如实记录**（「闸门两处判据自纠」式条目）；
- 未做登记 ≠ 缺陷结论：没做的事写进「未闭清单」，不许沉默蒸发；
- 新卷接在文件尾部，卷号递增，不回填改史。

### 代码风格红线（从账本沉淀）

- 吞异常必须带语义：`catch { /* best effort */ }` / `catch { /* corrupted */ }`——空 catch 不许新增。
- `as any` 集中在 digitaljs/joint 边界（有 `digitaljs.d.ts` 契约），业务层新代码禁止扩散。
- 存档字段变更必须过 `deviceParams` 三处对称（序列化/回读/电路互转）。
- 注释写「为什么」与实测读数（本项目最有价值的资产是踩坑注释，新代码保持同样标准）。
- 无 ESLint/Prettier 现状为**已知欠账**（账本 S1）：新文件保持与邻文件一致的引号/缩进，
  不引入第三种风格；引入 linter 需连存量告警治理一起立项。

## English

### Quality gates (the core discipline)

`tests/` holds Playwright acceptance gates (headless Edge against self-managed Vite servers).

1. **New capability ⇒ new gate**, registered in `run-all.cjs` or it doesn't count.
2. **Three-state verdicts**: pass / fail / *not-verified* — an unrun check is never green.
3. **Assertions read models & DOM values, never toast copy** — UI strings change.
4. **A red gate is triaged first**: harness precondition error / wrong assertion / real
   regression. Probe for readings before touching anything; never loosen a gate to pass.
5. **Mutation benches** (`rNN-mutate.cjs`) prove gates actually go red when the feature breaks.
6. Shared fixtures live in `tests/_ui.cjs`; reuse, don't fork.

### Commits & ledger

- `type(scope): summary`, batch-prefixed `R<n>`; a batch = implementation + gate + ledger
  entry (a missing ledger volume means the batch gets rejected — see ledger vol. 28).
- Multi-line messages via `git commit -F <file>`; author identity injected via env vars
  (never `git config`); check `ahead/behind` after `git fetch` before pushing.
- `docs/PROJECT_DEEP_REVIEW_2026-10-05.md` is the append-only ledger: every volume records
  root-cause → fix → verification readings, including the harness's own mistakes.

### Code red-lines (from the ledger)

- No new bare `catch {}` — every swallow carries an inline reason.
- `as any` stays at the digitaljs/joint boundary (`digitaljs.d.ts` is the contract).
- Save-format fields must round-trip through the three-way `deviceParams` checklist.
- Comments must say **why**, with measured readings — the pitfall annotations are this
  project's most valuable engineering asset.

---

↩️ [文档地图 Index](./README.md)
