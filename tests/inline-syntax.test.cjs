const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  Module = require('node:module');
const source = require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../src/inlineSyntax.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
}).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(source, __filename);
const { parseInline, sourceInlineTree, inlineLinkAt, readableMarkdown, canonicalMarkdown } =
  mod.exports;
test('Milkdown generated soft line breaks retain their hardbreak schema rather than becoming empty sources', () => {
  const line = {type:'break',data:{isInline:true}}, tree = {type:'paragraph',children:[{type:'text',value:'before'},line,{type:'text',value:'after'}]};
  sourceInlineTree(tree, 'before\nafter');
  assert.equal(tree.children[1], line);
  assert.equal(tree.children[1].type, 'break');
  assert(!tree.children.some(node=>node.type==='inlineSource' && !node.value));
});
test('Outer source regions preserve nested style, code and formula markers as one editable region', () => {
  const samples = [
    '$\\frac{3}{4}$',
    '**加粗 *斜体* `代码` 内容**',
    '*斜体*',
    '~~删除~~',
    '`行内代码`',
    '[网址](https://example.com)',
    '![图片](attachments/中文.svg)',
    '[数据](attachments/输入.csv)',
  ];
  for (const raw of samples) {
    const parsed = parseInline('左文' + raw + '右文');
    assert(parsed?.decorated, raw);
    const tree = { type: 'root', children: [{ type: 'paragraph', children: parsed.nodes }] };
    sourceInlineTree(tree, '左文' + raw + '右文');
    assert.deepEqual(
      tree.children[0].children.filter(n => n.type === 'inlineSource').map(n => n.value),
      [raw],
    );
  }
});

test('Incomplete attachment and link sources survive parsing in lists without being converted to escapable text', async () => {
  const { unified } = await import('unified'),
    { default: remarkParse } = await import('remark-parse');
  const parser = unified().use(remarkParse);
  for (
    const raw of [
      '![中文 图|180](<中文 图.svg>',
      '![中文 图',
      '![图](attachments/图.svg',
      '[数据](attachments/数据.csv',
    ]
  ) {
    const md = '- 前文\n  - ' + raw + '\n\n    后文';
    const tree = parser.parse(md);
    sourceInlineTree(tree, md);
    const sources = [];
    const walk = node => {
      if (node.type === 'inlineSource') sources.push(node.value);
      node.children?.forEach(walk);
    };
    walk(tree);
    assert.deepEqual(sources, [raw]);
  }
  for (const md of ['普通文本 [说明]', '`![代码](未完成`', '```md\n![代码](未完成\n```']) {
    const tree = parser.parse(md);
    sourceInlineTree(tree, md);
    const sources = [];
    const walk = node => {
      if (node.type === 'inlineSource') sources.push(node.value);
      node.children?.forEach(walk);
    };
    walk(tree);
    if (md === '普通文本 [说明]') assert.deepEqual(sources, []);
    else assert(!sources.includes('![代码](未完成'));
  }
});
test('Old double-bracket embeds migrate to standard links; code and escaped examples remain literal', () => {
  const raw = '![[attachments/中文图.excalidraw|640x480]]';
  assert.equal(parseInline(raw).kind, 'text');
  assert.equal(inlineLinkAt(raw, raw.length), null);
  assert.equal(
    canonicalMarkdown(raw, '笔记.md'),
    '![中文图.excalidraw|640](attachments/中文图.excalidraw)',
  );
  assert.equal(inlineLinkAt('`' + raw + '`', 10), null);
  assert.equal(inlineLinkAt('```md\n' + raw + '\n```', 15), null);
  assert.equal(inlineLinkAt('\\' + raw, 10), null);
  assert.equal(parseInline(raw.slice(0, -1)).decorated, false);
});

test('Legacy destinations normalize through nested styles and definitions while code, math, labels and remote queries remain verbatim', () => {
  const md =
    '**![中文](attachments/%E4%B8%AD%E6%96%87%20%281%29.svg "说明")**\n\n[文件][id]\n\n[id]: attachments/%E4%B8%AD%E6%96%87%20文件.pdf "标题"\n\n`![代码](attachments/中文%20图.svg)`\n\n$[公式](attachments/中文%20图.svg)$\n\n```md\n![示例](attachments/中文%20图.svg)\n```\n\n[网址](https://example.com/a%20b?q=x%26y)\n';
  const normalized = readableMarkdown(md);
  assert(normalized.includes('**![中文](<attachments/中文 (1).svg> "说明")**'));
  assert(normalized.includes('[id]: <attachments/中文 文件.pdf> "标题"'));
  for (
    const literal of [
      '`![代码](attachments/中文%20图.svg)`',
      '$[公式](attachments/中文%20图.svg)$',
      '```md\n![示例](attachments/中文%20图.svg)\n```',
      '[网址](https://example.com/a%20b?q=x%26y)',
    ]
  ) assert(normalized.includes(literal));
  assert.equal(readableMarkdown(normalized), normalized);
  assert.equal(readableMarkdown('[文件`名](attachments/中文%20图.svg)'), '[文件`名](<attachments/中文 图.svg>)');
  assert.equal(
    readableMarkdown('[`[内层](wrong)`](attachments/中文%20图.svg)'),
    '[`[内层](wrong)`](<attachments/中文 图.svg>)',
  );
  const raw = '**![中文](attachments/中文%20图.svg)**',
    nodes = parseInline(raw).nodes,
    tree = { type: 'root', children: [{ type: 'paragraph', children: nodes }] };
  sourceInlineTree(tree, raw);
  assert.equal(tree.children[0].children[0].value, '**![中文](<attachments/中文 图.svg>)**');
});
test('Encoded indentation remains plain text beside inline media', async () => {
  const { unified } = await import('unified'),
    { default: remarkParse } = await import('remark-parse');
  for (
    const markdown of [
      '&#x20;   ![图](图.svg)',
      '&#x9;![图](图.svg)',
      '- &#x20;   [绘图](图.excalidraw)',
    ]
  ) {
    const tree = unified().use(remarkParse).parse(markdown);
    sourceInlineTree(tree, markdown);
    const paragraph = markdown.startsWith('- ')
      ? tree.children[0].children[0].children[0]
      : tree.children[0];
    assert.equal(paragraph.children[0].type, 'text');
    assert.match(paragraph.children[0].value, /^\s+$/);
    assert.equal(paragraph.children[1].type, 'inlineSource');
  }
});
