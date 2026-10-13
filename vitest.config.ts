import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 单独一份 vitest 配置，只为一颗 alias：把 `vscode` 指到 `tests/unit/vscodeApiStub.ts`，
 * 好让 `extension/src/extension.ts` 能在无头环境里被 import（片 3 起每搬一层 UI 都要靠这面网）。
 *
 * ⚠ 为什么⛔ 把这条 alias 塞进 `vite.config.ts`：那颗文件同时喂 `pnpm build`（产品的前端），
 * 让产品构建里存在一颗名叫 `vscode` 的模块＝给"前端能悄悄直连宿主 API"开了个口子——
 * 而 `src/lib/host/` 那层中立性就是为堵这个口子建的。两边射程分开钉。
 *
 * ⚠ 类型那一半住在 `tsconfig.json` 的 `paths`：两处只配一处就会得到
 * "编辑器里 import 得到、跑起来 Cannot find module 'vscode'"这种红。
 */
export default defineConfig({
  resolve: {
    alias: { vscode: path.resolve(__dirname, 'tests/unit/vscodeApiStub.ts') },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.mjs'],
  },
});
