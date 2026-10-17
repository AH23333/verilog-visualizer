# 真宿主集成测试（test:real）使用说明

> 与 `pnpm test`（vitest + vscode 桩）互补：这一层用**本地源码构建的真机**（`D:/vv-studio/vscode/.build/electron/Verilog Visualizer.exe`）加载开发副本扩展，在**真实磁盘/真实 Uri/真实 watcher/真实回收站**上跑统一调用层全链。专钉桩保真度债（copy 静默 no-op、Uri.parse 形状、dirs 回填之类桩上测不出的差异）。

## 跑法（一条命令）

```
pnpm test:real
```

- 会**弹出一个真机窗口**（临时工程，`%TEMP%\vv-real-e2e-*`），跑完自动关闭（完成哨兵 + taskkill 进程树）。
- 控制台逐步打印 ✅/❌ 清单；结果 JSON 另落 `%TEMP%\vv-real-results-*.json`；宿主完整日志落 `%TEMP%\vv-real-host-out-*.log`。
- 退出码：0=全绿，1=有红，2=测试模块没跑到（看宿主日志）。

## 覆盖的 11 格（全部走 executeTool 真链）

1. `sys.getStatus` 真宿主工程根
2. `sys.listTools` discoverTools 权威 schema
3. `fs.createFile` 真盘落盘 + 内容逐字
4. `fs.move` 真搬家 + G1 绑定随迁（真盘 json 断言）
5. `fs.rename` 真改名 + circuits 根表随迁
6. `fs.move` 自环拒（真宿主错误链）
7. `fs.delete` 真删除（回收站通道）+ 绑定随清
8. `res.readProjectFile` 真读 + 穿越拒
9. `bindings.set` 真写目录层 json
10. `fs.copyPath` + `sys.readAudit` 真审计账本（写↔读同口径）
11. `[API_BAD_ARGS]` 真宿主缺参拒

## 三颗环境钉（已内建，勿拆）

- 源码构建的第一个位置参数必须是 **app 目录 `.`**（code.bat 同款 `%CODE% . %*`）；
- 派生 shell 的 **`ELECTRON_RUN_AS_NODE=1` 必须洗掉**（否则真机降级成纯 node：`out/main.js` 报 "electron 不提供 Menu 导出"）；
- **`--disable-gpu --no-sandbox`**（受限会话 GPU/renderer 进程 0xC0000005 连环崩）。

## 已知边界

- 模态弹窗（HITL/确认）在真机会等人——套件纪律：全走 `CALLER_UI`（交互豁免）+ 非模态告示，**⛔ 往套件里加 modal 路径**。
- 工作区在 `%TEMP%`，跑完保留供取证（路径在输出里），可手动删。
