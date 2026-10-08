// 连线走线方式 —— 编译模式与沙盒模式共用的一份实现。
//
// 为什么要有这个文件：走线设置原先只被沙盒画布消费（且只改
// `paper.options.defaultRouter`），于是 ①编译模式的电路图完全不受影响，
// ②改完设置后已经画出来的线不动 —— 用户看到的是「设置只作用一半、
// 还要重开文件才生效」。这里把「设默认 + 逐条重排已有连线」合成一个动作。

export type WireStyle = 'metro' | 'orthogonal' | 'straight';

export const ROUTERS: Record<string, any> = {
  metro: { name: 'metro', args: { startDirections: ['right'], endDirections: ['left'], maximumLoops: 200, step: 2.5 } },
  orthogonal: { name: 'orthogonal', args: { elementPadding: 8 } },
  // 「直线」= joint 的 `normal` 路由（不绕行）。
  // 实测本版本 joint 的 Link **没有 removeRouter()**，置 null 只会退回
  // paper.options.defaultRouter（也就是 metro），于是「选直线但线路不动」。
  straight: { name: 'normal', args: {} },
};

export const routerFor = (style: WireStyle | string) =>
  (style in ROUTERS ? ROUTERS[style] : ROUTERS.metro);

/**
 * 应用走线方式：设 paper 默认路由，并把**已经画出来的每条连线**显式重排。
 *
 * 只改 `options.defaultRouter` 对已渲染的 link 不生效（视图沿用上次的路径），
 * 所以必须逐条 `link.router(...)` —— 它会触发 change:router，joint 随即重画该线。
 */
export function applyWireStyle(paper: any, style: WireStyle | string): void {
  if (!paper) return;
  const router = routerFor(style);
  try { paper.options.defaultRouter = router; } catch { /* ignore */ }
  try {
    for (const link of paper.model.getLinks()) {
      try { link.router(router.name, router.args); } catch { /* 单条失败不影响其余 */ }
    }
  } catch { /* ignore */ }
  try { paper.updateViews(); } catch { /* ignore */ }
}
