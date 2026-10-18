# API_REFERENCE（生成物 · 统一调用层）

> ⛔ **手改无效**：本文件由 `pnpm api:doc` 从 registry（`toolsFs.ts`／`toolsDomain.ts`／`dispatch.ts` 三处 `register*Tools()` 的并集）+ 契约（extension/api/vv-api.defaults.json，工程层 `.vv/api.json` 只许收窄）**生成**；漂移会被台架钉住。
> apiVersion `0.1.0` · 生成工具数 **37** · 调用面 ui=开 / rpc=开 / mcp=开 / cli=关
>
> **调用方式（三方同门）**：`executeTool(context, caller, toolId, args)`（extension/src/toolRegistry.ts）。
> **闸序（硬）**：① 登记（registry∧契约双查）→ ② surfaces（全局开关∧工具面）→ ③ 档案 `.vv/api.grants.json` → ④ `requiresApproval` 且调用方非交互 ⇒ HITL 弹窗。
> **审计**：每次过闸一行 JSONL 落 `.vv/audit/trace-YYYY-MM-DD.jsonl`（那颗日期串由 `Date.toISOString().slice(0,10)` 出，带连字符——正本 `apiAudit.ts`，⛔ 信上一版文档的口头描述）。每行两颗身份槽：`subject`＝调用方**身份**（闸③ grants 按它放行），`channel`＝**端点**（闸② surfaces 按它放行；rpc/ui/mcp/cli）。verdict 7 值：auto/approved/denied/error/surface-denied/not-registered/not-granted；args 只记形状摘要（⛔ 值）。
> **错误标签**：`[API_NOT_REGISTERED]` / `[API_SURFACE_DENIED]` / `[API_NOT_GRANTED]` / `[API_NOT_APPROVED]` / `[API_BAD_ARGS]`（机读 code = 去掉 `[API_]` 壳；拒单那行 `note` 必带这颗码）。
> **调用号**：每次调用一颗 `traceId`——拒单时它同时在 `ToolError.traceId`、RPC 回包的 `trace` 与账本那一行上（同一串）。拿着"被拒"来查，⛔ 靠猜是哪一行。
> **怎么取数（深度四档 D0–D3）**：`sys.listTools`（全表浅档）→ `sys.describeTool`（单颗深档＋闸前预演，⛔ 执行）→ `sys.selfCheck`（整套调用层现在能不能用、哪道闸在拦）→ `sys.readAudit`（账本原文）。轴与规程见 [CONFIG_PROTOCOL.md §9.7](./CONFIG_PROTOCOL.md)。

## 工具总表

