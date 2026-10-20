# API_REFERENCE（生成物 · 统一调用层）

> ⛔ **手改无效**：本文件由 `pnpm api:doc` 从 registry（`toolsFs.ts`／`toolsDomain.ts`／`dispatch.ts` 三处 `register*Tools()` 的并集）+ 契约（extension/api/vv-api.defaults.json，工程层 `.vv/api.json` 只许收窄）**生成**；漂移会被台架钉住。
> apiVersion `0.1.0` · 生成工具数 **45** · 调用面 ui=开 / rpc=开 / mcp=开 / cli=关
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
| `bindings.audit` | Audit binding integrity | read | none | ui/mcp | — | `bindings.audit` | 0.2.0 |
| `bindings.complete` | Write complete bindings | config-write | config-write | ui/mcp | — | `bindings.complete` | 0.2.0 |
| `bindings.explain` | Single-instance resolution trace | read | none | ui/mcp | — | `bindings.explain` | 0.4.0 |
| `bindings.get` | Read bindings | read | none | ui/mcp | — | `bindings.get` | 0.2.0 |
| `bindings.materialize` | Persist auto-bindings | config-write | config-write | ui/mcp | — | `bindings.materialize` | 0.2.0 |
| `bindings.set` | Write binding | config-write | config-write | ui/mcp | — | `bindings.set` | 0.2.0 |
| `circuits.list` | Read circuits list | read | none | ui/mcp | — | `circuits.list` | 0.2.0 |
| `circuits.toggle` | Toggle part role | config-write | config-write | ui/mcp | — | `verilogViz.togglePartRole` | 0.2.0 |
| `compile.auditBindings` | Audit unregistered instances (read-only) | read | none | ui | — | `verilogViz.auditBindings` | 0.1.0 |
| `compile.closure` | Dependency closure | read | none | ui/mcp | — | `compile.closure` | 0.2.0 |
| `compile.compileAndShow` | Compile & view circuit | process | process | ui/mcp | — | `verilogViz.compileAndShow` | 0.1.0 |
| `compile.completeBindings` | Bulk-write bindings (complete the table) | config-write | config-write | ui/mcp | — | `verilogViz.completeBindings` | 0.1.0 |
| `compile.hierarchy` | Instance hierarchy (same owner as the tree) | read | none | ui/mcp | — | `compile.hierarchy` | 0.4.0 |
| `fs.copyPath` | Copy path | read | none | ui | — | `verilogViz.copyPath` | 0.2.0 |
| `fs.createFile` | Create file | file-write | file-write | ui/mcp | — | `verilogViz.newVerilogFile` | 0.2.0 |
| `fs.createFolder` | Create folder | file-write | file-write | ui/mcp | — | `verilogViz.newSandboxFolder` | 0.2.0 |
| `fs.delete` | Delete | file-write | file-write | ui/mcp | **HITL** | `verilogViz.deleteFile` | 0.2.0 |
| `fs.duplicateFile` | Duplicate file | file-write | file-write | ui/mcp | — | `verilogViz.duplicateFile` | 0.2.0 |
| `fs.duplicateFolder` | Copy folder | file-write | file-write | ui/mcp | — | `verilogViz.duplicateFolder` | 0.2.0 |
| `fs.import` | Import files | file-write | file-write | ui/mcp | — | `verilogViz.importFiles` | 0.2.0 |
| `fs.move` | Move | file-write | file-write | ui/mcp | — | `verilogViz.moveTo` | 0.2.0 |
| `fs.rename` | Rename | file-write | file-write | ui/mcp | — | `verilogViz.renameFile` | 0.2.0 |
| `fs.revealInOS` | Reveal in file explorer | read | none | ui | — | `verilogViz.revealInOS` | 0.2.0 |
| `host.appendOutput` | Write output panel | read | none | rpc | — | `appendOutput` | 0.1.0 |
| `host.copyToSandbox` | Compile graph to sandbox | file-write | file-write | rpc/mcp | — | `copyToSandbox` | 0.1.0 |
| `host.getAllBindings` | Read binding chain | read | none | rpc | — | `getAllBindings` | 0.1.0 |
| `host.getConfig` | Read host config | read | none | rpc | — | `getConfig` | 0.1.0 |
| `host.importLegacyData` | One-time legacy data migration | file-write | file-write | rpc/mcp | **HITL** | `importLegacyData` | 0.1.0 |
| `host.jumpToSource` | Jump to source line | read | none | rpc | — | `jumpToSource` | 0.1.0 |
| `host.publishProblems` | Publish Problems | read | none | rpc | — | `publishProblems` | 0.1.0 |
| `host.saveExportFile` | Host save-as | file-write | file-write | rpc/mcp | — | `saveExportFile` | 0.1.0 |
| `host.setDocBindings` | Write one document's binding table | config-write | config-write | rpc/mcp | — | `setDocBindings` | 0.1.0 |
| `project.doctor` | Project semantic checkup (kernel aggregation) | read | none | ui/mcp | — | `project.doctor` | 0.4.0 |
| `res.listProject` | List compile-domain files | read | none | ui/mcp | — | `res.listProject` | 0.2.0 |
| `res.listSandbox` | List sandbox-domain files | read | none | ui/mcp | — | `res.listSandbox` | 0.2.0 |
| `res.parseFile` | Parser raw output, side by side | read | none | ui/mcp | — | `res.parseFile` | 0.4.0 |
| `res.readBindingTables` | Per-layer binding table verbatim | read | none | ui/mcp | — | `res.readBindingTables` | 0.4.0 |
| `res.readProjectFile` | Read project file | read | none | ui/mcp | — | `res.readProjectFile` | 0.2.0 |
| `sys.ctxSnapshot` | Host implicit-state snapshot (reported as-is) | read | none | ui/mcp/cli | — | `sys.ctxSnapshot` | 0.4.0 |
| `sys.describeTool` | Single-tool deep card (with gate pre-run) | read | none | ui/mcp/cli | — | `sys.describeTool` | 0.3.0 |
| `sys.getStatus` | Host status | read | none | ui/mcp/cli | — | `sys.getStatus` | 0.2.0 |
| `sys.listTools` | Tool discovery | read | none | ui/mcp/cli | — | `sys.listTools` | 0.2.0 |
| `sys.ping` | Liveness probe | read | none | ui/mcp/cli | — | `sys.ping` | 0.4.0 |
| `sys.readAudit` | Read call audit | read | none | ui/mcp/cli | — | `sys.readAudit` | 0.2.0 |
| `sys.selfCheck` | Calling-layer self-check (the agent's first shot) | read | none | ui/mcp/cli | — | `sys.selfCheck` | 0.3.0 |

## 工具详情（参数 schema）

### `bindings.audit` — Audit binding integrity

Lists a document's subpart instances that are not recorded in the table and currently resolve via same-name fallback (simulates the canvas resolution chain from disk content, BFS with budget). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative document path"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `bindings.complete` — Write complete bindings

audit + one-click complete: writes auto-matched unrecorded instances into the document directory table using the top-level-same-origin = bare-key / deeper-level = prefixed strategy; recorded entries are never overwritten.

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

### `bindings.explain` — Single-instance resolution trace

L4 main gun: why this instance resolves to that file (or why it does not). The layer-by-layer trace mirrors the closure's own ruler: prefixed keys before bare keys, near layers override far, keys and values both folded per layer (bindingsForFile's outKey algorithm — not a second ruler); endpoint checks (file exists / contains the module / djs parseable / in the circuits list); verdict + hint (which tool to fire next with which args). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative host document"
    },
    "instance": {
      "type": "string",
      "description": "Instance name / celltype"
    }
  },
  "required": [
    "doc",
    "instance"
  ]
}
```

### `bindings.get` — Read bindings

For doc (root-relative .djs/.v path) = the merged effective bindings along that document's chain (near layers override far, values folded back to root-relative); without doc = the project-root table verbatim. Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative document path (optional)"
    }
  }
}
```

