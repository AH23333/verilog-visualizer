# 国际化（i18n）设计 · 英文优先（2026-10-19）

> 背景：深度战役收口后用户令「先做英文国际化」。本稿是 i18n 的**唯一设计正本**（实现形状 / 覆盖分期 / 闸门 / 欠账）；
> 施工账＝账本卷七十一，读数＝CHANGELOG「i18n」段。
> ⛔ 第二真源：语言判据、字典形状只在这里写一次；代码注释只引本稿。

## 一、目标与语言判据

- **产品面语言跟随宿主**：扩展侧读 `vscode.env.language`；webview 由 `extension/src/html.ts` 把同一值写进
  `<meta name="vv-locale" content="…">`（CSP 下**不注内联脚本**——inline script 无 nonce 必被拦），前端启动时读；
  `pnpm dev` 浏览器预览回落 `navigator.language`。
- **归一**：`zh*` → `zh-CN`（中文），其余（`en*`、`ja`、空值、未知）→ `en`。**英文是国际缺省**；
  zh 系用户看中文，行为与今天完全一致。
- ⛔ **不做应用内语言切换 UI**：跟随 VS Code 显示语言（宿主自带切换入口）——避免第二套状态与「切了没生效」案族。

## 二、字典形状与 API

- **中文原文即键**（message-as-key）：代码保留中文原句，`t('中文原句', { name })` 查英文表；`zh-CN` 直接回原文。
  理由：① 不发明 600+ 个键名（键名＝第二真源，改文案即漂移）；② 存量可逐文件增量迁移，未迁移的照旧中文；
  ③ 缺译**回落中文**（产品永不空串），完备性由台架钉，不靠人肉记。
- **插值**：`{name}` 形。⛔ 用模板串拼句子（英文语序不同，拼不出）；带变量的句子先改写成插值再翻译。
- 英文表位置：`src/i18n/en.ts`（前端）· `extension/src/i18n.en.ts`（扩展侧），分组注释按域。
- **manifest 走 VS Code 标准**：`extension/package.nls.json`（英文＝缺省）+ `extension/package.nls.zh-cn.json`（中文），
  `extension/package.json` 的字符串换成 `%key%` 引用。

## 三、闸门

1. `tests/unit/i18n.test.ts`：
   - locale 归一（`zh-cn`/`zh-CN`/`zh-tw`/`en`/`ja`/空）；
   - 插值替换与缺参保留；缺译回落原文；
   - **字典完备性**：扫 `src/**` 与 `extension/src/**` 里出现的 `t('…')` 字面量，英文表必须有对应项（孤儿键也报）；
   - **英文面无 CJK**：对已迁移面（英文表覆盖的键）断言译文中无中日韩字符。
2. **manifest 对账**：`package.json` 的 `%key%` 与 `package.nls.json` / `package.nls.zh-cn.json` 双向无孤儿
   （漏 key＝装出来是裸 `%key%`，真机才炸）。
3. 台架全量 + 真宿主 harness（语言不改，验不回归）；构建链（tsc×2 / lint / api:doc）照旧。

## 四、覆盖分期（正本表）

| 期 | 面 | 规模（串） | 状态 |
|---|---|---|---|
| S1 | i18n 内核（两侧）＋ manifest（命令/视图/配置/欢迎页）＋扩展用户可见消息＋前端工具条/常用弹窗/沙盒器件目录/单元右键菜单 | ~400 | **本批** |
| S2 | `SandboxCanvas` 深串（菜单/toast/DRC）＋ `doc`/`gates` 长文＋`test-real`＋`apiDoc` | ~350 | 在册欠账 |
| — | **API 契约串**（`toolsDomain` 工具描述/错误码壳/hint）**暂不动**：机器面契约，深度战役刚收口（366 处测试断言压着），改动需契约版本决策 | ~140 | 另议 |

> 迁移顺序按「用户一天里看得最多的面」：工具条 → 弹窗 → 右键菜单 → 器件目录 → 通知/树文案。

## 五、施工纪律

- **一次一颗文件**：改完跑台架 + `git diff` 逐串目检；⛔ 全局正则替换——中文串常兼作查表键（器件目录名、菜单 id），
  包一层 `t()` 就断链，且 grep 看不出来。
- 新增 UI 串一律 `t()`；新增英文缺项＝`i18n.test.ts` 当场红。
- 英文译名口径：VS Code 用词优先（Command Palette / Explorer / Problems），电路术语用业界通名
  （schematic / netlist / flip-flop / multiplexer / seven-segment display），⛔ 拼音。