| 工具 id | 标题 | perm | sideEffects | surfaces | 审批 | ref（命令/rpc） | since |
|---|---|---|---|---|---|---|---|
| `bindings.audit` | 审计绑定完整性 | read | none | ui/mcp | — | `bindings.audit` | 0.2.0 |
| `bindings.complete` | 写全绑定 | config-write | config-write | ui | — | `bindings.complete` | 0.2.0 |
| `bindings.get` | 读绑定 | read | none | ui/mcp | — | `bindings.get` | 0.2.0 |
| `bindings.materialize` | 固化自动绑定 | config-write | config-write | ui | — | `bindings.materialize` | 0.2.0 |
| `bindings.set` | 写绑定 | config-write | config-write | ui | — | `bindings.set` | 0.2.0 |
| `circuits.list` | 读电路名单 | read | none | ui/mcp | — | `circuits.list` | 0.2.0 |
| `circuits.toggle` | 翻转部件角色 | config-write | config-write | ui | — | `verilogViz.togglePartRole` | 0.2.0 |
| `compile.closure` | 依赖闭包 | read | none | ui/mcp | — | `compile.closure` | 0.2.0 |
| `fs.copyPath` | 复制路径 | read | none | ui | — | `verilogViz.copyPath` | 0.2.0 |
| `fs.createFile` | 新建文件 | file-write | file-write | ui | — | `verilogViz.newVerilogFile` | 0.2.0 |
| `fs.createFolder` | 新建文件夹 | file-write | file-write | ui | — | `verilogViz.newSandboxFolder` | 0.2.0 |
| `fs.delete` | 删除 | file-write | file-write | ui | **HITL** | `verilogViz.deleteFile` | 0.2.0 |
| `fs.duplicateFile` | 创建文件副本 | file-write | file-write | ui | — | `verilogViz.duplicateFile` | 0.2.0 |
| `fs.duplicateFolder` | 复制文件夹 | file-write | file-write | ui | — | `verilogViz.duplicateFolder` | 0.2.0 |
| `fs.import` | 导入文件 | file-write | file-write | ui | — | `verilogViz.importFiles` | 0.2.0 |
| `fs.move` | 移动 | file-write | file-write | ui | — | `verilogViz.moveTo` | 0.2.0 |
| `fs.rename` | 重命名 | file-write | file-write | ui | — | `verilogViz.renameFile` | 0.2.0 |
| `fs.revealInOS` | 在磁盘显示 | read | none | ui | — | `verilogViz.revealInOS` | 0.2.0 |
| `host.appendOutput` | 写输出面板 | read | none | rpc | — | `appendOutput` | 0.1.0 |
| `host.copyToSandbox` | 编译图落沙盒 | file-write | file-write | rpc | — | `copyToSandbox` | 0.1.0 |
| `host.getAllBindings` | 读绑定链 | read | none | rpc | — | `getAllBindings` | 0.1.0 |
| `host.getConfig` | 读宿主配置 | read | none | rpc | — | `getConfig` | 0.1.0 |
| `host.importLegacyData` | 旧档一次性搬运 | file-write | file-write | rpc | **HITL** | `importLegacyData` | 0.1.0 |
| `host.jumpToSource` | 跳到源码行 | read | none | rpc | — | `jumpToSource` | 0.1.0 |
| `host.publishProblems` | 发 Problems | read | none | rpc | — | `publishProblems` | 0.1.0 |
| `host.saveExportFile` | 宿主另存为 | file-write | file-write | rpc | — | `saveExportFile` | 0.1.0 |
| `host.setDocBindings` | 写一份文档的绑定表 | config-write | config-write | rpc | — | `setDocBindings` | 0.1.0 |
| `res.listProject` | 列编译域文件 | read | none | ui/mcp | — | `res.listProject` | 0.2.0 |
| `res.listSandbox` | 列沙盒域文件 | read | none | ui/mcp | — | `res.listSandbox` | 0.2.0 |
| `res.readProjectFile` | 读工程文件 | read | none | ui/mcp | — | `res.readProjectFile` | 0.2.0 |
| `sys.ctxSnapshot` | 宿主隐式态快照（如实转述） | read | none | ui/mcp/cli | — | `sys.ctxSnapshot` | 0.4.0 |
| `sys.describeTool` | 单颗工具深档（含闸门预演） | read | none | ui/mcp/cli | — | `sys.describeTool` | 0.3.0 |
| `sys.getStatus` | 宿主状态 | read | none | ui/mcp/cli | — | `sys.getStatus` | 0.2.0 |
| `sys.listTools` | 工具发现 | read | none | ui/mcp/cli | — | `sys.listTools` | 0.2.0 |
| `sys.ping` | 活体探针 | read | none | ui/mcp/cli | — | `sys.ping` | 0.4.0 |
| `sys.readAudit` | 读调用审计 | read | none | ui/mcp/cli | — | `sys.readAudit` | 0.2.0 |
| `sys.selfCheck` | 调用层自检（agent 进门第一枪） | read | none | ui/mcp/cli | — | `sys.selfCheck` | 0.3.0 |

## 工具详情（参数 schema）

### `bindings.audit` — 审计绑定完整性

枚举文档子部件实例中「表里没录、正靠同名兜底」的条目（盘上内容模拟画布解析链，BFS 带预算）。幂等只读。

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "根相对文档路径"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `bindings.complete` — 写全绑定

audit+一键写全：把自动命中且未录入的实例按「顶层同源=裸键/深层=前缀」策略落文档目录表；已录入⛔ 覆写。

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `bindings.get` — 读绑定

给 doc（根相对 .djs/.v 路径）＝该文档的链合并生效绑定（近层覆盖远层、值折回根相对）；不给 doc＝项目根表原文。幂等只读。

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "根相对文档路径（可省）"
    }
  }
}
```

### `bindings.materialize` — 固化自动绑定

把「未录入且能自动同名命中」的解析写进文档目录表（.djs=同目录/根同名打分，.v=依赖闭包）；已记录⛔ 动。返回固化条目。

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `bindings.set` — 写绑定

直写某目录层 `.verilogviz.json` 的一条绑定（part=null＝删该键）；值按层目录相对化落盘。手编内容珍贵的语义与 UI 同源。

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string",
      "description": "目录层（根相对；缺省=项目根表）"
    },
    "celltype": {
      "type": "string",
      "description": "实例/键名"
    },
    "part": {
      "type": "string",
      "description": "部件文件（根相对或相对该目录；null/空＝删）"
    }
  },
  "required": [
    "celltype"
  ]
}
```

