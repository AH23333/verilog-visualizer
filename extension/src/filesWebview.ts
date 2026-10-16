// 「文件」视图（codeFiles / sandboxFiles 原位 webview 化，R148）——
// 用户裁决史：原生 TreeView 空白区右键平台⛔ 自定义（官方答复在册）；加虚拟节点被否；
// 在旁边另起"右键可用"新区域被否——**预期＝原来那颗「文件」视图的空白处右键就能用**。
// 平台内唯一通路＝WebviewView + webview/context：空白＝根菜单（新建/导入/刷新/绑定配置），
// 文件夹行＝目录菜单（在此新建/副本/删除/导入…），文件行＝项菜单（打开/编译/改名/副本/删除/绑定/核查/写全/配置）。
// 列表＝目录分组折叠（点击箭头展开收拢）+ 文件行；点开走既有命令族（executeCommand 转接，⛔ 第二份业务逻辑）。
// 重构前项目本来就是 webview 自绘树——此形态＝功能对等回归，⛔ 新范式。
import * as vscode from 'vscode';
import { projectRoot } from './dispatch';
import { getCircuitsSet } from './sandboxFiles';

type Kind = 'code' | 'sandbox';

interface FileEntry { name: string; rel: string; size: number; role?: 'part' | 'circuit' }

