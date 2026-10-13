// 「启动后自动弹窗口」的判据（extension/src/startupPolicy.ts）。
// 为什么这颗判断值得单独有一份无头证人：它是**双向都会错**的那种规则——
//   判宽了＝我们被装进别人那份 VS Code 时一启动就抢走开局（骚扰，且我们在 R138 之前就是这一档）；
//   判窄了＝我们自己的二进制启动后只剩一颗 Welcome 页，用户以为产品没起来（R139 片 2 真机读到的就是这个）。
// 两个症状都⛔ 不开一份真窗口看不见，但判据本身只吃字符串与数字 ⇒ 全部可在无头判，⛔ 留给手感。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AUTOOPEN_ENV, isBuiltIntoThisApp, shouldAutoOpen } from '../../extension/src/startupPolicy';

const ROOT = path.resolve(__dirname, '..', '..');

/** `vscode.ExtensionMode` 的三档值（Test=1 / Development=2 / Production=3）——这里⛔ import vscode，
 *  所以数值自己写；用错一位就会让下面的臂互相矛盾，故先钉一颗"开发档≠生产档" */
const DEV = 2, PROD = 3;

describe('自动开窗：三种来路各判一次', () => {
  it('开发宿主（pnpm app / F5）⇒ 开（R138 定的"⛔ 让人去命令面板找"仍然有效）', () => {
    expect(shouldAutoOpen({ extensionMode: DEV, developmentMode: DEV, builtIntoThisApp: false })).toBe(true);
  });

  it('我们自己的二进制（Production + 扩展编在 appRoot 里）⇒ 开', () => {
    expect(shouldAutoOpen({ extensionMode: PROD, developmentMode: DEV, builtIntoThisApp: true })).toBe(true);
  });

  it('被别人安装的扩展（Production + 住在 appRoot 外）⇒ ⛔ 开（那是别人的编辑器）', () => {
    expect(shouldAutoOpen({ extensionMode: PROD, developmentMode: DEV, builtIntoThisApp: false })).toBe(false);
  });

  it('环境变量那颗兜底能压过前两档（真机点验靠它，⛔ 让人改代码才能强开）', () => {
    expect(shouldAutoOpen({ extensionMode: PROD, developmentMode: DEV, builtIntoThisApp: false, envFlag: '1' })).toBe(true);
    // ⚠ 只有 '1' 算开：写成"非空就开"的话，有人设了 VERILOG_VIZ_AUTOOPEN=0 反而开了
    expect(shouldAutoOpen({ extensionMode: PROD, developmentMode: DEV, builtIntoThisApp: false, envFlag: '0' })).toBe(false);
  });

  it('这一档⛔ 有"生产态且非内置"以外的漏网形状：三档输入穷举一遍', () => {
    const outs: string[] = [];
    for (const mode of [DEV, PROD]) for (const built of [false, true]) {
      outs.push(`${mode}/${built}=${shouldAutoOpen({ extensionMode: mode, developmentMode: DEV, builtIntoThisApp: built })}`);
    }
    expect(outs).toEqual(['2/false=true', '2/true=true', '3/false=false', '3/true=true']);
  });
});

describe('「编进这份产品」按位置判，⛔ 按品牌名判', () => {
  // 两处真形状（都在这台机器上读到过）：
  //   开发态基座：checkout 根就是 appRoot，内置扩展在 <appRoot>/extensions/<id>
  //   打包态：<app>/resources/app 才是 appRoot
  it('开发态与打包态都认（反斜杠＋大小写＋尾斜杠都得先归一）', () => {
    expect(isBuiltIntoThisApp('D:\\vv-studio\\vscode\\extensions\\verilog-visualizer', 'D:\\vv-studio\\vscode')).toBe(true);
    expect(isBuiltIntoThisApp('d:/vv-studio/vscode/extensions/verilog-visualizer', 'D:\\vv-studio\\vscode\\')).toBe(true);
    expect(isBuiltIntoThisApp(
      'C:\\Program Files\\Verilog Visualizer\\resources\\app\\extensions\\verilog-visualizer',
      'C:\\Program Files\\Verilog Visualizer\\resources\\app')).toBe(true);
  });

  it('用户日常那份 VS Code 里的我们 ⇒ false（扩展目录在 appRoot 外）', () => {
    expect(isBuiltIntoThisApp(
      'C:\\Users\\34697\\.vscode\\extensions\\local.verilog-visualizer-vscode',
      'D:\\Microsoft VS Code\\resources\\app')).toBe(false);
  });

  it('归一这一步是必要的（⛔ 拿裸 startsWith 当等价实现）', () => {
    // 变异证人：把 isBuiltIntoThisApp 换成 `extPath.startsWith(appRoot)`，这一臂就红了——
    // 也就是说"分隔符/大小写归一"⛔ 是装饰，它就是我们自己那台机器上的成败分野。
    const extPath = 'd:/vv-studio/vscode/extensions/verilog-visualizer';
    const appRoot = 'D:\\vv-studio\\vscode';
    expect(extPath.startsWith(appRoot)).toBe(false);
    expect(isBuiltIntoThisApp(extPath, appRoot)).toBe(true);
  });

  it('appRoot 给空串时一律 false（⛔ 空前缀把谁都判成内置）', () => {
    expect(isBuiltIntoThisApp('C:/anything', '')).toBe(false);
    // 两边都空也必须 false：少了 root 那颗守卫时 `ext === root` 会把它放成"内置"
    expect(isBuiltIntoThisApp('', '')).toBe(false);
  });
});

describe('接线与依赖形状（无头能判的那一半）', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'extension/src/startupPolicy.ts'), 'utf8');
  const ext = fs.readFileSync(path.join(ROOT, 'extension/src/extension.ts'), 'utf8');

  it('判据这一档⛔ 碰 vscode（碰了就只能在 Extension Host 里跑，这颗无头证人当场失效）', () => {
    expect(policy).not.toMatch(/from ['"]vscode['"]/);
  });

  it('extension.ts 只许**一处**开局判定，且走的是那颗纯函数（⛔ 又退回裸 extensionMode 比较）', () => {
    expect((ext.match(/shouldAutoOpen\(/g) || []).length).toBe(1);
    expect(ext).toMatch(/from ['"]\.\/startupPolicy['"]/);
    // 裸比较一旦回来，就意味着"我们自己的二进制"那一档又没人负责了
    expect(ext).not.toMatch(/if \(context\.extensionMode === vscode\.ExtensionMode\.Development \|\|/);
  });

  it('环境变量的名字只有主人一处（⛔ 宿主侧与文档各写一份字面量）', () => {
    expect(AUTOOPEN_ENV).toBe('VERILOG_VIZ_AUTOOPEN');   // 这颗常量是名字的**唯一**出处
    expect(policy).toMatch(/export const AUTOOPEN_ENV = 'VERILOG_VIZ_AUTOOPEN'/);
    expect(ext).toMatch(/process\.env\[AUTOOPEN_ENV\]/);
    expect((ext.match(/VERILOG_VIZ_AUTOOPEN/g) || []).length).toBe(0);
  });
});
