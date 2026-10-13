// 扩展侧打包：照官方 esbuild-sample 的形状（extension 单入口、externals: ['vscode']）。
const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: 'dist/extension.cjs',
    sourcemap: !production,
    minify: production,
    logLevel: 'warning',
    external: ['vscode'],   // ⛔ 把 vscode API 打进 bundle：运行时由宿主注入
  });
  if (watch) await ctx.watch();
  else { await ctx.rebuild(); await ctx.dispose(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
