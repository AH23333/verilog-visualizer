# API_REFERENCE（生成物 · 统一调用层）

> ⛔ **手改无效**：本文件由 `pnpm api:doc` 从 registry（extension/src/toolsFs.ts）+ 契约（extension/api/vv-api.defaults.json，工程层 `.vv/api.json` 只许收窄）**生成**；漂移会被台架钉住。
> apiVersion `0.1.0` · 生成工具数 **24** · 调用面 ui=开 / rpc=开 / mcp=关 / cli=关
>
> **调用方式（三方同门）**：`executeTool(context, caller, toolId, args)`（extension/src/toolRegistry.ts）。
> **闸序（硬）**：① 登记（registry∧契约双查）→ ② surfaces（全局开关∧工具面）→ ③ 档案 `.vv/api.grants.json` → ④ `requiresApproval` 且调用方非交互 ⇒ HITL 弹窗。
> **审计**：每次过闸一行 JSONL 落 `.vv/audit/trace-YYYYMMDD.jsonl`（verdict 七值：auto/approved/denied/error/surface-denied/not-registered/not-granted；args 只记形状摘要）。
> **错误标签**：`[API_NOT_REGISTERED]` / `[API_SURFACE_DENIED]` / `[API_NOT_GRANTED]` / `[API_NOT_APPROVED]` / `[API_BAD_ARGS]`（机读 code = 去掉 `[API_]` 壳）。

## 工具总表

| 工具 id | 标题 | perm | sideEffects | surfaces | 审批 | ref（命令/rpc） | since |
|---|---|---|---|---|---|---|---|
| `bindings.audit` | 审计绑定完整性 | read | none | ui | — | `bindings.audit` | 0.2.0 |
| `bindings.complete` | 写全绑定 | config-write | config-write | ui | — | `bindings.complete` | 0.2.0 |
| `bindings.get` | 读绑定 | read | none | ui | — | `bindings.get` | 0.2.0 |
| `bindings.materialize` | 固化自动绑定 | config-write | config-write | ui | — | `bindings.materialize` | 0.2.0 |
| `bindings.set` | 写绑定 | config-write | config-write | ui | — | `bindings.set` | 0.2.0 |
| `circuits.list` | 读电路名单 | read | none | ui | — | `circuits.list` | 0.2.0 |
| `circuits.toggle` | 翻转部件角色 | config-write | config-write | ui | — | `verilogViz.togglePartRole` | 0.2.0 |
| `compile.closure` | 依赖闭包 | read | none | ui | — | `compile.closure` | 0.2.0 |
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
| `res.listProject` | 列编译域文件 | read | none | ui | — | `res.listProject` | 0.2.0 |
| `res.listSandbox` | 列沙盒域文件 | read | none | ui | — | `res.listSandbox` | 0.2.0 |
| `res.readProjectFile` | 读工程文件 | read | none | ui | — | `res.readProjectFile` | 0.2.0 |
| `sys.getStatus` | 宿主状态 | read | none | ui | — | `sys.getStatus` | 0.2.0 |
| `sys.listTools` | 工具发现 | read | none | ui | — | `sys.listTools` | 0.2.0 |
| `sys.readAudit` | 读调用审计 | read | none | ui | — | `sys.readAudit` | 0.2.0 |

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

### `sys.getStatus` — 宿主状态

契约版本/调用面开关/工具账规模/工程根。幂等只读。

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

### `sys.readAudit` — 读调用审计

§14/§15 readLogs：读 `.vv/audit/trace-YYYYMMDD.jsonl` 最近 N 行（缺省 50，帽 200）；未开户=空账。幂等只读。

```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "YYYYMMDD（缺省今天）"
    },
    "limit": {
      "type": "number",
      "description": "行数（缺省 50）"
    }
  }
}
```

## 尚未收编（第二批挂账）

- dispatch 的 6 颗 webview RPC（host.getConfig/getAllBindings/setDocBindings/copyToSandbox/…）——闸已在跑，迁移=换执行器不改语义。
- 绑定族命令（bindParts/materialize/audit/complete/togglePartRole）与 compile 族（compileAndShow）。
- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。

