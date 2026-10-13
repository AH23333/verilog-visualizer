/**
 * 「启动后要不要自动把窗口弹出来」这颗判断单独成档，因为它**⛔ 依赖 vscode 模块**：
 * 放 `extension.ts` 里就只能真开一次 Extension Host 才知道对不对，
 * 而它恰恰是那种错了很贵的规则——判宽了＝在我们⛔ 拥有的编辑器里抢开局（骚扰），
 * 判窄了＝我们自己的二进制启动后只剩一颗 Welcome 页（R139 片 2 真机读到的就是这个症状）。
 *
 * 旧规则只看 `extensionMode === Development`。实测（Code - OSS 源码现读）：
 * `src/vs/platform/environment/common/environmentService.ts:105`
 * ⇒ `isExtensionDevelopment` **只在传了 `--extensionDevelopmentPath` 时为真**，
 * 所以把我们自己的内置扩展装进我们自己的二进制里跑，它是 **Production** ⇒ 旧规则永不触发。
 */

/** 手工兜底开关（真机点验要用它，⛔ 让用户去改代码才能强开） */
export const AUTOOPEN_ENV = 'VERILOG_VIZ_AUTOOPEN';

/**
 * 我们的扩展是不是**编进了正在跑的这份产品**（内置扩展）。
 * 判据是位置而不是产品名：内置扩展一定住在 `appRoot` 底下
 * （开发态 `<checkout>/extensions/<id>`，打包态 `<app>/resources/app/extensions/<id>`），
 * 而用户日常那份 VS Code 里我们是 `<userProfile>/extensions/<publisher>.<id>` ⇒ 在 appRoot **外**。
 * 拿 `vscode.env.appName` 比字符串也能过，但那是把行为押在品牌文案上，改一次名字就静默失效。
 *
 * 分隔符与大小写必须先归一再比：Windows 上 appRoot 带反斜杠、盘符大小写不定，
 * 直接 `fsPath.startsWith(appRoot)` 在我们自己的二进制上会判 false ⇒ 又回到"只剩 Welcome 页"。
 */
export function isBuiltIntoThisApp(extensionFsPath: string, appRoot: string): boolean {
  const norm = (p: string) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const ext = norm(extensionFsPath);
  const root = norm(appRoot);
  return !!root && (ext === root || ext.startsWith(root + '/'));
}

/**
 * 三种来路各判一次：
 *  · 环境变量 `=1` ⇒ 一律开（点验用）；
 *  · 开发宿主（`pnpm app` / F5，`extensionMode === Development`）⇒ 开，这是 R138 定的"⛔ 让人去命令面板找"；
 *  · 编进这份产品的内置扩展 ⇒ 开，这是我们自己的二进制该有的开局；
 *  · 其余（我们被装进别人的编辑器）⇒ ⛔ 开。
 */
export function shouldAutoOpen(input: {
  extensionMode: number;
  developmentMode: number;
  builtIntoThisApp: boolean;
  envFlag?: string;
}): boolean {
  if (input.envFlag === '1') return true;
  if (input.extensionMode === input.developmentMode) return true;
  return input.builtIntoThisApp;
}
