import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `base: './'` 是给 VS Code 壳与打包态用的：webview 里读的是 `asWebviewUri` 指过去的文件，
// 绝对 `/assets/...` 落不进 webview 的 scheme；dev 服务器仍要 `/`（Vite dev 不支持相对 base）。
// 端口 1420 是闸门体系在用的（每颗闸门自己 `--port`，这颗是 `pnpm dev` 与文档里那个入口）。
// 两入口：`index.html`＝编译画布（canvas），`doc.html`＝.djs 文档编辑器（custom editor）。
// （第三入口 `binding.html`＝独立绑定面板已退役——R157⑥ 用户裁决绑定改弹窗，QuickInput 原生承载。）
export default defineConfig(async ({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" ? "./" : "/",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        doc: "doc.html",
      },
    },
  },
}));