### `circuits.list` — 读电路名单

根表 circuits 显式名单（取消部件表）；名单外的 .djs 全是部件。幂等只读。

```json
{
  "type": "object",
  "properties": {}
}
```

### `circuits.toggle` — 翻转部件角色

名单有=当前电路 → 翻回部件；没有 → 标为电路（显式取消语义）。树/画布联动由宿主订阅完成。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `compile.closure` — 依赖闭包

.v 入口的编译依赖闭包（拓扑文件名单+顶层模块）。R152 绑定权威：未显式绑定的实例进 bindingErrors（配套 bindings.set 补录）。幂等只读；⛔ 文件内容（大）。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "入口 .v（根相对或 fsPath）"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.copyPath` — 复制路径

绝对路径进剪贴板（幂等、无副作用）。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.createFile` — 新建文件

kind=verilog：最小可编译模板；kind=sandbox：空画布 `{"cells":[]}` 并落「目录有部件就有表」。编辑器打开归调用方。

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string",
      "description": "落盘目录（缺省=项目根）"
    },
    "name": {
      "type": "string",
      "description": "文件名（可含子路径；后缀自动补）"
    },
    "kind": {
      "type": "string",
      "enum": [
        "verilog",
        "sandbox"
      ],
      "description": "缺省 verilog"
    }
  },
  "required": [
    "name"
  ]
}
```

### `fs.createFolder` — 新建文件夹

段级消毒（`..` 逃逸死掉）+递归建目录（可含子路径）。

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "description": "可含子路径"
    }
  },
  "required": [
    "name"
  ]
}
```

### `fs.delete` — 删除

删除文件/目录（进回收站）；指向被删内容的绑定/电路名单随清（G1 双路）。requiresApproval：非交互调用方（agent）须 HITL 批准。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "待删除的文件/目录"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.duplicateFile` — 创建文件副本

同目录 (n) 序号复制；副本角色不随（默认 circuit）。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.duplicateFolder` — 复制文件夹

递归复制 `x`→`x 副本 (n)`；副本含 .djs 时自动配绑定表。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.import` — 导入文件

把给定的外部文件复制进目标目录：域过滤（exts）+ (n) 去重 + `.djs` 落表。文件选择对话框在调用方（agent 直接给 sources）。

```json
{
  "type": "object",
  "properties": {
    "destDir": {
      "type": "string",
      "description": "落盘目录"
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "源文件（fsPath/file: uri）列表"
    },
    "exts": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "放行扩展（缺省 v/sv/djs）"
    }
  },
  "required": [
    "destDir",
    "sources"
  ]
}
```

### `fs.move` — 移动

移动文件/目录到目标目录；(n) 去重、自环拒、原地 no-op；绑定记录随迁（G1）。

```json
{
  "type": "object",
  "properties": {
    "src": {
      "type": "string",
      "description": "源文件/目录"
    },
    "destDir": {
      "type": "string",
      "description": "目标目录"
    }
  },
  "required": [
    "src",
    "destDir"
  ]
}
```

### `fs.rename` — 重命名

重命名文件或目录；绑定值/`宿主::`前缀键/根表 circuits 随迁（G1）。输入经单段消毒（`../` 无法逃出工作区）。名字无效/与现名相同/目标被占用 ⇒ 报错（⛔ 静默 ok:false）。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "目标文件/目录（fsPath 或 file: uri）"
    },
    "newName": {
      "type": "string",
      "description": "新名字（单段）"
    }
  },
  "required": [
    "uri",
    "newName"
  ]
}
```

### `fs.revealInOS` — 在磁盘显示

调用工作台 revealFileInOS 定位文件/目录（幂等）。

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `host.appendOutput` — 写输出面板

写输出面板

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "追加的原文（宿主不加工）"
    }
  }
}
```

### `host.copyToSandbox` — 编译图落沙盒

编译图落沙盒

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "description": "第 0 颗 = 主电路；其余为子部件（逐颗落 `<name>.djs` 并写所在目录绑定表）",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "`folder/name`，⛔ 带 .djs 后缀（宿主统一补）"
          },
          "content": {
            "type": "string",
            "description": "画布序列化串 {cells:[…]}"
          }
        }
      }
    }
  }
}
```

