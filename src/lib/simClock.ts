/**
 * 仿真步进间隔的唯一写法。
 *
 * 上游 digitaljs 的定时器只在 start() 里读一次 `_interval_ms`：
 *   start(){ this._interval = setInterval(() => {…}, this._interval_ms) }
 *   set interval(t){ this._interval_ms = t }        // 只改字段，不动已经起好的表
 * 所以"运行中光写 circuit.interval"是不生效的 —— r62 实测：拨到 5ms 后同样的采样窗口里
 * 信号只翻了 2 次（和 200ms 档的 1 次几乎一样）。改档必须把表重起一遍。
 */
export function setSimInterval(circuit: any, ms: number, startIfStopped = false): void {
  if (!circuit) return;
  try {
    circuit.interval = ms;
    if (circuit.running) { circuit.stop(); circuit.start(); }
    else if (startIfStopped) circuit.start();
  } catch { /* 引擎未就绪 / 这一版不认这个属性 */ }
}
