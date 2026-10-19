import { ChevronRight, PanelLeftClose, Plus, Undo2, FileText, FolderPlus, RefreshCw } from 'lucide-react';
import { sandboxStore, type SandboxFile, type CustomGate } from '../store/sandboxStore';
import { t } from '../i18n';   // i18n：目录数据显示点（数据表在 sandboxCatalog，先于 initLocale 加载 ⛔ 表内 t）
import {
  SANDBOX_PANEL_TITLE, V_SB_NAME, PALETTE, CN_NAME, bitsSuffix, type PaletteItem,
} from '../lib/sandboxCatalog';
import { type DrcIssue } from '../lib/sandboxDrc';
import SandboxFileTree, { type RenameTarget, type CreateTarget } from './SandboxFileTree';

type HierarchyTree = { links: number; groups: { type: string; label: string; list: any[] }[] };

interface Props {
  sidebarCollapsed: boolean;
  onToggleSidebar?: () => void;
  panel: string;
  sidebarW: number;
  onSidebarWDragStart: (e: React.MouseEvent) => void;
  docMode: boolean;
  onExitSandbox?: () => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  askFs: (o: { title: string; label?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; validate?: (v: string) => string | null }) => Promise<string | null>;
  handleNew: (name?: string) => void;
  handleCreateCommit: (t: CreateTarget, name: string) => void;
  refreshFolders: () => void;
  syncAfterFsOp: () => void;
  showToast: (msg: string) => void;
  handlePanelCtx: (e: React.MouseEvent) => void;
  files: SandboxFile[];
  folders: string[];
  activeFile: SandboxFile | null;
  fileSelIds: Set<string>;
  handleFileOpen: (f: SandboxFile) => void;
  handleFileSelectToggle: (id: string) => void;
  handleFileCtx: (e: React.MouseEvent, f: SandboxFile) => void;
  handleFolderCtx: (e: React.MouseEvent, path: string) => void;
  handleRootCtx: (e: React.MouseEvent) => void;
  handleMoveFiles: (ids: string[], folder: string) => void;
  setActiveFile: React.Dispatch<React.SetStateAction<SandboxFile | null>>;
  handleFileRenameCommit: (t: RenameTarget, name: string) => void;
  handleFolderRenameCommit: (t: RenameTarget, name: string) => void;
  handleImportDjsFiles: (list: FileList | null) => void | Promise<void>;
  hierarchyTree: HierarchyTree;
  forceUpdate: React.Dispatch<React.SetStateAction<number>>;
  expandedSubs: Set<string>;
  setExpandedSubs: React.Dispatch<React.SetStateAction<Set<string>>>;
  focusCell: (cellId: string) => void;
  setInnerCell: (cell: any) => void;
  openGroups: Set<string>;
  toggleGroup: (name: string) => void;
  doAddCell: (item: PaletteItem | string) => void;
  gates: CustomGate[];
  placeCustomGate: (gate: CustomGate) => void;
  handleDeleteGate: (g: CustomGate) => void;
  deleteGateId: string | null;
  drc: DrcIssue[];
  setSelectionRef: React.RefObject<(ids: string[]) => void>;
}

