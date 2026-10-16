// 浏览器闸门夹具外壳（tests/_ui.cjs 的锚点宿主）。
//
// 旧单页 App.tsx 随「拆 Tauri / 上游基座」迁移删掉了，那颗带 `data-activity` 的
// 活动栏（文件 / 模块 / 层次结构 / 沙盒 / 主题）也跟着没了 —— 于是 tests/ 下所有
// 走浏览器（vite dev）的 UI 闸门在 `_ui.cjs::boot` 等 `button[data-activity]` 时超时，
// 红的是夹具不是产品。这里把**沙盒模式**的 SandboxCanvas 重新装进一颗极简活动栏，
// 让老夹具（enterSandbox / ensurePalette / clickGate / 文件树右键…）继续可用。
//
// ⛔ 不进构建产物：vite build 的 rollupOptions.input 只有 index.html / doc.html，
//    gates.html 只在 vite dev 下按需服务，只给闸门用。
import React from "react";
import ReactDOM from "react-dom/client";
import GateHarness from "./GateHarness";
import ErrorBoundary from "../components/ErrorBoundary";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GateHarness />
    </ErrorBoundary>
  </React.StrictMode>,
);