### `bindings.materialize` — Persist auto-bindings

Writes unrecorded-but-auto-same-name-matched resolutions into the document directory table (.djs = same-folder/root name scoring, .v = dependency closure); recorded ones are never touched. Returns the persisted entries.

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

### `bindings.set` — Write binding

Directly writes one binding into a directory layer's `.verilogviz.json` (part=null = delete the key); values are stored relative to that directory. Same semantics as the UI — hand-edited content is precious.

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string",
      "description": "Directory layer (root-relative; default = project-root table)"
    },
    "celltype": {
      "type": "string",
      "description": "Instance / key name"
    },
    "part": {
      "type": [
        "string",
        "null"
      ],
      "description": "Part file (root-relative or relative to that directory; null/empty = delete)"
    }
  },
  "required": [
    "celltype"
  ]
}
```

### `circuits.list` — Read circuits list

The root table's explicit circuits list (the un-parts list); .djs files outside it are all parts. Idempotent read-only.

```json
{
  "type": "object",
  "properties": {}
}
```

### `circuits.toggle` — Toggle part role

In the list = currently a circuit → flip back to part; not in it → mark as circuit (explicit opt-out semantics). Tree/canvas sync is done by the host subscription.

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

### `compile.auditBindings` — Audit unregistered instances (read-only)

Read: list instances across the document’s layers that resolve via same-name fallback and are not recorded in binding tables (host recomputes from disk — same ruler as the canvas banner, collectInstanceHits). Returns {doc, count, hits:[{ctx,name,file}]}. Idempotent, read-only.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative document path"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `compile.closure` — Dependency closure

Compile dependency closure of a .v entry (topological file list + top module). R152 binding authority: un-bound instances land in bindingErrors (use bindings.set to record). Idempotent read-only; no file contents (large).

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "Entry .v (root-relative or fsPath)"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `compile.compileAndShow` — Compile & view circuit

L6: compile one compile-domain source (root-relative .v/.sv/.vh) and push the circuit to the canvas panel; omit path = active editor. Same execution body as the command-palette / editor-title button (lazy panel + closure compile + push). Idempotent (re-push overwrites); returns {via}.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "root-relative .v/.sv/.vh; omit = current active text editor"
    }
  }
}
```

