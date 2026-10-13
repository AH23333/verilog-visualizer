import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// `base: './'` 是给 VS Code 壳与打包态用的：webview 里读的是 `asWebviewUri` 指过去的文件，
// 绝对 `/assets/...` 落不进 webview 的 scheme；dev 服务器仍要 `/`（Vite dev 不支持相对 base）。
export default defineConfig(async ({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" ? "./" : "/",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
