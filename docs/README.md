# 文档地图 / Documentation Index

> 本目录按 [diátaxis](https://diataxis.fr/) 框架组织：**教程**（学习导向）→ **操作指南**（任务导向）→ **参考**（信息导向）→ **解释**（理解导向）。
> Docs are organized with the [diátaxis](https://diataxis.fr/) framework: **tutorials** (learning) → **how-to guides** (tasks) → **reference** (information) → **explanation** (understanding).

## 活文档 / Living Docs

| 象限 Quadrant | 文档 Doc | 读者 |
|---------------|----------|------|
|  教程 Tutorial | [GETTING_STARTED.md](./GETTING_STARTED.md) 入门指南 | 新用户（双语） |
| 🔧 指南 How-to | [USER_GUIDE.md](../docs/USER_GUIDE.md) 用户指南 | 使用者（双语） |
| 🔧 指南 How-to | [DEVELOPMENT.md](./DEVELOPMENT.md) 开发与测试 | 贡献者（双语） |
| 📖 参考 Reference | [ARCHITECTURE.md](./ARCHITECTURE.md) 架构总览 | 开发者（双语） |
| 📖 参考 Reference | [API_REFERENCE.md](./API_REFERENCE.md) 统一调用层工具表（**生成物**：`pnpm api:doc`，手改无效） | 集成方 / agent |
| 🏗 协议 Reference | [CONFIG_PROTOCOL.md](./CONFIG_PROTOCOL.md) 配置与 API 层协议（§9 三闸/审计，§9.7 agent 深度四档 D0–D3） | 架构 |
| 📖 解释 Explanation | [AGENT_PRODUCT_ARCHITECTURE.md](./AGENT_PRODUCT_ARCHITECTURE.md) Agent 产品架构与逐项可行性（含 R155 落地进度） | 架构 |
| 🧪 参考 Reference | [GATE_LAYERS.md](./GATE_LAYERS.md) 闸门分层与跑批读数 ｜ [FILESYSTEM_CHECKLIST.md](./FILESYSTEM_CHECKLIST.md) 两模式文件系统点验单 ｜ [REAL_HOST_E2E.md](./REAL_HOST_E2E.md) 真宿主 E2E 台架 | 开发/质检 |
| 📖 参考 Reference | [SANDBOX_DEV.md](./SANDBOX_DEV.md) 沙盒实现细节与探针教训 | 沙盒开发者 |
| 📖 参考 Reference | [FEATURES_BEYOND_PLAN.md](./FEATURES_BEYOND_PLAN.md) 超越 OpenCircuits 特性对照 | 产品 |
| 🔧 指南 How-to | [MIGRATION_VSCODE.md](./MIGRATION_VSCODE.md) VS Code 套壳迁移台账（含真机点验单） | 贡献者 |
| 🏗 架构 Reference | [../studio/README.md](../studio/README.md) 自带 Code - OSS 分支出独立二进制（目标形态与分期） | 架构 |
| 📜 解释 Explanation | [CHANGELOG.md](./CHANGELOG.md) 变更日志 | 所有人 |
| 📜 解释 Explanation | [AGENT_ARCH_DECISION.md](./AGENT_ARCH_DECISION.md) Agent 集成架构决策（ADR） | 架构 |
| ⚖️ 合规 Legal | [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 第三方许可声明 | 法务/发布 |
| 🧾 账本 Ledger | [PROJECT_DEEP_REVIEW_2026-10-05.md](./PROJECT_DEEP_REVIEW_2026-10-05.md) 审查与整改账本（卷一~卷四十四） | 开发/质检 |

## 归档 / Archive

[archive/](./archive/) 内为**历史快照**（可行性分析、交接文档、阶段评审、QC 指令链等）——
反映的是当时状态，结论可能已被后续批次推翻；**不要**作为现状依据引用。
Historical snapshots. They reflect the state at the time of writing; later batches may
have overturned their conclusions — do not cite them as current truth.

## 账本阅读法 / How to read the ledger

`PROJECT_DEEP_REVIEW_2026-10-05.md` 是持续追加的整改账本：卷一~五为初始深度审查
（P0~P3 分级发现），卷六起为逐批次开发/质检记录（每卷 = 一个 R 批次或一次用户报障
的「根因 → 修复 → 闸门读数」全链）。检索方式：按 `R<编号>` 或报障原文关键词全文搜索。
