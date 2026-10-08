/**
 * 虚拟路径工具 —— 两个模式的文件树都是"`/` 分隔的纯字符串路径"（`FileItem.name`
 * 与 `SandboxFile.name` 同形，没有维护 `folder` 字段）。
 *
 * 为什么单独一份（不是洁癖）：「取所在文件夹」这一件事原本**有两种拼法各自手写**
 * （`slice(0, lastIndexOf('/'))` 与 `split('/').slice(0,-1).join('/')`，共 7 处），
 * 而它是部件绑定作用域的地基：`resolvePartRef` 的 scope、移动时的部件随行、
 * 部件清单的 folder 列、拖放的落点文件夹，全建立在"`/` 之前就是文件夹"这一条上。
 * 两种写法一旦飘开，症状是"绑定解析到了另一个同名部件"，而这类坑本仓已经栽过
 * （两颗闸门各写一份"找那一行开关"，一份飘掉 ⇒ 选中了别的人）。
 * 证人：`tests/r90-single-owner-gate.cjs`（两种拼法都只许出现在本文件里）。
 */

/** 取路径的所在文件夹（最后一个 `/` 之前；根目录返回 `''`）。 */
export function parentDir(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
