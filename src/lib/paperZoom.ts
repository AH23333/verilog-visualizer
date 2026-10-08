// 以光标为锚点缩放一张 joint paper —— 全仓只这一份实现。
//
// 为什么单独拎出来：这套数学在本仓被打回来过两次（实测「一滚轮画面就没了」），
// 而且一度存在两份不一样的版本：展开图弹窗走这里的锚点式，沙盒主画布的 Ctrl+滚轮
// 却只调 `paper.scale(k)` 不补平移 —— 放大 3 倍后内容整块滑出视野，症状与用户报的
// 那条一模一样。判据 tests/r57-zoom-anchor-gate.cjs 钉住：三处画布都必须用这一份。
//
// joint 的 SVG 有 y 轴翻转：先取光标处的**局部**坐标 → scale → 再取一次，
// 两次的差乘上新 scale 补进 translate，光标底下的内容就不会跳走。
// ⚠ 别改回 `t + c - (c - t) * k` 那类自推公式：在这套坐标系下实测偏 140–326px。
export function zoomPaperAtClient(paper: any, clientX: number, clientY: number, factor: number,
  min = 0.05, max = 8): number {
  const cur = Number(paper.scale().sx) || 1;
  const next = Math.max(min, Math.min(max, cur * factor));
  if (next === cur) return cur;
  const before = paper.clientToLocalPoint(clientX, clientY);
  paper.scale(next, next);
  const after = paper.clientToLocalPoint(clientX, clientY);
  const t = paper.translate();
  paper.translate(t.tx + (after.x - before.x) * next, t.ty + (after.y - before.y) * next);
  return next;
}
