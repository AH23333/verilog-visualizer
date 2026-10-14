
---

# 卷四十二 · R134 VS Code 扩展骨架交付（用户裁决：套壳 = VS Code 扩展形态；UI 冻结）（2026-10-12）

## 用户裁决（优先级重排的根据）
- **套壳 ≠ 壳内开网页**：把绑定系统移植到 **VS Code 壳已有的文件系统**（.v/.djs 成为工作区真实文件，资源管理器可见可编辑可进 git），修改壳的侧边栏（模块/层次两板块 + 沙盒 Webview 面板），移植沙盒系统。
- **当前 UI 不必再测**：Tauri/WebUI 冻结，UI 深水区（主 effect/App 状态机）**停止投入**；lib 层与扩展宿主逻辑为持续价值线。

## 交付物：`vscode-ext/` 扩展骨架（tsc 0 错，运行验证待真机装扩展）
| 文件 | 内容 |
|------|------|
| `package.json` | 清单：activitybar 容器 verilogViz + 三视图（模块/层次/沙盒 webview）+ 命令（编译/开沙盒/刷新）+ sandboxDir 配置 |
| `src/extension.ts` | 激活注册、文件监听（.v 增删改→两树刷新）、编译命令（骨架期=接口校验 Lite + 提示 webview 编译器待接入） |
| `src/verilogParseLite.ts` | 模块/实例解析（主仓 verilogParse 抽取版）+ validateModuleInterfacesLite（重复定义/实例缺失） |
| `src/bindings.ts` | **绑定系统移植**：`verilog-viz.bindings.json` sidecar（工作区根，普通 JSON 可进 git）读写 + 相对路径 key |
| `src/moduleTree.ts` | 模块板块：工作区 .v 扫描 → definedModules 树，点击打开定义文件跳 module 行，绑定信息进描述 |
| `src/hierarchyTree.ts` | 层次板块：活动 .v 实例树（骨架一层展开，定义文件按「模块名=文件名」约定定位；全文搜索兜底下批） |
| `src/sandboxPanel.ts` | 沙盒 WebviewView + **fs 消息桥协议**（fsList/fsGet/fsSave/fsRemove/fsRename ↔ vscode.workspace.fs，路径越界守卫）——沙盒 .djs 直接落壳文件系统 |

## 真机待验（下轮清单）
1. 扩展装载（F5 或 vsce package 安装）→ 侧栏三视图渲染
2. 沙盒 webview 的 fs 桥自检按钮 → sandbox/ 目录真实落盘 .djs
3. 模块/层次树在多文件工作区的刷新时机
4. Webview 内编译器接入（compileVerilog 浏览器 JS 复用）——下一批

## 瘦身线终态（本卷起 UI 冻结）
SandboxCanvas 3799 / App 1788 / Canvas 1141 / verilog 387——机械搬家线到边际（卷四十结论维持）；深水区随 UI 冻结**停止投入**。

*（卷四十二完 · 待真机：扩展装载与三视图渲染）*
