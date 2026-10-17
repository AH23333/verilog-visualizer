# API_REFERENCE（生成物 · 统一调用层）

> ⛔ **手改无效**：本文件由 `pnpm api:doc` 从 registry（extension/src/toolsFs.ts）+ 契约（extension/api/vv-api.defaults.json，工程层 `.vv/api.json` 只许收窄）**生成**；漂移会被台架钉住。
> apiVersion `0.1.0` · 生成工具数 **10** · 调用面 ui=开 / rpc=开 / mcp=关 / cli=关
>
> **调用方式（三方同门）**：`executeTool(context, caller, toolId, args)`（extension/src/toolRegistry.ts）。
> **闸序（硬）**：① 登记（registry∧契约双查）→ ② surfaces（全局开关∧工具面）→ ③ 档案 `.vv/api.grants.json` → ④ `requiresApproval` 且调用方非交互 ⇒ HITL 弹窗。
> **审计**：每次过闸一行 JSONL 落 `.vv/audit/trace-YYYYMMDD.jsonl`（verdict 七值：auto/approved/denied/error/surface-denied/not-registered/not-granted；args 只记形状摘要）。
> **错误标签**：`[API_NOT_REGISTERED]` / `[API_SURFACE_DENIED]` / `[API_NOT_GRANTED]` / `[API_NOT_APPROVED]`（机读 code = 去掉 `[API_]` 壳）。

## 工具总表

| 工具 id | 标题 | perm | sideEffects | surfaces | 审批 | ref（命令/rpc） | since |
|---|---|---|---|---|---|---|---|
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

## 工具详情（参数 schema）

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

重命名文件或目录；绑定值/`宿主::`前缀键/根表 circuits 随迁（G1）。输入经单段消毒（`../` 无法逃出工作区）。

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

## 尚未收编（第二批挂账）

- dispatch 的 6 颗 webview RPC（host.getConfig/getAllBindings/setDocBindings/copyToSandbox/…）——闸已在跑，迁移=换执行器不改语义。
- 绑定族命令（bindParts/materialize/audit/complete/togglePartRole）与 compile 族（compileAndShow）。
- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。

