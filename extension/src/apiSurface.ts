// ============================================================================
// 统一 API 层·读侧（CONFIG_PROTOCOL §9，阶段二第一刀）
// 内置默认契约 = 随包分发的工具账（vv-api.defaults.json，产品定义「有什么能力」）；
// 工程 `.vv/api.json` 的 surfaces 覆盖合流 = 下一刀（MCP/CLI 接线期）。
// 本刀立的是**一致性锁**（tests/unit/vscodeShell.test.ts）：dispatch RPC 面与这张账
// 双向相等（加方法不落账＝红；账上幽灵 ref＝红）——三面同源的地基先钉死，执行端点闸随阶段二推进。
// ============================================================================
import defaults from '../api/vv-api.defaults.json';

export interface ApiToolDef {
  perm: string;
  sideEffects: string;
  requiresApproval?: boolean;
  surfaces: string[];
  ref: string;
  timeoutMs?: number;
  maxConcurrent?: number;
  idempotent?: boolean;
  since?: string;
  description?: string;
}
export interface ApiContract {
  apiVersion: string;
  sources?: unknown;
  surfacesGlobal?: Record<string, boolean>;
  tools: Record<string, ApiToolDef>;
}

export function loadApiContract(): ApiContract {
  return defaults as ApiContract;
}

/** 端点是否可调用此工具（闸 1∧闸 2；profile 授权闸接入在 api.grants 落地刀）。 */
export function canSurface(toolId: string, surface: 'ui' | 'rpc' | 'mcp' | 'cli'): boolean {
  const c = loadApiContract();
  if ((c.surfacesGlobal?.[surface] ?? true) === false) return false;
  const t = c.tools[toolId];
  return !!t && t.surfaces.includes(surface);
}

/** rpc method → tool id 反查（一致性锁与未来 RPC 面执行闸共用）。 */
export function toolIdForRpc(method: string): string | undefined {
  for (const [id, t] of Object.entries(loadApiContract().tools)) if (t.ref === method && t.surfaces.includes('rpc')) return id;
  return undefined;
}
