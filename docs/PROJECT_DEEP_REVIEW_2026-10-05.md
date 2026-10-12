
---

# 卷三十八 · R130 收尾：ESLint 立项完成 + PNG 裁决入账 + 跑批中断归因（2026-10-11 深夜，用户令停机）

## 一、PNG 导出下线 —— **用户裁决确认**（卷三十六待确认项闭环）
账本与 CHANGELOG 保持「已下线」记述，不再标待确认。r12-export 闸门绿（下线后的导出面覆盖）。

## 二、ESLint 立项完成（卷一 S1 清偿，卷三十六登记项闭环）
- eslint 10 + @eslint/js + typescript-eslint 8 + globals + eslint-plugin-react-hooks（CodeEditor 的行内 disable 注释需要插件可解析——未装插件时 ESLint 10 会把 disable 注释本身报成 error，R130 实测）。
- `eslint.config.js`（flat config）：**0 error 基线达成**（LINT=0 error / 648 warnings 留档分级）。关键裁决与坑全部注释在 config 内：
  - **no-undef: off**（TS 项目由 tsc 管未定义；本仓 new JSX transform 下 `React.MouseEvent` 类型引用不 import React，55 个误报全源于此）；
  - **配置必须落在 `@typescript-eslint/no-unused-expressions`**（tseslint recommended 启用 TS 版规则覆盖 core 版——core 版的 allowTernary 配置不生效，R130 实测 4 处 `cond ? a() : b()` 惯用法被误报）；
  - `no-useless-assignment`（ESLint 10 新规则）降 warn：对 try/catch 防御性初始化有误报面（11 处），留档下轮甄别；
  - react-hooks/exhaustive-deps: warn（真规则真提示，Canvas 一处 useImperativeHandle 依赖提示已现）。
- 两处小修（语义等价）：subcircuitView 降级抛错补 `cause: e2`（ESLint preserve-caught-error；tsconfig lib 随之 ES2022）；annotationCell 三处 `arguments` 转发改 rest 参数。
- `package.json`：`pnpm lint` / `pnpm lint:fix`。tests/ 暂不纳入（另立项）。

## 三、r130 统一批中断归因（**ENVRED 成片=环境损伤，非代码回归**，结果作废）
- 形态：第 1 格（r7）起 **FATAL page.goto 30s 超时**，51 格 ENVRED 后被用户令停。
- 根因链：`pnpm add`（装 ESLint）变更 package.json/lockfile → vite 的 optimizeDeps 预构建缓存（`node_modules/.vite`，其 hash 含 lockfile）**全体失效** → 每个 gate 冷启动都要全量预构建，30s 内起不来 → 全体 goto 超时。与代码无关（tsc 0 错、vite build 10.05s 过、build 是完整产物链验证）。
- **下轮开工第一件事**：`pnpm dev` 预热一次（等 optimizeDeps 预构建完成）再跑 `run-all`——一次预热全批复用。

## 四、工作区快照（下轮交接）
- 未提交（待统一批绿后一并入库）：`eslint.config.js`、`package.json`/`pnpm-lock.yaml`、`tsconfig.json`、`src/lib/subcircuitView.ts`、`src/lib/annotationCell.ts`、`src/components/{Canvas,FsmTableModal,IOPanel,WaveformPanel}.tsx`（R127 轮询门——r128c 批 70/70 已验证过一次，但按纪律随本批一起提交）。
- 本卷账本先单独提交（文档无需闸门）。
- 深水区/小刀清单：见卷三十五（Canvas probe 已做✓、App 对话框已弃✓）与卷三十六（余 AppDialogs 弃刀已记）。

*（卷三十八 · 阶段收尾，机器休息）*
