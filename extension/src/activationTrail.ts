// ============================================================================
// 激活检查点登记簿（R160 批次四 四-1，病灶 P1「扩展半活假象」的终结者）。
// 案底：workspace.onDidFilesChange 假 API 炸在 activate 中段——抛错点**之前**注册的命令/watcher
// 照常可用，上屏读数全绿；之后的一切静默失踪。VS Code 只在日志里说一句
// "Activating extension failed"，agent/用户没有任何**可编程**的通道问"你活到哪一步断的"。
//
// 本模块＝activate 的航行记录仪：每过一个里程碑 mark 一笔；activate 若在两笔之间抛错，
// 最后一笔的下一格就是断头位（snapshot.done=false＋failedAfter=最后完成段）。
// 读数进 sys.ping / sys.getStatus / sys.selfCheck 三张脸（一颗真源，⛔ 三处各记各的）。
//
// ⚠ 语义纪律：mark 只增不删、进程内一份（activate 重跑＝reset）；这里⛔ 判断"该不该活"——
//   它只是记录仪，判闸仍在 executeTool。
// ============================================================================

export interface Checkpoint { stage: string; atMs: number; err?: string }

let t0 = 0;
const trail: Checkpoint[] = [];

/** activate 入口调一次：清场重记（热重载/测试复用同进程）。 */
export function markActivationStart(): void { t0 = Date.now(); trail.length = 0; }

/** 一个里程碑＝活过了这一段。 */
export function markActivated(stage: string): void { trail.push({ stage, atMs: Date.now() - t0 }); }

/** 显式认栽（调用方自己 catch 到错时用；activate 未包 try/catch，断头位靠 failedAfter 推）。 */
export function markActivationFail(stage: string, err: unknown): void {
  trail.push({ stage, atMs: Date.now() - t0, err: String(err instanceof Error ? err.message : err).slice(0, 200) });
}

/** 终态读数（ping/getStatus/selfCheck 共用这颗形状）。
 *  ⚠ done＝账上**有**'done' 那颗（⛔ 判"最后一颗"——桥等 activate 尾部的异步补点会排在 done 之后）。 */
export function activationSnapshot(): { done: boolean; failedAfter: string | null; checkpoints: Checkpoint[]; uptimeMs: number } {
  const last = trail[trail.length - 1];
  const dead = !!last && !!last.err;
  const done = trail.some((c) => c.stage === 'done') && !dead;
  return {
    done,
    failedAfter: dead ? last.stage : (done ? null : (last ? last.stage : null)),
    checkpoints: trail.slice(),
    uptimeMs: Date.now() - t0,
  };
}