### `compile.completeBindings` — Bulk-write bindings (complete the table)

L6: same kernel as the banner’s "complete the table" (collectInstanceHits scans unrecorded instances per layer → completeFromHits writes current resolutions into each layer’s table; recorded entries untouched, values layer-relative). Optionally pass hits (replay of compile.auditBindings output for precise control). Returns {doc, scanned, written}. Broadcasts bindingsChanged so live canvases clear their banners.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "root-relative document path (.v/.sv/.vh/.djs)"
    },
    "hits": {
      "type": "array",
      "description": "optional: prefetched hits [{ctx,name,file}] (omit = host rescans)"
    }
  },
  "required": [
    "doc"
  ]
}
```

### `compile.hierarchy` — Instance hierarchy (same owner as the tree)

L4 (P3): entry (root-relative .v) as root, fully expanded into a flat table with depth (cap 4) — using the hierarchy tree's own drill-down owner (hierInstancesOf/buildHierDefIndex extracted from HierarchyTree, cycle guard on the same chain ruler); line = first current line of parseVerilogInstancesWithLines (same criteria, two shapes, one ruler). What the tree shows, the agent can ask. Budget 500 nodes + 64KB reply cap (truncated+total reported honestly). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "entry": {
      "type": "string",
      "description": "Root-relative .v entry"
    },
    "depth": {
      "type": "number",
      "description": "Drill depth (cap 4, default 4)"
    }
  },
  "required": [
    "entry"
  ]
}
```

### `fs.copyPath` — Copy path

Absolute path to the clipboard (idempotent, no side effects).

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

### `fs.createFile` — Create file

kind=verilog: minimal compilable template; kind=sandbox: empty canvas `{"cells":[]}` plus a folder binding table (folder with parts gets a table). Opening the editor is the caller's job.

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string",
      "description": "Target folder on disk (default = project root)"
    },
    "name": {
      "type": "string",
      "description": "File name (may include a subpath; the extension is auto-appended)"
    },
    "kind": {
      "type": "string",
      "enum": [
        "verilog",
        "sandbox"
      ],
      "description": "default verilog"
    }
  },
  "required": [
    "name"
  ]
}
```

### `fs.createFolder` — Create folder

Segment-level sanitization (.. escapes die) + recursive folder creation (may include subpaths).

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "description": "May include subpaths"
    }
  },
  "required": [
    "name"
  ]
}
```

