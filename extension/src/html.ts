/**
 * Webview HTML 改写（**纯函数，⛔ import 'vscode'**）：
 * 这样"资产路径改写 + CSP 组装"这两件最容易出错的事能在无头环境里被判据钉住
 * （`tests/unit/vscodeShell.test.ts` 钉形状，`tests/r137-webview-csp-gate.cjs` 拿真浏览器判
 * "这份 CSP 下这张画布到底跑不跑得起来"），不必开一个 Extension Development Host 才知道对不对。
 *
 * 形状来自微软官方 sample `webview-sample`（`asWebviewUri` + `cspSource` + nonce 三件套），
 * 差别只有一处：官方自己手写 HTML，我们加载的是 Vite 产出的 `dist/index.html`，
 * 所以要**改写**它而不是重写它——⛔ 把 dist 里的引用清单抄进本文件（构建产物一改就漂）。
 */

export interface HtmlRewriteInput {
  /** Vite 产出的 index.html 原文 */
  rawHtml: string;
  /** 把 dist 内的相对路径（`assets/index-xxx.js`）换成宿主能读的 URI 字符串 */
  assetUri: (relPathFromDist: string) => string;
  /** `webview.cspSource` 的值（scheme+authority+port） */
  cspSource: string;
  /** 每次装载新生成的 nonce（只有带它的 <script> 能跑） */
  nonce: string;
}

/**
 * CSP：三条是这张画布跑起来的必需，少一项就是"打开白屏"且浏览器外看不到原因。
 *  · `script-src` 里 nonce 与 `cspSource` **并存**。nonce 只写在 HTML 里的那几颗标签上，
 *    而宿主中立层（`src/lib/host/host.ts`）是按宿主**动态 `import()`** 挑 vscodeHost/browserHost 的。
 *    ⚠ R137 实测（`tests/r137-webview-csp-gate.cjs` 变异臂）：本机 Chromium **把调用方 script 的 nonce
 *    传给了 `import()`**，所以摘掉 `cspSource` 后那条路仍放行 ⇒ 这颗⛔ 是"已测缺陷的修法"，
 *    而是**对"nonce 到底传不传递"这件事不做赌注**（那条传递行为规范里没写死，换内核就可能变）。
 *    放行面收在 `cspSource` 这一颗 origin = `localResourceRoots` 里我们自己的 dist。
 *  · `script-src 'wasm-unsafe-eval'` ⇒ yosys-wasm 要实例化 .wasm（实测 16.4 MB 那颗编译通过）；
 *  · `style-src` 要**同时**收 `cspSource`、`'unsafe-inline'` 和 cdnjs：
 *    前两条是 joint/digitaljs 运行时注 `<style>` ＋ React inline style，
 *    第三条是 `index.html` 里 Prism 主题那张 CDN 样式表——R137 第一版漏了它，
 *    实测当场报 `…prism-tomorrow.min.css|style-src-elem`（＝代码编辑器没了配色，且只在壳里发生）。
 *  · `worker-src`/`connect-src` 收 cspSource + `blob:` ⇒ emscripten 胶水按 `base` 解析后
 *    fetch wasm、并可能起 blob worker。
 * ⛔ 为了省事把 `script-src` 写成 `'unsafe-inline'`（那等于把 CSP 关掉）。
 * `https://cdnjs.cloudflare.com` 是给 index.html 里那两颗 Prism 引用留的口——
 * ⛔ 长期方案是把 Prism 落到 public/（离线打开才不会丢语法高亮），已记进迁移台账。
 */
export function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: https:`,
    `font-src ${cspSource} data:`,
    // Prism 的**样式表**也走 style-src：漏了它，`<link rel=stylesheet href=cdnjs…>` 被拒，
    // 代码编辑器只剩默认字色（R137 实测：violation `…prism-tomorrow.min.css|style-src-elem`）。
    `style-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${cspSource} https://cdnjs.cloudflare.com`,
    `worker-src ${cspSource} blob:`,
    `child-src blob:`,
    `connect-src ${cspSource} data: blob: https://cdnjs.cloudflare.com`,
  ].join('; ');
}

/** 只改**同源绝对路径**（`/assets/…`、`/digitaljs.js`、`/yosys/…`）；`https:` 与 `data:` 原样放过 */
const LOCAL_REF = /(src|href)="(?!https?:|data:|blob:)([^"]+)"/g;

export function rewriteWebviewHtml(input: HtmlRewriteInput): string {
  const { rawHtml, assetUri, cspSource, nonce } = input;
  const base = assetUri('');                       // dist 目录本身的 URI（给 <base>，见下）
  let html = rawHtml.replace(LOCAL_REF, (_m, attr: string, rest: string) => {
    const rel = rest.replace(/^\/+/, '').replace(/^\.\/+/, '');
    if (!rel) return `${attr}="${rest}"`;
    // 已经指向外部/构建产物的 query 保留（`assets/x.js?v=1`）
    const [pathPart, query] = rel.split('?');
    const uri = assetUri(pathPart);
    return `${attr}="${uri}${query ? '?' + query : ''}"`;
  });

  const csp = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, nonce)}">`;
  // <base> 是关键：emscripten/joint 在运行时拼的是相对路径（wasm、图片、字体），
  // 而 webview 的文档基址不是 dist 目录——没有它，`yosys.wasm` 这类按需加载会 404 且只在壳里复现。
  const baseTag = `<base href="${base.endsWith('/') ? base : base + '/'}">`;
  const head = '<head>';
  if (html.includes(head)) {
    html = html.replace(head, `${head}\n${csp}\n${baseTag}`);
  } else {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${csp}\n${baseTag}`);
  }
  // 官方 sample 用 nonce 白名单放行脚本：构建产物里那颗 module script 要挂上它，
  // ⛔ 为了省事改用 script-src 'unsafe-inline'（那等于把 CSP 关掉）。
  // 一条正则覆盖"有无 src 都一样"，⛔ 分两条写（第一版那么写时 nonce 落在 src 前还是后
  // 取决于哪条先命中，判据就得跟着猜顺序）。
  html = html.replace(/<script\b([^>]*)>/gi, (_m, attrs: string) =>
    (/\bnonce=/i.test(attrs) ? _m : `<script${attrs} nonce="${nonce}">`));
  return html;
}
