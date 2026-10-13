// vsce 只打包扩展目录 ⇒ 打包前把 Vite 产物复制成 extension/webview/。
// 开发态不需要它（extension.ts 会直接认 ../dist），所以这颗只在 package 前跑。
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'webview');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('没有 ../dist/index.html：先跑 pnpm build（Vite 构建前端）');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('已同步 dist → extension/webview');
