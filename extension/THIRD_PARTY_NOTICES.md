# Third-Party Notices / 第三方许可声明

本项目捆绑/链接下列第三方软件，各自保留其原始许可。本文件满足 BSD-2-Clause 的
版权与许可声明再分发义务、MPL-2.0 的第三方代码指引义务，并汇总其余许可证。
This file satisfies the notice/redistribution obligations of BSD-2-Clause (which requires
retaining copyright + license text on redistribution), MPL-2.0 (third-party code指引), and
summarizes all other bundled licenses.

## 运行时捆绑（打进产物）/ Bundled at runtime

| 组件 | 版本 | 许可证 | 用途 | 全文 |
|------|------|--------|------|------|
| DigitalJS | 0.14.2 | BSD-2-Clause | 数字电路仿真/渲染（`public/digitaljs.js`） | [上游](https://github.com/tilk/digitaljs) |
| yosys2digitaljs | 0.10.3 | BSD-2-Clause | Yosys JSON → DigitalJS 桥 | [上游](https://github.com/tilk/yosys2digitaljs) |
| 3vl | ^1.0.1 | BSD-2-Clause | 三值逻辑向量（DigitalJS 依赖） | npm |
| wavecanvas | ^1.1.1 | BSD-2-Clause | 波形画布（DigitalJS 依赖） | npm |
| Yosys (WASM) | 0.30.5(wrapping) | ISC | Verilog 综合（`public/yosys/`） | [上游](https://github.com/YosysHQ/yosys) |
| @joint/core | ~4.1.3 | **MPL-2.0** | 图形画布引擎（经 DigitalJS） | [上游](https://github.com/clientIO/joint) |
| @joint/layout-directed-graph | ~4.1.4 | MPL-2.0 | 图布局（经 DigitalJS） | 同上 |
| elkjs | ^0.11.0 | **EPL-2.0** | 自动布局引擎 | [上游](https://eclipse.org/elk/) |
| jquery / jquery-ui | 3.7.x / 1.14.x | MIT | DOM/对话框（DigitalJS 依赖） | npm |
| fastpriorityqueue | ^0.7.5 | Apache-2.0 | 仿真事件队列 | npm |
| CodeMirror 6 全家桶 | — | MIT | Verilog 编辑器 | [上游](https://codemirror.net/) |
| React / react-dom | 19 | MIT | UI 框架 | npm |
| lucide-react | — | ISC | 图标 | npm |
| Tauri API/plugins | 2.x | MIT OR Apache-2.0 | 桌面壳 | [上游](https://tauri.app/) |

### MPL-2.0 / EPL-2.0 说明
MPL-2.0 与 EPL-2.0 均为**文件级（weak copyleft）**许可证：本项目未修改其任何源文件，
仅以整体库形式链接使用，义务限于随发行提供许可证文本与本指引——即本文件。
修改后的 MPL/EPL 文件须以同许可开源；本项目对它们**零修改**。

### BSD-2-Clause 义务履行
DigitalJS / yosys2digitaljs / 3vl / wavecanvas 的版权与许可声明以下列方式再分发：
1. 本文件列名；
2. `public/digitaljs.js` 头部保留其打包生成的 `main.js.LICENSE.txt` 引用；
3. 发行包 `licenses/` 目录（构建时纳入，见 DEVELOPMENT 说明）。

## 开发期依赖（不随产物分发）/ Dev-only（not shipped）
TypeScript(Apache-2.0) · Vite(MIT) · playwright-core(Apache-2.0) · tailwindcss(MIT) ·
@tailwindcss/vite(MIT) · class-variance-authority(Apache-2.0) · @radix-ui/react-slot(MIT) ·
clsx(MIT) · tailwind-merge(MIT) · @vitejs/plugin-react(MIT) — 编译期使用，产物中不含其代码
（构建工具的运行时辅助若被打包，其 MIT/Apache 许可亦允许闭源分发）。

## 本项目自身 / This project
源码以 MIT 许可发布，见根目录 [LICENSE](../LICENSE)。

---
*清单来源：`pnpm licenses list`（2026-10-11 定稿，67 个直接/传递运行时依赖全量核对）。*
