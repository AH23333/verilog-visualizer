// ============================================================================
// 宿主活体状态（R160 批次四 四-1）：extension.ts 写、toolsDomain 读的**单向小格子**。
// 为什么要有这颗：sys.ping/ctxSnapshot 想知道"编译画布开着没"，但 panel 的主人在 extension.ts——
// toolsDomain ⛔ import extension.ts（循环），extension→tools 的 setter 又要管时序。
// 一颗中立小模块，写方只写两笔（open/dispose），读方只读——⛔ 事件⛔ 回调，别为两个布尔建框架。
// ============================================================================

export const hostState: { panelOpen: boolean } = { panelOpen: false };