### `fs.delete` — Delete

Deletes a file/folder (to trash); bindings/circuits lists pointing at the deleted content are cleaned along (G1 both paths). requiresApproval: non-interactive callers (agents) need HITL approval.

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "The file/folder to delete"
    }
  },
  "required": [
    "uri"
  ]
}
```

### `fs.duplicateFile` — Duplicate file

Copies within the same folder with (n) numbering; the duplicate's role does not follow (defaults to circuit).

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

### `fs.duplicateFolder` — Copy folder

Recursively copies `x` → `x 副本 (n)`; when the copy contains .djs a binding table is created automatically.

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

### `fs.import` — Import files

Copies the given external files into the target folder: domain filter (exts) + (n) dedup + .djs into the parts table. The file picker lives in the caller (agents pass sources directly).

```json
{
  "type": "object",
  "properties": {
    "destDir": {
      "type": "string",
      "description": "Target folder on disk"
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Source file (fsPath/file: uri) list"
    },
    "exts": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Allowed extensions (default v/sv/djs)"
    }
  },
  "required": [
    "destDir",
    "sources"
  ]
}
```

### `fs.move` — Move

Moves a file/folder into the target folder; (n) dedup, self-loop rejected, in-place no-op; binding records move along (G1).

```json
{
  "type": "object",
  "properties": {
    "src": {
      "type": "string",
      "description": "Source file/folder"
    },
    "destDir": {
      "type": "string",
      "description": "Target folder"
    }
  },
  "required": [
    "src",
    "destDir"
  ]
}
```

### `fs.rename` — Rename

Renames a file or folder; binding values / host:: prefixed keys / root circuits move along (G1). Input is single-segment sanitized (../ cannot escape the workspace). Invalid name / same name / target occupied = error (no silent ok:false).

```json
{
  "type": "object",
  "properties": {
    "uri": {
      "type": "string",
      "description": "Target file/folder (fsPath or file: uri)"
    },
    "newName": {
      "type": "string",
      "description": "New name (single segment)"
    }
  },
  "required": [
    "uri",
    "newName"
  ]
}
```

### `fs.revealInOS` — Reveal in file explorer

Calls the workbench revealFileInOS to locate the file/folder (idempotent).

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

### `host.appendOutput` — Write output panel

Write output panel

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "The verbatim text to append (the host does not process it)"
    }
  }
}
```

### `host.copyToSandbox` — Compile graph to sandbox

Compile graph to sandbox

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "description": "Item 0 = the main circuit; the rest are subparts (each written as `<name>.djs` with its folder's binding table)",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "`folder/name` — do not include the .djs suffix (the host appends it)"
          },
          "content": {
            "type": "string",
            "description": "Canvas serialization string {cells:[…]}"
          }
        }
      }
    }
  }
}
```

### `host.getAllBindings` — Read binding chain

Read binding chain

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative document path = merged along the directory chain (near layers override); without it = the project-root table verbatim"
    }
  }
}
```

### `host.getConfig` — Read host config

Read host config

```json
{
  "type": "object",
  "properties": {}
}
```

### `host.importLegacyData` — One-time legacy data migration

One-time legacy data migration

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "Legacy localStorage records; since X18 they may carry the identity trio (key/role/bindings) — when present, folder binding tables are written along",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Entries without an extension are written as `.v` (the source half's path)"
          },
          "content": {
            "type": "string"
          },
          "key": {
            "type": "string",
            "description": "Legacy batch-internal id — used only as this batch's linkage key"
          },
          "role": {
            "type": "string",
            "enum": [
              "part"
            ],
            "description": "This one is an editable part"
          },
          "bindings": {
            "type": "object",
            "description": "celltype → the legacy id of that part in the same batch (by name: duplicates/sanitization can link the wrong file)"
          }
        }
      }
    }
  }
}
```

### `host.jumpToSource` — Jump to source line

Jump to source line

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "description": "Root-relative path"
    },
    "line": {
      "type": "number",
      "description": "0-based (editor convention)"
    }
  },
  "required": [
    "file"
  ]
}
```

### `host.publishProblems` — Publish Problems

