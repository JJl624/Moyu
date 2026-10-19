const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  Module = require('node:module');
const code =
  require('esbuild').buildSync({
    entryPoints: [path.resolve(__dirname, '../src/inlineSyntax.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
  }).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(code, __filename);
const { sourceInlineTree, parseInline } = mod.exports;
test('HTML comments retain editable source, while code examples and non-comment HTML keep their schemas', async () => {
  const { unified } = await import('unified'), { default: parse } = await import('remark-parse');
  const raw =
    '前<!-- 行内中文 -->后\n\n<!-- 独立\n多行 -->\n\n- 项目\n\n  <!-- 列表注释\n  第二行 -->\n\n```html\n<!-- 示例 -->\n```\n\n<div>普通 HTML</div>';
  const tree = unified().use(parse).parse(raw);
  sourceInlineTree(tree, raw);
  assert.equal(tree.children[0].children[1].type, 'inlineSource');
  assert.equal(tree.children[0].children[1].value, '<!-- 行内中文 -->');
  assert.deepEqual(tree.children[1], {
    type: 'commentBlock',
    value: '<!-- 独立\n多行 -->',
    position: tree.children[1].position,
  });
  assert.equal(tree.children[2].children[0].children[1].value, '<!-- 列表注释\n第二行 -->');
  assert.equal(tree.children[3].type, 'code');
  assert.equal(tree.children[4].type, 'html');
  assert.equal(parseInline('<!-- 注释 -->').kind, 'html');
  assert.equal(parseInline('<!-- 未完成').nodes[0].type, 'html');
});
