// 沙盒设计规则检查（DRC）纯函数 —— 从 SandboxCanvas 抽出（卷三十一 重构第一轮）。
//
// 只依赖 paper（joint Graph + views），不碰组件状态：读模型出 issues，并把
// sm-illegal 类落到违规连线的 view 上（高亮通道与选中高亮 sm-selected 同款）。
// 消费方：SandboxCanvas 的 runDrc/scheduleDrc 薄壳（保留 drcIssues 闭包、
// window.__sandboxDrc QC 钩子与 setDrc 状态）。

export interface DrcIssue { linkId: string; msg: string }

/** 扫描全部连线的合法性；顺带刷 sm-illegal 高亮。返回问题清单。 */
export function runCanvasDrc(paper: any): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const links = paper.model.getLinks();
  const byTarget = new Map<string, string[]>();
  for (const l of links) {
    const s = l.get('source') || {};
    const tgt = l.get('target') || {};
    if (!s.id || !s.port || !tgt.id || !tgt.port) { issues.push({ linkId: l.id, msg: t('悬空连线：端点未接在端口上') }); continue; }
    const sc = paper.model.getCell(s.id);
    const tc = paper.model.getCell(tgt.id);
    if (!sc || !tc) { issues.push({ linkId: l.id, msg: t('连线指向已删除的部件') }); continue; }
    const sp = typeof sc.getPort === 'function' ? sc.getPort(s.port) : null;
    const tp = typeof tc.getPort === 'function' ? tc.getPort(tgt.port) : null;
    if (!sp || !tp) { issues.push({ linkId: l.id, msg: t('连线端口不存在：{from} → {to}', { from: s.port, to: tgt.port }) }); continue; }
    if (s.id === tgt.id) issues.push({ linkId: l.id, msg: t('自环连线（部件连到自己）') });
    if (sp.dir !== 'out' || tp.dir !== 'in') {
      issues.push({ linkId: l.id, msg: t('方向非法：{from} → {to}（必须 输出 → 输入）', { from: sp.dir, to: tp.dir }) });
    }
    if (sp.bits !== tp.bits) issues.push({ linkId: l.id, msg: t('位宽不匹配：{from} → {to}', { from: sp.bits, to: tp.bits }) });
    const key = `${tgt.id}:${tgt.port}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key)!.push(l.id);
  }
  for (const ids of byTarget.values()) {
    if (ids.length > 1) {
      for (const id of ids) issues.push({ linkId: id, msg: t('多驱动冲突：同一输入被 {count} 条线同时驱动', { count: ids.length }) });
    }
  }
  const bad = new Set(issues.map(i => i.linkId));
  for (const l of links) {
    const v = l.findView(paper);
    if (v?.el?.classList) v.el.classList[bad.has(l.id) ? 'add' : 'remove']('sm-illegal');
  }
  return issues;
}

import { CN_NAME } from './sandboxCatalog';
import { t } from '../i18n';   // i18n：DRC 话术运行时翻译；器件名动态键在 SHARED_VOCAB

/**
 * 连线落点即时校验（拖线松手时）：与 runCanvasDrc 同一套规则的**单条**判定，
 * 返回错误消息（null=合法）。ignoreId 供重建自身连线时豁免旧端点。
 * 逐字对齐 SandboxCanvas 原实现（含 CN_NAME 中文提示与占用/重复线检测）——
 * 抽出即分叉是「两套算法」类事故的头号来源，这里以原文为唯一基准。
 */
export function validateConnectionEnds(paper: any, srcId: string, srcPort: string, tgtId: string, tgtPort: string, ignoreId?: string): string | null {
  if (!srcId || !tgtId || !srcPort || !tgtPort) return t('连线不完整：两端都必须落在端口上');
  if (srcId === tgtId) return t('不能把部件连到它自己');
  const sc = paper.model.getCell(srcId);
  const tc = paper.model.getCell(tgtId);
  if (!sc || !tc) return t('部件不存在');
  const sp = typeof sc.getPort === 'function' ? sc.getPort(srcPort) : null;
  const tp = typeof tc.getPort === 'function' ? tc.getPort(tgtPort) : null;
  if (!sp || !tp) return t('端口不存在');
  if (sp.dir !== 'out') return t('起点必须是输出端口（{what}.{port} 是{dir}）', { what: CN_NAME[sc.get('type')] ? t(CN_NAME[sc.get('type')]) : sc.get('type'), port: srcPort, dir: sp.dir === 'in' ? t('输入') : sp.dir });
  if (tp.dir !== 'in') return t('终点必须是输入端口（{what}.{port} 是{dir}）', { what: CN_NAME[tc.get('type')] ? t(CN_NAME[tc.get('type')]) : tc.get('type'), port: tgtPort, dir: tp.dir === 'out' ? t('输出') : tp.dir });
  if (sp.bits !== tp.bits) return t('位宽不匹配（{a} 位 vs {b} 位）', { a: sp.bits, b: tp.bits });
  const occupied = paper.model.getLinks().find((l: any) =>
    l.id !== ignoreId && l.get('target')?.id === tgtId && l.get('target')?.port === tgtPort);
  if (occupied) return t('输入 {what}.{port} 已被占用：一个输入只能有一个驱动源', { what: CN_NAME[tc.get('type')] ? t(CN_NAME[tc.get('type')]) : tc.get('type'), port: tgtPort });
  const dup = paper.model.getLinks().find((l: any) =>
    l.id !== ignoreId && l.get('source')?.id === srcId && l.get('source')?.port === srcPort &&
    l.get('target')?.id === tgtId && l.get('target')?.port === tgtPort);
  if (dup) return t('这两个端口之间已经有连线了');
  return null;
}