Publish Problems

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "One item = one Problems entry; line=null means no line available (do not fake line 1)",
      "items": {
        "type": "object",
        "properties": {
          "fileName": {
            "type": "string",
            "description": "Workspace-root-relative path"
          },
          "line": {
            "type": [
              "number",
              "null"
            ],
            "description": "1-based; null = unknown"
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

### `host.saveExportFile` — Host save-as

Host save-as

```json
{
  "type": "object",
  "properties": {
    "base64": {
      "type": "string",
      "description": "The bytes to write out (base64; messages travel the JSON channel — do not pass a Uint8Array directly)"
    },
    "defaultName": {
      "type": "string",
      "description": "Default file name (decides the save dialog's extension filter)"
    },
    "mime": {
      "type": "string",
      "description": "Caller semantic annotation (currently only for logs/docs)"
    }
  },
  "required": [
    "base64",
    "defaultName"
  ]
}
```

### `host.setDocBindings` — Write one document's binding table

Write one document's binding table

```json
{
  "type": "object",
  "properties": {
    "docName": {
      "type": "string",
      "description": "Root-relative document path; the table lands in its folder layer"
    },
    "bindings": {
      "type": "object",
      "description": "Overwrites only this document's entries (v0.4: other files' prefixed keys do not land in this table, hand-edited entries are untouched; this document always produces prefixed keys)"
    }
  }
}
```

### `project.doctor` — Project semantic checkup (kernel aggregation)

L5: one shot answering how broken this project is, where, and which tool fixes each — the aggregation layer is not a third ruler: missing = collectInstanceHits verbatim; unresolved = each layer's table values verified on-site through readMetaAt+resolveLayerValue (same endpoint criteria as explain); tables = every .verilogviz.json on disk parsed and shape-checked; closure = closureOf (defaults to the latest compile job's entry); probe = D1 gate pre-run (no execution). Verdicts sorted error→warn→info; info level collapsed by default, deep:true expands it (ruling §8.3). Host budget 60, 128KB cap (truncated+total). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "dir": {
      "type": "string",
      "description": "Check only this directory subtree (root-relative; default = whole project)"
    },
    "probe": {
      "type": "string",
      "description": "Also pre-run one tool's gates (name = sys.listTools; no execution = zero side effects)"
    },
    "deep": {
      "type": "boolean",
      "description": "true = expand info-level findings (default: error/warn only)"
    }
  }
}
```

### `res.listProject` — List compile-domain files

Project tree (compile-domain .v/.sv/.vh + all folders, skipping node_modules and dot-prefixed; depth guard 16). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {}
}
```

### `res.listSandbox` — List sandbox-domain files

The sandbox half of the project tree (.djs). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {}
}
```

### `res.parseFile` — Parser raw output, side by side

L4 (P5): the same file bytes fed to two parsers — main column = the main-repo shared/verilogParse (module ports parseModulePorts, instantiation connections parseInstantiations, compile-verification lineage); lite column = the extension-side verilogParseLite (tree/compile-panel lineage). divergence reports the two outputs' diff sets, primitivesIgnored the diff of the three primitive-skip tables — divergences (the dff family skipped by one table but not the other = case r80) are reported side by side, never masked; convergence is a separate campaign (ruling §8.1). .djs is single-column (cells/subcircuits/inputs/outputs = the audit family's vocabulary). 256KB cap (truncated arrays marked). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Root-relative .v/.sv/.vh or .djs"
    }
  },
  "required": [
    "path"
  ]
}
```

### `res.readBindingTables` — Per-layer binding table verbatim

L3: for doc (or dir) = the verbatim content of every `.verilogviz.json` layer from root to that directory (bindings.get only gives the merged result; here you see each layer's circuits/bindings/extra keys). A single table over 32KB is truncated to the first 200 keys and marked truncated. Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "doc": {
      "type": "string",
      "description": "Root-relative document path"
    },
    "dir": {
      "type": "string",
      "description": "or a directory only (that directory's chain to root)"
    }
  }
}
```

### `res.readProjectFile` — Read project file

Reads a text file under the project root (sanitizeRel rejects ../ and absolute traversal; over 2MB rejected). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Root-relative path"
    }
  },
  "required": [
    "path"
  ]
}
```

