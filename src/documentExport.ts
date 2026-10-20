import { api } from './bridge';
import { applyAttachmentSize } from './attachmentLayout';
import { renderMarkdown } from './markdownRender';

// Export the reading renderer and its actual theme/typography, rather than a
// second stylesheet which drifts from the application. Only pagination differs.
async function stylesheet(rules: CSSRuleList, base: string, math: boolean): Promise<string> {
  return (await Promise.all(Array.from(rules, async rule => {
    if (rule instanceof CSSImportRule && rule.styleSheet) return stylesheet(rule.styleSheet.cssRules, rule.href, math);
    // The application's window.print rules deliberately force a light palette.
    // Export keeps the chosen palette and uses its own paginated layout below.
    if (rule instanceof CSSMediaRule && /\bprint\b/.test(rule.conditionText)) return '';
    if (!(rule instanceof CSSFontFaceRule)) return rule.cssText;
    if (!math || !rule.style.getPropertyValue('font-family').includes('KaTeX_')) return '';
    const face = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/);
    if (!face) return '';
    const response = await fetch(new URL(face[1], base));
    if (!response.ok) throw Error('无法加载公式字体。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return rule.cssText.replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2");`);
  }))).join('\n');
}

const layout = `
@page {size:A4;margin:14mm;background:var(--bg);}
html,body.app {display:block;width:auto;height:auto;min-height:0;margin:0;overflow:visible;background:var(--bg);color:var(--text);print-color-adjust:exact;-webkit-print-color-adjust:exact;}
body.app {padding:0;}
.app .reading-view {width:100%;max-width:none;margin:0;padding:0;overflow:visible;}
.app .reading-view :is(h1,h2,h3,h4,h5,h6) {break-after:avoid;}
.app .reading-view p {orphans:3;widows:3;}
.app .reading-view :is(pre,code) {white-space:pre-wrap!important;overflow-wrap:anywhere;}
.app .reading-view pre {overflow:visible!important;max-height:none!important;height:auto!important;}
.app .reading-view .code-block-shell {break-inside:auto;}
.app .reading-view table {table-layout:auto;}
.app .reading-view :is(td,th) {overflow-wrap:anywhere;}
.app .reading-view thead {display:table-header-group;}
.app .reading-view tr {break-inside:avoid;}
.app .reading-view :is(img,svg) {max-width:100%;height:auto;break-inside:avoid;}
.app .reading-view .mermaid-diagram {overflow:visible;break-inside:avoid;}
.app .reading-view .tabs-frame {height:auto;overflow:visible;}
.app .reading-view .tabs-reading-code {min-width:0;grid-template-columns:minmax(0,1fr);}
.app .reading-view .tabs-line-numbers {display:none;}
.app .reading-view .tabs-pane {overflow:visible;}
.app .reading-view .tabs-export-title {break-after:avoid;}
`;

export async function documentHTML(value: string, path: string, title: string, options: { expandFolds?: boolean } = {}) {
  const content = await renderMarkdown(value, path, { limitCodeHeight: false });
  if (options.expandFolds) content.querySelectorAll('details.folding-quote').forEach(node => node.setAttribute('open', ''));
  // Convert vault images to self-contained data URLs. Drawing/Mermaid SVG stays
  // vector and KaTeX stays selectable text in Chromium's PDF output.
  // Decode one image at a time rather than starting all large attachments at
  // once. The exported files still retain the original image bytes.
  for (const image of content.querySelectorAll('img')) {
    if (image.src.startsWith('moyu-asset://vault/')) image.src = await api.assetData(decodeURIComponent(new URL(image.src).pathname.slice(1)));
    await image.decode().catch(() => {});
    applyAttachmentSize(image, image.dataset.resourceAlt || image.alt, image.naturalWidth);
  }
  const css = await Promise.all(Array.from(document.styleSheets, sheet => {
    try { return stylesheet(sheet.cssRules, sheet.href || document.baseURI, !!content.querySelector('.katex')); } catch { return ''; }
  }));
  const output = document.implementation.createHTMLDocument(title);
  output.documentElement.lang = 'zh-CN';
  output.documentElement.dataset.theme = document.documentElement.dataset.theme;
  const charset = output.createElement('meta');charset.setAttribute('charset', 'utf-8');output.head.prepend(charset);
  const style = output.createElement('style');style.textContent = (css.join('\n') + layout).replace(/</g, '\\3c ');output.head.append(style);
  output.body.className = 'app document-export';
  const source = document.querySelector('.app');
  if (source) {
    const computed = getComputedStyle(source);
    for (const name of Array.from(computed)) if (name.startsWith('--')) {
      output.documentElement.style.setProperty(name, computed.getPropertyValue(name));
      output.body.style.setProperty(name, computed.getPropertyValue(name));
    }
  }
  content.className = 'reading-view';
  output.body.append(content);
  return '<!doctype html>\n' + output.documentElement.outerHTML;
}