### `host.getAllBindings` — 读绑定链

读绑定链

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "根相对文档路径＝走目录链合并（近层覆盖）；不给＝项目根表原文"
    }
  }
}
```

### `host.getConfig` — 读宿主配置

读宿主配置

```json
{
  "type": "object",
  "properties": {}
}
```

### `host.importLegacyData` — 旧档一次性搬运

旧档一次性搬运

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "旧 localStorage 档；X18 起可带身份三颗（key/role/bindings），带上就跟着落目录绑定表",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "无扩展名的条目按 `.v` 落盘（源码那半颗的路径）"
          },
          "content": {
            "type": "string"
          },
          "key": {
            "type": "string",
            "description": "旧档批内 id——只当这批的连接键用"
          },
          "role": {
            "type": "string",
            "enum": [
              "part"
            ],
            "description": "这颗是可编辑部件"
          },
          "bindings": {
            "type": "object",
            "description": "celltype → 同批里那颗部件的旧 id（⛔ 名字：重名/消毒会连错档）"
          }
        }
      }
    }
  }
}
```

### `host.jumpToSource` — 跳到源码行

跳到源码行

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "description": "根相对路径"
    },
    "line": {
      "type": "number",
      "description": "0-based（编辑器口径）"
    }
  },
  "required": [
    "file"
  ]
}
```

### `host.publishProblems` — 发 Problems

发 Problems

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "一条 = 一行 Problems；line=null 表示给不出行（⛔ 冒充第 1 行）",
      "items": {
        "type": "object",
        "properties": {
          "fileName": {
            "type": "string",
            "description": "工作区根相对路径"
          },
          "line": {
            "type": [
              "number",
              "null"
            ],
            "description": "1-based；null = 未知"
          },
          "message": {
            "type": "string"
          },
          "severity": {
            "type": "string",
            "enum": [
              "error",
              "warning"
            ]
          }
        }
      }
    }
  }
}
```

### `host.saveExportFile` — 宿主另存为

宿主另存为

```json
{
  "type": "object",
  "properties": {
    "base64": {
      "type": "string",
      "description": "要写出去的字节（base64；消息过 JSON 通道 ⇒ ⛔ 直接交 Uint8Array）"
    },
    "defaultName": {
      "type": "string",
      "description": "默认文件名（决定另存对话框的扩展名过滤器）"
    },
    "mime": {
      "type": "string",
      "description": "调用方语义标注（当前仅用于日志/文档）"
    }
  },
  "required": [
    "base64",
    "defaultName"
  ]
}
```

### `host.setDocBindings` — 写一份文档的绑定表

写一份文档的绑定表

```json
{
  "type": "object",
  "properties": {
    "docName": {
      "type": "string",
      "description": "根相对文档路径；表落在它的目录层"
    },
    "bindings": {
      "type": "object",
      "description": "只覆写**本文档**的条目（v0.4：别档前缀键⛔ 落本表、手编条目一颗不碰；本档一律产前缀键）"
    }
  }
}
```

### `res.listProject` — 列编译域文件

工程树（编译域 .v/.sv/.vh + 全量目录，跳过 node_modules/点开头；深度 16 护栏）。幂等只读。

```json
{
  "type": "object",
  "properties": {}
}
```

### `res.listSandbox` — 列沙盒域文件

工程树的沙盒那份（.djs）。幂等只读。

```json
{
  "type": "object",
  "properties": {}
}
```

### `res.readProjectFile` — 读工程文件

读工程根下的文本文件（sanitizeRel 拒 `..`/绝对路径穿越；>2MB 拒）。幂等只读。

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "根相对路径"
    }
  },
  "required": [
    "path"
  ]
}
```

### `sys.ctxSnapshot` — 宿主隐式态快照（如实转述）

L2「现场是什么」：活动编辑器/最后文本 uri/沙盒粘滞档/编译 Panel 与最近编译单/活画布清单/可见页签。专治 P3（隐式上下文劫持族）：agent ⛔ 猜"现在是谁"——一切写操作的目标仍须显式实参，这颗只供**看见**。全字段可 null，null 也是真话。

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.describeTool` — 单颗工具深档（含闸门预演）

