// ESLint flat config（卷一 S1 立项，R130 落地）
// 策略：**不阻塞存量**——与账本纪律一致（「存量治理与 lint 引入一起立项」已按此节奏）：
//   error 只留给明确的新增红线（如未定义变量），存量债务（any/空 catch/console）以 warn
//   计数留档，治理进度由 `pnpm lint --max-warnings=N` 逐步收紧。
// tests/（Playwright 闸门）暂不纳入：cjs 形态 + 大量一次性探针，另立项。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'tests/**', 'public/**', '**/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // CodeEditor 里的行内 disable 注释依赖本规则可解析（插件未装时 ESLint 10 会报
      // "Definition for rule was not found" 的 error——R130 实测）。
      'react-hooks/exhaustive-deps': 'warn',
      // —— 新增红线（error）——
      // no-undef 关闭：TS 项目由 tsc 管未定义检查（官方建议）——本仓 new JSX transform
      // 下 `React.MouseEvent` 等类型引用不 import React，55 个误报全源于此（R130 实测）。
      'no-undef': 'off',
      'no-var': 'error',
      'prefer-const': ['warn', { destructuring: 'all' }],
      // —— 存量债务以 warn 留档（账本卷一 B7/S1：分级治理，不一刀切）——
      'no-empty': ['warn', { allowEmptyCatch: false }],
      // TS 版规则覆盖 core 版（tseslint recommended 启用）——配置必须落在 @typescript-eslint/ 前缀上
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
      // no-useless-assignment（ESLint 10 新规则）降 warn：对 try/catch 防御性初始化有
      // 已知误报面（11 处多数是 `let x = ''; try { x = … } catch` 的合法形态）——留档下轮逐个甄别
      'no-useless-assignment': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // vite 配置文件允许 node 全局
    files: ['vite.config.ts', 'tailwind.config.*', 'postcss.config.*'],
    languageOptions: { globals: { ...globals.node } },
  },
);
