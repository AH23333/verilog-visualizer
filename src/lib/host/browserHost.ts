/**
 * 浏览器宿主（`pnpm dev` 与无头闸门跑在这里）。
 *
 * ⚠ 这一档的形状全部是"**抛 HostUnsupported**"，⛔ 改成"返回空结果"：
 *   调用方 `.catch(console.warn)` 靠 rejection 区分"宿主没有"与"宿主说没有"，
 *   返回空结果会把失败伪装成成功（当年 fileStore 拿空表删光用户文件那族教训）。
 *
 * 唯二真的实现了的能力：
 *   · 导出＝`<a download>`（saveExport 的老浏览器回退路径原样搬过来）
 *   · Problems/Output＝no-op（浏览器无 workbench UI 可挂，resolve 掉让调用方无感）
 *   · getConfig＝默认值（浏览器没有 Settings UI，回默认让画布能起）
 *   · 其余一律 reject：浏览器没有"项目目录"这个概念，⛔ 拿空结果糊弄调用方
 */
import { HostUnsupported, type ProjectHost } from './host';

/**
 * ⛔ `throw`（同步炸）：接口声明的是 Promise，同步抛会让 `h.x().catch(...)` 这种写法在**调用点**炸开，
 * 而不是走到它自己的 catch 里——这条是这批单测第一次跑就抓到的形状错（类型在骗人）。
 */
const nope = (method: string): Promise<never> => Promise.reject(new HostUnsupported(method, 'browser'));

export const browserHost: ProjectHost = {
  id: 'browser',

  getConfig: async () => ({
    compile: { noFlatten: false, noOpt: false, autoRecompile: true },
    sandbox: {
      gridSize: 16, showGrid: true, snapToGrid: true, wireStyle: 'metro',
      defaultBits: 1, autoStartSim: true, simSpeedMs: 10, foldConstants: true,
    },
    editorFontSize: 16,
  }),

  saveExportFile: async (bytes, defaultName, mime) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },

  /* browser 档无 workbench UI 可挂——no-op（调用方 hostFire 吞掉，无副作用） */
  publishProblems: async () => {},
  appendOutput: async () => {},

  copyToSandbox: () => nope('copyToSandbox'),
  importLegacyData: () => nope('importLegacyData'),
  getAllBindings: () => nope('getAllBindings'),
  setDocBindings: () => nope('setDocBindings'),
  jumpToSource: () => nope('jumpToSource'),
};
