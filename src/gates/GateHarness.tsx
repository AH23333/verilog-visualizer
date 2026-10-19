/* i18n-exempt-file: 夹具面（闸门测试专用外壳，r30/r17 选择器钉在中文 label 上，⛔ 进产品翻译表） */
// 闸门外壳：一颗只做「面板/模式切换」的极简活动栏 + 沙盒模式 SandboxCanvas。
//
// 锚点契约（tests/_ui.cjs 认这些，别改）：
//   · `button[data-activity="files" | "modules" | "hierarchy"]` 切左栏面板（→ SandboxCanvas.leftPanel）；
//   · `button[data-activity="sandbox"]` 进沙盒——外壳本就在沙盒，点了只保证面板可见（无副作用）；
//   · `button[data-activity="主题"]` 切明暗（闸门偶有主题用例，兜底保留）。
// SandboxCanvas 自带 data-sandbox-sidebar / data-gate 部件库 / [data-fs-dialog] 新建 /
// __sandboxPaper / 文件树（SandboxFileTree data-sbfile）/ 部件绑定工具条 —— 夹具其余锚点都在它里面。
import { useState } from 'react';
import { t } from '../i18n';   // i18n：中文原文即键（I18N_DESIGN §二）
import SandboxCanvas from '../components/SandboxCanvas';
import { useVscodeTheme } from '../hooks/useVscodeTheme';

type Panel = 'files' | 'modules' | 'hierarchy';

const barStyle: React.CSSProperties = {
  width: 48, flex: '0 0 48px', height: '100%', display: 'flex', flexDirection: 'column',
  alignItems: 'center', gap: 4, padding: '8px 0', background: 'var(--sidebar-bg)',
  borderRight: '1px solid var(--border-color, #333)',
};
const btnStyle: React.CSSProperties = {
  width: 36, height: 32, fontSize: 11, color: 'var(--text-secondary)', background: 'transparent',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};

export default function GateHarness() {
  const theme = useVscodeTheme();
  const [panel, setPanel] = useState<Panel>('files');
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div data-gate-activitybar style={barStyle}>
        <button data-activity="files" style={btnStyle} onClick={() => setPanel('files')}>文件</button>
        <button data-activity="modules" style={btnStyle} onClick={() => setPanel('modules')}>部件</button>
        <button data-activity="hierarchy" style={btnStyle} onClick={() => setPanel('hierarchy')}>层次</button>
        <button data-activity="sandbox" style={btnStyle} onClick={() => { /* 外壳恒在沙盒 */ }}>沙盒</button>
        <button data-activity="主题" style={btnStyle}
          title={t('主题')} onClick={() => document.body.classList.toggle('vscode-dark')}>{t('主题')}</button>
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <SandboxCanvas theme={theme} leftPanel={panel} />
      </div>
    </div>
  );
}
