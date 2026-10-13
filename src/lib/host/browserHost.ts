/**
 * 浏览器宿主（`pnpm dev` 与无头闸门跑在这里）。
 *
 * ⚠ 这一档的形状全部是"**抛 HostUnsupported**"，⛔ 改成"返回空结果"：
 *   `fileStore.refresh()` 拿到空 `tree.files` 会把 localStorage 里的文件当"磁盘上已删除"
 *   全部过滤掉（浏览器里磁盘永远为空 ⇒ 用户文件被抹光）。今天 invoke 在浏览器里必抛，
 *   catch 住之后走重试/保留本地清单那一条路——本档只是把这层"必抛"搬到明面上。
 *
 * 唯二真的实现了的能力：
 *   · 导出＝`<a download>`（`saveExport` 的老浏览器回退路径原样搬过来）
 *   · 无自绘标题栏（`hasWindowControls:false` ⇒ WindowControls 渲染 null，同今天）
 */
import { HostUnsupported, type ProjectHost } from './host';

/**
 * ⛔ `throw`（同步炸）：接口声明的是 Promise，同步抛会让 `h.x().catch(...)` 这种写法在**调用点**炸开，
 * 而不是走到它自己的 catch 里——这条是这批单测第一次跑就抓到的形状错（类型在骗人）。
 */
const nope = (method: string): Promise<never> => Promise.reject(new HostUnsupported(method, 'browser'));

export const browserHost: ProjectHost = {
  id: 'browser',
  hasWindowControls: false,

  saveProjectFile: () => nope('saveProjectFile'),
  listProjectTree: () => nope('listProjectTree'),
  readProjectFile: () => nope('readProjectFile'),
  deleteProjectFile: () => nope('deleteProjectFile'),
  createProjectFolder: () => nope('createProjectFolder'),
  deleteProjectFolder: () => nope('deleteProjectFolder'),
  moveProjectFile: () => nope('moveProjectFile'),
  moveProjectFolder: () => nope('moveProjectFolder'),
  copyProjectFile: () => nope('copyProjectFile'),
  copyProjectFolder: () => nope('copyProjectFolder'),

  readProjectConfig: () => nope('readProjectConfig'),
  saveProjectConfig: () => nope('saveProjectConfig'),

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

  // 剪贴板留给调用方现有的 DOM 兜底（CodeEditor 的 textarea 那一条路，行为不变）
  clipboardWrite: () => nope('clipboardWrite'),
  clipboardRead: () => nope('clipboardRead'),

  windowIsMaximized: () => nope('windowIsMaximized'),
  onWindowResize: () => nope('onWindowResize'),
  windowMinimize: () => nope('windowMinimize'),
  windowToggleMaximize: () => nope('windowToggleMaximize'),
  windowClose: () => nope('windowClose'),
};