export class VvFilesWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  constructor(private readonly kind: Kind, private readonly _ctx: vscode.ExtensionContext, private readonly _onOpen?: (rel: string, isDir: boolean) => void) { }

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(async (msg: any) => {
      if (!msg || msg.vvh !== 'files') return;
      if (msg.op === 'open') {
        // 左键断流⛔ 静默（真机教训：可选链吞掉未接线＝"点了没反应"无从查起）——接线缺失就大声报错
        const rel = String(msg.path || '');
        if (!rel) return;
        if (!this._onOpen) { void vscode.window.showErrorMessage('文件视图左键路由未接线（扩展缺陷，请把这条转给维护者）'); return; }
        this._onOpen(rel, !!msg.isDir); return;
      }
      if (msg.op === 'command') {
        const path = typeof msg.path === 'string' && msg.path ? msg.path : undefined;
        const args = path ? [vscode.Uri.joinPath(projectRoot(this._ctx), ...path.split('/'))] : [];
        void vscode.commands.executeCommand(String(msg.command), ...args);
        return;
      }
      if (msg.op === 'refresh') { await this.render(); return; }
    });
    void this.render();
  }

  async render(): Promise<void> {
    const view = this._view;
    if (!view) return;
    const root = projectRoot(this._ctx);
    const rootPath = root.path.replace(/\/+$/, '');
    const rootL = rootPath.toLowerCase();
    const relOf = (u: vscode.Uri) => (u.path.toLowerCase().startsWith(`${rootL}/`) ? u.path.slice(rootPath.length + 1) : u.path.replace(/^\/[a-zA-Z]:\//, '').replace(/^\/+/, ''));
    const [uris, circuits] = await Promise.all([
      vscode.workspace.findFiles(this.kind === 'code' ? '**/*.{v,sv}' : '**/*.djs', '**/node_modules/**'),
      this.kind === 'code' ? Promise.resolve(new Set<string>()) : getCircuitsSet(this._ctx),
    ]);
    const files: FileEntry[] = [];
    for (const u of uris) {
      let size = -1;
      try { size = (await vscode.workspace.fs.stat(u)).size; } catch { /* 竞态删除＝跳过无妨 */ }
      const rel = relOf(u);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      files.push({ name: rel.slice(dir ? dir.length + 1 : 0), rel, size, role: circuits.has(rel) ? 'circuit' : undefined });
    }
    // 目录树分组：root 组 + 每个含文件的目录（直属判定＝dirname 恰为该目录）
    const dirs = new Set<string>();
    files.forEach((f) => { const segs = f.rel.split('/').filter(Boolean); let cur = ''; segs.slice(0, -1).forEach((s) => { cur = cur ? `${cur}/${s}` : s; dirs.add(cur); }); });
    const dirnameOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
    const groups: Array<{ dir: string; files: FileEntry[] }> = [{ dir: '', files: files.filter((f) => dirnameOf(f.rel) === '') }];
    [...dirs].sort().forEach((d) => groups.push({ dir: d, files: files.filter((f) => dirnameOf(f.rel) === d) }));
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\\/g, '&#92;');
    const kb = (n: number) => (n < 0 ? '' : n > 20480 ? `${Math.round(n / 1024)} KB` : `${(n / 1024).toFixed(1)} KB`);
    let html = '';
    for ( const g of groups) {
      const depth = g.dir ? g.dir.split('/').length : 0;
      if (g.dir) {
        // 单一箭头 ▾（折叠时 JS 旋 -90°）；缩进＝层级深×14px——目录结构一眼可辨
        html += `<div class="row dir" style="padding-left:${(depth - 1) * 14 + 4}px" data-vvd="${esc(g.dir)}" data-vscode-context='{"widgetId":"vv-files","vvKind":"dir","vvPath":"${esc(g.dir)}"}' tabindex="0" title="${esc(g.dir)}"><span class="tw">▾</span>${esc(g.dir.split('/').pop()!)}/</div>`;
      }
      for (const f of g.files) {
        const anc = f.rel.split('/').slice(0, -1).join('|');  // 折叠祖先前缀（data-under）
        const fdepth = g.dir ? g.dir.split('/').length : 0;
        html += `<div class="row file" style="padding-left:${fdepth * 14 + 18}px"${g.dir ? ` data-under="${esc(anc)}"` : ''} data-vscode-context='{"widgetId":"vv-files","vvKind":"file","vvPath":"${esc(f.rel)}"}' tabindex="0" title="${esc(f.rel)}"><span class="nm">${esc(f.name)}</span><span class="met">${kb(f.size)}${(this.kind === 'sandbox' && f.role === 'circuit') ? ' · 圈' : ''}</span></div>`;
      }
    }
    const hint = this.kind === 'code' ? 'Verilog 文件（.v/.sv）' : '电路文档（.djs）';
    const nonce = [...Array(24)].map(() => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[(Math.random() * 62) | 0]).join('');
    view.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy"
content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"></head>
<style>
  body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);margin:0;padding:1px 0;user-select:none;overflow-x:hidden}
  #empty{padding:10px;color:var(--vscode-descriptionForeground);line-height:1.5}
  .row{display:flex;align-items:center;gap:6px;padding:1px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;outline:none}
  .row:hover{background:var(--vscode-list-hoverBackground)}
  .row.sel{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
  .row.dir{font-weight:600}
  .nm{flex:1;overflow:hidden;text-overflow:ellipsis}
  .met{color:var(--vscode-descriptionForeground);font-size:0.92em}
  .tw{width:1.1em;display:inline-block;color:var(--vscode-descriptionForeground)}
  .row.fold .tw{transform:rotate(-90deg)}
</style>
<body>
  <div id="empty" style="display:${html ? 'none' : 'block'}">还没有${hint}。<br><b>在空白处右键</b>：新建文件 / 新建文件夹 / 导入 / 刷新。</div>
  ${html}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  // ⚠ 这截活在浏览器：⛔ 任何 TS 语法（as 断言/泛型）——tsc 查不到字符串内部，一个 as 就炸没全部点击。
  //   也⛔ 在本模板串里写反引号：它会把外层模板从中间撕断（esbuild 照断、vm 照绿＝双重假绿，R150 血案）。
  // 折叠态记忆（getState/setState 走 webview 持久通道）
  const st = vscode.getState() || {};
  document.querySelectorAll('.row.dir').forEach((el) => { const d = el.getAttribute('data-vvd'); el.classList.toggle('fold', !!(st.fold && st.fold[d])); });
  const ancestorsOf = (el) => {
    const own = el.getAttribute('data-under');
    if (own !== null) return own ? own.split('|').filter(Boolean) : [];
    const d = el.getAttribute('data-vvd') || '';
    const segs = d.split('/').filter(Boolean);
    const acc = []; let cur = '';
    for (let i = 0; i < segs.length - 1; i++) { cur = cur ? cur + '/' + segs[i] : segs[i]; acc.push(cur); }
    return acc;
  };
  const applyFold = () => {
    const folded = st.fold || {};
    document.querySelectorAll('.row.file, .row.dir').forEach((el) => {
      const hidden = ancestorsOf(el).some((c) => folded[c]);
      el.style.display = hidden ? 'none' : 'flex';
    });
  };
  applyFold();
  document.querySelectorAll('.row.dir').forEach((el) => el.addEventListener('click', () => {
    const d = el.getAttribute('data-vvd');
    st.fold = st.fold || {};
    st.fold[d] = !st.fold[d];
    el.classList.toggle('fold', !!st.fold[d]);
    vscode.setState(st);
    applyFold();
  }));
  document.querySelectorAll('.row.file').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.row.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      const ctx = JSON.parse(el.getAttribute('data-vscode-context') || '{}');
      if (ctx.vvPath) vscode.postMessage({ vvh: 'files', op: 'open', path: ctx.vvPath });
    });
  });
</script>
</body></html>`;
  }
}
