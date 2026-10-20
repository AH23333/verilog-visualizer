# Verilog Visualizer (VS Code Extension)

在 VS Code 里编写 Verilog / SystemVerilog，直接把电路**编译成可交互的数字电路图**并仿真。

- **Verilog 综合**：基于 Yosys（WASM，跑在 webview 内），把 `.v` / `.sv` 综合为网表。
- **交互式电路画布**：基于 DigitalJS，渲染门级电路、波形与仿真时钟。
- **原生 VS Code 体验**：文件树、语言语法高亮、`.djs` 电路文档、命令面板与侧栏视图。
- **统一调用层**：文件 / 绑定 / 沙盒 / 编译等能力通过单一 `toolRegistry` 暴露，供 UI 与 agent 复用。

## 快速开始

1. 安装本扩展。
2. 打开一个包含 `.v` / `.sv` 文件的文件夹。
3. 在命令面板运行 `Verilog Visualizer: 打开画布`，或点击侧栏视图。
4. 编写 Verilog，编译后在画布中查看与仿真。

## 第三方组件与许可

本扩展捆绑 Yosys（WASM）、DigitalJS、yosys2digitaljs 等第三方组件。其许可证全文随包分发：

- `THIRD_PARTY_NOTICES.md`（汇总清单）
- `webview/LICENSE.digitaljs`、`webview/LICENSE.yosys2digitaljs`
- `webview/yosys/LICENSE.md`（含 Yosys / yosys.js / Emscripten 许可）

## 文档

项目的完整文档（架构、统一 API 参考、Agent / MCP / CLI 设计、产品演进路线）位于源码仓库的 `docs/` 目录。

## 许可

本扩展以 MIT 许可发布，见同包内的 `LICENSE` 文件。