function SandboxSidebar({
  sidebarCollapsed, onToggleSidebar, panel, sidebarW, onSidebarWDragStart, docMode, onExitSandbox,
  importInputRef, askFs, handleNew, handleCreateCommit, refreshFolders, syncAfterFsOp, showToast,
  handlePanelCtx, files, folders, activeFile, fileSelIds, handleFileOpen, handleFileSelectToggle,
  handleFileCtx, handleFolderCtx, handleRootCtx, handleMoveFiles, setActiveFile,
  handleFileRenameCommit, handleFolderRenameCommit, handleImportDjsFiles, hierarchyTree,
  forceUpdate, expandedSubs, setExpandedSubs, focusCell, setInnerCell, openGroups, toggleGroup,
  doAddCell, gates, placeCustomGate, handleDeleteGate, deleteGateId, drc, setSelectionRef,
}: Props) {
  return (
    <>
      {sidebarCollapsed ? (
        <div style={{
          width: 36, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0,
          background: 'var(--sidebar-bg)', paddingTop: 8,
        }}>
          <button onClick={onToggleSidebar} title={t('展开{what}', { what: t(SANDBOX_PANEL_TITLE[panel as keyof typeof SANDBOX_PANEL_TITLE] || '侧栏') })}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 4, lineHeight: 1, display: 'inline-flex' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      ) : (
      <div data-sandbox-sidebar style={{
        width: sidebarW, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        // zIndex:2 —— 把整个侧栏（含右缘 3px 拖拽手柄）抬到画布 wrapper 之上，
        // 否则外露的手柄条被后渲染的绝对定位画布盖住，拖不动；侧栏内部
        // 局部层级仍由内容容器 zIndex:1 > 手柄 决定，按钮点击不受影响。
        background: 'var(--sidebar-bg)', position: 'relative', zIndex: 2,
      }}>
        {/* 右缘拖拽手柄（问题 1）：悬停变色，拖动调宽 180–500px。
            下方两个内容容器带 position:relative + zIndex:1 —— 盖在手柄之上，
            按钮点击不被拦截；手柄只在未被内容盖住的右缘空隙接收事件。 */}
        <div
          onMouseDown={onSidebarWDragStart}
          title={t('拖动调整宽度')}
          style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%',
            cursor: 'col-resize' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        />
        {/* 面板标题栏：与编译模式 Sidebar 头部同一套（padding/边框/字重/字距/图标） */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t(SANDBOX_PANEL_TITLE[panel as keyof typeof SANDBOX_PANEL_TITLE] || '文件')}
          </span>
          {/* 文档模式：文件管理按钮组（导入/新建/文件夹/刷新/退出）整体摘除 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {!docMode && (<>
            {onExitSandbox && (
              <button onClick={onExitSandbox} data-sandbox-exit title={t('退出沙盒，返回电路 / 代码视图')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
                <Undo2 size={14} />
              </button>
            )}
            {/* R101：标题栏按钮组**照抄编译模式 Sidebar**——导入文件 / 新建文件 /
                新建文件夹 / 刷新 / 收起侧栏（同一套 padding、hover 与 lucide 图标）。
                // i18n-exempt: JSX 注释内引用测试夹具锚点原词，非上屏文案
                ⚠ `button[title="新建文件"]` 是 `tests/_ui.cjs#newSandboxFile` 的夹具锚点：
                它点完就期望文件已建好，所以这颗**不走弹窗**（弹窗版在右键菜单里）。 */}
            <button onClick={() => importInputRef.current?.click()} title={t('导入文件')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <Plus size={14} />
            </button>
            {/* R102：新建文件改为**弹窗命名**（与编译模式一致）——早前是点了直接自动命名，
                用户点的是"新建"却没机会起名。⚠ 测试夹具 `_ui.cjs#newSandboxFile` 已同步
                改成"点按钮 → 填弹窗 → 确认"，两边必须一起改。 */}
            <button onClick={async () => {
              const v = await askFs({ title: t('新建文件'), label: t('文件名'), defaultValue: 'new_circuit', confirmLabel: t('创建'), validate: V_SB_NAME });
              if (v) handleNew(v);
            }} title={t('新建文件')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <FileText size={14} />
            </button>
            <button onClick={async () => {
              const v = await askFs({ title: t('新建文件夹'), label: t('文件夹名称'), defaultValue: 'my_folder', confirmLabel: t('创建'), validate: V_SB_NAME });
              if (v) handleCreateCommit({ kind: 'folder', folder: '' }, v);
            }} title={t('新建文件夹')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <FolderPlus size={14} />
            </button>
            <button onClick={() => { refreshFolders(); syncAfterFsOp(); showToast(t('已刷新文件列表')); }} title={t('刷新')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <RefreshCw size={13} />
            </button>
            <button onClick={onToggleSidebar} title={t('收起侧栏')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '2px 4px', lineHeight: 1, display: 'inline-flex', borderRadius: 4 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
              <PanelLeftClose size={14} />
            </button>
            </>)}
          </div>
        </div>

        {/* 整个文件面板都响应「右键空白」：标题栏/滚动留白/树容器外的任意位置
            都能新建 / 导入 / 粘贴（行元素会 stopPropagation，优先弹自己的菜单）。
            仅文件面板挂载；部件 / 层次结构面板不弹文件菜单。 */}
        <div
          onContextMenu={handlePanelCtx}
          style={{ overflowY: 'auto', flex: 1, position: 'relative', zIndex: 1 }}>
          {panel === 'files' && (
            <>
              <SandboxFileTree
                files={files}
                folders={folders}
                activeId={activeFile?.id ?? null}
                selectedIds={fileSelIds}
                onOpen={handleFileOpen}
                onSelectToggle={(id) => handleFileSelectToggle(id)}
                onFileContextMenu={handleFileCtx}
                onFolderContextMenu={handleFolderCtx}
                onRootContextMenu={handleRootCtx}
                onMoveFiles={handleMoveFiles}
                onMoveFolder={(path, newPath) => {
                  sandboxStore.moveFolder(path, newPath);
                  if (activeFile?.id) setActiveFile(sandboxStore.get(activeFile.id));
                  syncAfterFsOp();
                  showToast(t('已移动文件夹 {from} → {to}', { from: path, to: newPath }));
                }}
                onRenameCommit={(tgt, name) => tgt.kind === 'file'
                  ? handleFileRenameCommit(tgt, name)
                  : handleFolderRenameCommit(tgt, name)}   // F3 清扫：参数名 t⛔ 遮蔽 i18n t（本文件现在满屏 t()，遮蔽由无害转有害）
              />
              <input ref={importInputRef} type="file" accept=".djs,.json" multiple
                style={{ display: 'none' }}
                onChange={(e) => { handleImportDjsFiles(e.target.files); e.target.value = ''; }} />
            </>
          )}

          {panel === 'hierarchy' && (
            <div style={{ padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  {t('当前电路（{cells} 器件 / {links} 连线）', { cells: hierarchyTree.groups.reduce((n, g) => n + g.list.length, 0), links: hierarchyTree.links })}
                </span>
                <button onClick={() => forceUpdate(n => n + 1)} title={t('刷新层次结构')}
                  style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 3,
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--fs-xs)', padding: '0 4px' }}>⟳</button>
              </div>
              {hierarchyTree.groups.length === 0 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('画布为空')}</div>
              )}
              {hierarchyTree.groups.map(grp => (
                <div key={grp.type} style={{ marginBottom: 5 }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>
                    {t(grp.label)} <span style={{ opacity: .7 }}>×{grp.list.length}</span>
                  </div>
                  {grp.list.map((c: any) => {
                    const isSub = c.get('type') === 'Subcircuit';
                    const open = expandedSubs.has(String(c.id));
                    const inner = isSub && open ? (c.get('graph')?.getCells?.() || []).filter((x: any) => !(typeof x.isLink === 'function' && x.isLink())) : [];
                    return (
                      <div key={c.id}>
                        <div onClick={() => focusCell(String(c.id))}
                          title={t('定位「{name}」', { name: c.get('label') || c.get('celltype') || t(grp.label) })}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 3,
                            cursor: 'pointer', fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>
                          {isSub ? (
                            <span onClick={(e) => { e.stopPropagation(); setExpandedSubs(prev => {
                              const n = new Set(prev);
                              n.has(String(c.id)) ? n.delete(String(c.id)) : n.add(String(c.id));
                              return n;
                            }); }} style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
                          ) : <span style={{ width: 8 }} />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.get('label') || c.get('celltype') || t(grp.label)}
                          </span>
                          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.5625rem' }}>
                            {bitsSuffix(c)}
                          </span>
                        </div>
                        {isSub && open && (
                          <div style={{ marginLeft: 14, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
                            {inner.length === 0 && (
                              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('（空）')}</div>
                            )}
                            {inner.map((x: any) => (
                              <div key={x.id} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {CN_NAME[x.get('type')] ? t(CN_NAME[x.get('type')]) : x.get('type')}
                              </div>
                            ))}
                            <div onClick={() => setInnerCell(c)} title={t('查看内部电路')}
                              style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', cursor: 'pointer' }}>
                              {t('查看内部电路…')}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {panel === 'modules' && (<div style={{ padding: 8 }}>
          {PALETTE.map(group => {
            const open = openGroups.has(group.group);
            return (
            <div key={group.group} style={{ marginBottom: 4 }}>
              <div
                onClick={() => toggleGroup(group.group)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)', color: open ? 'var(--text)' : 'var(--text-muted)',
                  marginBottom: open ? 4 : 2, fontWeight: 600, cursor: 'pointer',
                  padding: '2px 4px', borderRadius: 3, background: open ? 'var(--surface-hover)' : 'transparent' }}
                title={open ? t('收起分组') : t('展开分组')}
              >
                <span>{t(group.group)}</span>
                <span style={{ fontSize: '0.625rem', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
              </div>
              {open && group.items.map(it => (
                <button key={it.label || it.type} onClick={() => doAddCell(it)} data-gate={it.type}
                  title={t('放置{what}（{type}）', { what: it.label ? t(it.label) : (CN_NAME[it.type] ? t(CN_NAME[it.type]) : it.type), type: it.type })}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                    gap: 4, padding: '3px 6px', marginBottom: 1, fontSize: 'var(--fs-xs)', background: 'transparent',
                    border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                  <span>{it.label ? t(it.label) : (CN_NAME[it.type] ? t(CN_NAME[it.type]) : it.type)}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>{it.type}</span>
                </button>
              ))}
            </div>
            );
          })}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>{t('部件（可编辑电路）')}</div>
          {gates.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 1, fontSize: 'var(--fs-xs)' }}>
              <button onClick={() => placeCustomGate(g)} title={t('放置部件“{name}”（点击也可在文件面板打开编辑）', { name: g.name })}
                style={{ flex: 1, textAlign: 'left', padding: '3px 6px', background: 'transparent',
                  border: '1px solid var(--border-subtle)', borderRadius: 3, cursor: 'pointer', color: 'var(--text)' }}>
                {g.name}
                {g.folder ? <span style={{ color: 'var(--text-muted)', marginLeft: 4, fontSize: '0.5625rem' }}>{g.folder}/</span> : null}
              </button>
              <span onClick={(e) => { e.stopPropagation(); handleDeleteGate(g); }} title={t('删除部件')}
                style={{ cursor: 'pointer', marginLeft: 4,
                  color: deleteGateId === g.id ? 'var(--error, #ef4444)' : 'var(--text-muted)',
                  fontWeight: deleteGateId === g.id ? 700 : 400 }}>
                {deleteGateId === g.id ? '?' : '×'}
              </span>
            </div>
          ))}
          {gates.length === 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('把当前电路保存为部件后可复用；「复制到沙盒」的子部件也在此列出，均可打开编辑')}</div>
          )}
          </div>)}

          {/* DRC 与操作提示属于「电路」信息，归到层次结构面板 */}
          {panel === 'hierarchy' && (<div style={{ padding: 8 }}>
          {drc.length > 0 && (
            <div style={{ marginTop: 8, border: '1px solid var(--danger)', borderRadius: 4, padding: 6 }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', fontWeight: 700, marginBottom: 3 }}>
                {t('⚠ {count} 处非法连接', { count: drc.length })}
              </div>
              {drc.slice(0, 4).map((iss, i) => (
                <div key={i} onClick={() => { setSelectionRef.current?.([iss.linkId]); focusCell(iss.linkId); }}
                  title={t('点击定位该连线')}
                  style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', cursor: 'pointer',
                    lineHeight: 1.35, marginBottom: 2 }}>
                  · {iss.msg}
                </div>
              ))}
              {drc.length > 4 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>…还有 {drc.length - 4} 处</div>
              )}
            </div>
          )}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '8px 0 4px', fontWeight: 600 }}>{t('操作提示')}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            · 拖端口连线：靠近端口自动吸附，不必精准对准<br/>
            · 位宽不同的两端相连会自动插入转换器<br/>
            · 分线器 / 合线器放下即选位宽方案（1/2/4/8 位互转）<br/>
            · 空白拖拽 = 框选<br/>
            · 右键部件 = 菜单（含位宽 / 旋转）<br/>
            · Shift/Ctrl 点击 = 多选<br/>
            · 双击自定义门 = 查看内部<br/>
            · Ctrl+Z/Y 撤销重做，Ctrl+R 旋转<br/>
            · 方向键微移，Ctrl+0 复位视图
          </div>
          </div>)}
        </div>

      </div>
      )}
    </>
  );
}

export default SandboxSidebar;