### `sys.ctxSnapshot` — Host implicit-state snapshot (reported as-is)

L2 what is on stage: active editor / last text uri / sandbox sticky file / compile Panel and latest compile job / live canvas list / visible tabs. Built for P3 (the implicit-context hijack family): agents must not guess who is on stage — every write operation's target still needs explicit args; this tool is for seeing only. Every field can be null, and null is also the truth.

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.describeTool` — Single-tool deep card (with gate pre-run)

Depth D1: a tool's entire truth = registry card (title/description/parameter schema) + contract card (perm/sideEffects/surfaces/ref/approval/since) + gate pre-run (which of gates 1-4 would block this shot, which required args are missing) + the tool's latest audit rows (with traceId). Does not execute the handler = zero side effects. Agents must not probe signatures by really firing.

```json
{
  "type": "object",
  "properties": {
    "tool": {
      "type": "string",
      "description": "Tool id verbatim (fs.rename / host.getConfig…); rpc method names must not be bare — prefix with host."
    },
    "args": {
      "type": "object",
      "description": "The args you intend to pass (only used to check required args — no writes, no execution)"
    },
    "surface": {
      "type": "string",
      "enum": [
        "ui",
        "rpc",
        "mcp",
        "cli"
      ],
      "description": "Which endpoint to judge gate 2 by (default = the caller's own). Diagnostic tools hang on all endpoints, so asking from the agent line whether the canvas line works is a legitimate question"
    },
    "subject": {
      "type": "string",
      "description": "Which subject to judge gate 3 by (default = the caller's own). Gate-bypass channel: returns a judgment only, no execution"
    }
  },
  "required": [
    "tool"
  ]
}
```

### `sys.getStatus` — Host status

Contract version/surfaces/tool ledger size/project root + three live gauges (activation checkpoints / bridge state / openDocs live canvases / lastCompile latest compile job). Idempotent read-only.

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.listTools` — Tool discovery

discoverTools: every registered tool's id/title/description/parameter schema/contract attributes. Agents must rely on this — do not guess signatures from experience.

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.ping` — Liveness probe

L0 sub-millisecond probe: is the extension alive, how far did activate get (checkpoint ledger — the half-alive illusion killer), is the MCP bridge listening, how long has it been up. Zero args, zero side effects — the agent's first shot.

```json
{
  "type": "object",
  "properties": {}
}
```

### `sys.readAudit` — Read call audit

readLogs: reads the last N lines of `.vv/audit/trace-YYYY-MM-DD.jsonl` (hyphenated, byte-identical to the apiAudit sink string; default 50, cap 200); no ledger = empty. Idempotent read-only.

```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "description": "YYYY-MM-DD (default today). The sink filename is concatenated from this string directly — no other separators; to spare callers the guessing, 8-digit plain numbers (YYYYMMDD) are normalized too"
    },
    "limit": {
      "type": "number",
      "description": "Line count (default 50)"
    }
  }
}
```

### `sys.selfCheck` — Calling-layer self-check (the agent's first shot)

Depth D2: one shot answering whether this API is usable right now, which gate is blocking, and where to look — effective contract size and surface switches, registry-vs-contract bidirectional drift, project override .vv/api.json load result and rejection reasons, grants profile liveness and its warnings, three faces of the audit channel (no ledger / still buffered / empty day file) + today's verdict stats and recent denials (with traceId). Optional probe pre-runs one tool. No write operations.

```json
{
  "type": "object",
  "properties": {
    "probe": {
      "type": "object",
      "description": "Pre-runs one tool's gates (same ruler as sys.describeTool); if given, also answers whether you can fire it now",
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
          "description": "Which endpoint to judge by (default = the caller's own)"
        },
        "subject": {
          "type": "string",
          "description": "Which subject to judge gate 3 by (default = the caller's own)"
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
- 契约上账、非 rpc 面且⛔ registry handler：**0** 颗（（无））——这几颗现在由命令面板直调 Extension Host 里的实现，绕开 executeTool。
- 反向（registry 有 handler 而契约⛔ 上账）：**0** 颗（（无））。
- OS 拖入的字节流写盘（拖拽 writeDropped 内联中）。

