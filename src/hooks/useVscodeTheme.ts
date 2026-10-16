// 主题跟随 VS Code 壳：body 的 vscode-dark / vscode-light class 是唯一真源
// （themeStore 已随旧 UI 退役）。index.css 的令牌吃 documentElement[data-theme]，
// 这里负责把两者对上，并用 MutationObserver 跟随宿主切换。
import { useEffect, useState } from 'react';

export type VscodeTheme = 'dark' | 'light';

export function useVscodeTheme(): VscodeTheme {
  const read = (): VscodeTheme => {
    try { return document.body.classList.contains('vscode-dark') ? 'dark' : 'light'; }
    catch { return 'dark'; }
  };
  const [theme, setTheme] = useState<VscodeTheme>(read);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const ob = new MutationObserver(() => {
      const t = read();
      document.documentElement.setAttribute('data-theme', t);
      setTheme(t);
    });
    ob.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => ob.disconnect();
  }, [theme]);
  return theme;
}
