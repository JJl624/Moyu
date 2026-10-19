const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  Module = require('node:module');
const source =
  require('esbuild').buildSync({
    entryPoints: [path.resolve(__dirname, '../src/editor/inlineSerialization.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
  }).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(source, __filename);
const { inlineMarkdownHandlers } = mod.exports;
test('Indentation before inline source round-trips as paragraph text, including list content', async () => {
  const { toMarkdown, defaultHandlers } = await import('mdast-util-to-markdown'),
    { unified } = await import('unified'),
    { default: remarkParse } = await import('remark-parse');
  const handlers = inlineMarkdownHandlers({
    text: (node, parent, state, info) =>
      /^[^*_\\]*\s+$/.test(node.value)
        ? node.value
        : defaultHandlers.text(node, parent, state, info),
  });
  const parser = unified().use(remarkParse);
  for (const whitespace of ['    ', '        ', '\t']) {
    for (
      const raw of [
        '![图片](中文图片.png)',
        '![图片](图片.svg)',
        '[绘图](绘图.excalidraw)',
        '**加粗**',
      ]
    ) {
      for (const listed of [false, true]) {
        const paragraph = {
          type: 'paragraph',
          children: [{ type: 'text', value: whitespace }, { type: 'inlineRaw', value: raw }],
        };
        const ast = {
          type: 'root',
          children: [
            listed
              ? {
                type: 'list',
                ordered: false,
                spread: false,
                children: [{ type: 'listItem', spread: false, children: [paragraph] }],
              }
              : paragraph,
          ],
        };
        const markdown = toMarkdown(ast, { handlers });
        assert.ok(markdown.includes(raw));
        const parsed = parser.parse(markdown),
          p = listed ? parsed.children[0].children[0].children[0] : parsed.children[0];
        assert.equal(p.type, 'paragraph', markdown);
        assert.equal(p.children[0].type, 'text');
        assert.equal(p.children[0].value, whitespace);
        assert.equal(
          p.children[1].type,
          raw.startsWith('!') ? 'image' : raw.startsWith('[') ? 'link' : 'strong',
        );
      }
    }
  }
});
test('Other text serialization remains delegated and inline source keeps its delimiters', async () => {
  const { toMarkdown } = await import('mdast-util-to-markdown');
  let calls = 0;
  const handlers = inlineMarkdownHandlers({
    text: node => {
      calls++;
      return node.value;
    },
  });
  const markdown = toMarkdown({
    type: 'root',
    children: [{
      type: 'paragraph',
      children: [{ type: 'text', value: '前文 ' }, {
        type: 'inlineRaw',
        value: '![图|50%](<attachments/中文 图.svg>)',
      }, { type: 'text', value: ' 后文' }],
    }],
  }, { handlers });
  assert.ok(calls >= 2);
  assert.equal(markdown, '前文 ![图|50%](<attachments/中文 图.svg>) 后文\n');
});