深度 D1：一颗工具的**全部真相**＝registry 卡（标题/描述/参数 schema）+ 契约卡（perm/sideEffects/surfaces/ref/审批/since）+ 闸前预演（这一枪会不会被①②③④哪道拦、缺哪颗必填）+ 该工具最近的审计行（带 traceId）。⛔ 执行 handler＝零副作用。agent ⛔ 靠真打一枪来试签名。

```json
{
  "type": "object",
  "properties": {
    "tool": {
      "type": "string",
      "description": "工具 id 逐字（`fs.rename`／`host.getConfig`…）；rpc 的 method 名⛔ 裸写，要带 `host.` 前缀"
    },
    "args": {
      "type": "object",
      "description": "打算交的实参（只用于验必填项，⛔ 落盘⛔ 执行）"
    },
    "surface": {
      "type": "string",
      "enum": [
        "ui",
        "rpc",
        "mcp",
        "cli"
      ],
      "description": "按哪条端点判闸②（缺省＝调用方自己那条）。诊断工具挂在所有端点上，所以从 agent 线问\"画布那条线通不通\"是正当问题"
    },
    "subject": {
      "type": "string",
      "description": "按哪个身份判闸③（缺省＝调用方自己）。⛔ 绕闸通道：只回一份判断，⛔ 执行"
    }
  },
  "required": [
    "tool"
  ]
}
```

### `sys.getStatus` — 宿主状态

契约版本/调用面/工具账规模/工程根＋活体三格（activation 检查点/bridge 桥态/openDocs 活画布/lastCompile 最近编译单）。幂等只读。

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.listTools` — 工具发现

§15 discoverTools：全部上账工具的 id/标题/描述/参数 schema/契约属性。agent 必须以它为准，⛔ 靠经验猜签名。

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.ping` — 活体探针

L0 半毫秒探针：扩展活着没、activate 活到哪一步（检查点账，半活假象终结者）、MCP 桥听没听、挂了多久。零实参零副作用，agent 进门第一枪。

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.readAudit` — 读调用审计

§14/§15 readLogs：读 `.vv/audit/trace-YYYY-MM-DD.jsonl`（带连字符，与 apiAudit 落盘那颗串逐字一致）最近 N 行（缺省 50，帽 200）；未开户=空账。幂等只读。

```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "YYYY-MM-DD（缺省今天）。落盘名就是这颗串直接拼出来的，⛔ 另一种分隔——为免调用方猜，8 位纯数字（YYYYMMDD）也归一接受"
    },
    "limit": {
      "type": "number",
      "description": "行数（缺省 50）"
    }
  }
}
```

### `sys.selfCheck` — 调用层自检（agent 进门第一枪）

深度 D2：一枪回答"这套 API 现在能不能用、哪道闸在拦、拦了去哪查"——生效契约规模与调用面开关、registry∧契约**双向**漂移、工程覆盖 `.vv/api.json` 载入结果与被拒原因、授权档案在不在跑及其告警、审计通道三张脸（未开户/仍在缓冲/日文件为空）＋当日 verdict 统计与最近拒单（含 traceId）。可选 `probe` 顺带预演一颗工具。⛔ 任何写操作。

```json
{
  "type": "object",
  "properties": {
    "probe": {
      "type": "object",
      "description": "闸前预演一颗（与 sys.describeTool 同一把尺）；给了就顺带答\"这颗我现在能打吗\"",
      "properties": {
        "tool": {
          "type": "string"
        },
        "args": {
          "type": "object"
        },
        "surface": {
          "type": "string",
          "enum": [
            "ui",
            "rpc",
            "mcp",
            "cli"
          ],
          "description": "按哪条端点判（缺省＝调用方自己那条）"
        },
        "subject": {
          "type": "string",
          "description": "按哪个身份判闸③（缺省＝调用方自己）"
        }
      },
      "required": [
        "tool"
      ]
    }
  }
}
```

## 尚未收编（第二批挂账）

- webview RPC：待迁 **0** 颗（契约 rpc 面在册 9 颗已全部走 `executeTool`；名册正本＝`dispatch.ts` 那颗 `RPC_METHODS`，对账锁拿它与契约 rpc 投影双向钉）。
- 契约上账、非 rpc 面且⛔ registry handler：**3** 颗（compile.auditBindings→verilogViz.auditBindings / compile.completeBindings→verilogViz.completeBindings / compile.compileAndShow→verilogViz.compileAndShow）——这几颗现在由命令面板直调 Extension Host 里的实现，绕开 executeTool。
- 反向（registry 有 handler 而契约⛔ 上账）：**0** 颗（（无））。
- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。

