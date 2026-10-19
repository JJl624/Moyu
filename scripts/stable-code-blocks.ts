import type { Plugin } from 'vite';
// Keep CodeMirror's own line virtualization, but give each code block the same
// DOM lifetime as its document. Milkdown 7.22.2's block-level placeholders have
// different heights and its delayed teardown moves the page while it is idle.
function adaptCodeBlocks(code: string) {
  const replace = (pattern: RegExp, value: string) => {
    if (!pattern.test(code)) {
      throw new Error('Milkdown 7.22.2 code block integration needs review before upgrading');
    }
    code = code.replace(pattern, value);
  };
  replace(/const visibilityCallbacks =[\s\S]*?(?=const _CodeMirrorBlock = class)/, '');
  replace(
    /    this.renderPlaceholder\(\);\n    visibilityCallbacks.set[\s\S]*?    getSharedObserver\(\).observe\(this.dom\);/,
    '    this.initializeCodeMirror();',
  );
  replace(/  renderPlaceholder\(\) \{[\s\S]*?(?=  initializeCodeMirror\(\))/, '');
  replace(
    /    const placeholder = this.dom.querySelector\([\s\S]*?    this.app = this.createApp\(\);/,
    '    this.app = this.createApp();',
  );
  replace(/  teardownCodeMirror\(\) \{[\s\S]*?(?=  updateLanguage\(\))/, '');
  replace(
    /    this.cancelTeardown\(\);\n    getSharedObserver\(\).unobserve\(this.dom\);\n    visibilityCallbacks.delete\(this.dom\);/,
    '',
  );
  replace(/    this.teardownTimer = null;\n/, '');
  replace(/_CodeMirrorBlock.TEARDOWN_DELAY = 5e3;\n/, '');
  // CodeMirror forwards its selection to PM. PM echoes it to this node view;
  // refocusing an already focused editor forces Chromium to lay out the document.
  replace(
    /    this\.cm\.focus\(\);\n    this\.updating = true;\n    try \{\n      this\.cm\.dispatch\(\{ selection: \{ anchor, head \} \}\);/,
    '    if (!this.cm.hasFocus) this.cm.focus();\n    const selected = this.cm.state.selection.main;\n    if (selected.anchor === anchor && selected.head === head) return;\n    this.updating = true;\n    try {\n      this.cm.dispatch({ selection: { anchor, head } });',
  );
  return code;
}
export function stableCodeBlocks(): Plugin {
  const transform = (code: string, id: string) => {
    if (id.replaceAll('\\', '/').endsWith('/@milkdown/components/lib/code-block/index.js')) {
      return adaptCodeBlocks(code);
    }
  };
  return {
    name: 'moyu-stable-code-blocks',
    enforce: 'pre',
    // Vite's development dependency bundler runs before normal transforms.
    // Share the transform so npm run dev and production behave identically.
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: { plugins: [{ name: 'moyu-stable-code-blocks-deps', transform }] },
        },
      };
    },
    transform,
  };
}
