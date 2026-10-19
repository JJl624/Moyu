const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  Module = require('node:module');
const source = require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../src/editor/inlineSourceEditing.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['prosemirror-*'],
}).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(source, __filename);
const { separateInlineText } = mod.exports;
const { Schema } = require('prosemirror-model'),
  { EditorState, TextSelection } = require('prosemirror-state');
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    resource_link: { inline: true, group: 'inline', content: 'text*' },
    text: { group: 'inline' },
    bullet_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'paragraph block*' },
  },
});
const rawNode = raw => schema.node('resource_link', null, schema.text(raw));
test('Multiple media and surrounding text split into inline siblings without reordering source or caret', () => {
  const first = '![中文 图|160](<attachments/中文 图.svg>)',
    second = '[绘图](attachments/绘图.excalidraw)',
    raw = '前文' + first + '中间**加粗**' + second + '后文';
  for (let offset = 0; offset <= raw.length; offset++) {
    const doc = schema.node('doc', null, schema.node('paragraph', null, rawNode(raw))),
      state = EditorState.create({ doc, selection: TextSelection.create(doc, offset + 2) }),
      next = state.apply(separateInlineText(state));
    next.doc.check();
    const p = next.doc.firstChild;
    assert.equal(p.childCount, 6);
    assert.equal(p.textContent, raw);
    assert.equal(p.child(1).textContent, first);
    assert.equal(p.child(4).textContent, second);
    const h = next.selection.$head;
    let left = h.parent.content.cut(0, h.parentOffset).textBetween(0, h.parentOffset);
    if (h.parent.type.name === 'resource_link') {
      left = p.content.cut(0, h.before() - 1).textBetween(0, h.before() - 1) + left;
    }
    assert.equal(left, raw.slice(0, offset), 'caret offset ' + offset);
    assert.equal(separateInlineText(next), null);
  }
});
test('An inline image remains within its original list paragraph with text on both sides', () => {
  const raw = '左![图](图.svg)右',
    paragraph = schema.node('paragraph', null, rawNode(raw)),
    doc = schema.node(
      'doc',
      null,
      schema.node('bullet_list', null, [
        schema.node('list_item', null, schema.node('paragraph', null, schema.text('上一项'))),
        schema.node('list_item', null, paragraph),
      ]),
    ),
    state = EditorState.create({ doc }),
    next = state.apply(separateInlineText(state));
  assert.equal(next.doc.firstChild.childCount, 2);
  assert.equal(next.doc.firstChild.lastChild.childCount, 1);
  assert.equal(next.doc.firstChild.lastChild.firstChild.childCount, 3);
  assert.equal(next.doc.firstChild.lastChild.textContent, raw);
});
test('Media-only list items remain untouched instead of joining or lifting their neighbors', () => {
  const doc = schema.node(
    'doc',
    null,
    schema.node(
      'bullet_list',
      null,
      ['![图](图.svg)', '[绘图](图.excalidraw)'].map(raw =>
        schema.node('list_item', null, schema.node('paragraph', null, rawNode(raw)))
      ),
    ),
  );
  assert.equal(separateInlineText(EditorState.create({ doc })), null);
  assert.equal(doc.firstChild.childCount, 2);
});
test('Incomplete destinations and escaped delimiters remain editable verbatim', () => {
  for (
    const raw of ['![未完成](路径 ![图](图.svg)', '\\![图](图.svg)', '![中文](<attachments/中文 图.svg>']
  ) {
    const doc = schema.node('doc', null, schema.node('paragraph', null, rawNode(raw))),
      state = EditorState.create({ doc }),
      tr = separateInlineText(state);
    assert.equal(tr ? state.apply(tr).doc.textContent : doc.textContent, raw);
  }
});

test('An active source draft remains intact until the caret leaves it', () => {
  const raw = '**加粗*改*',
    source = rawNode(raw),
    doc = schema.node('doc', null, schema.node('paragraph', null, [source, schema.text('右')])),
    state = EditorState.create({ doc, selection: TextSelection.create(doc, 7) });
  assert.equal(separateInlineText(state, state.selection.$head.parent), null);
  const outside = state.apply(state.tr.setSelection(TextSelection.create(doc, source.nodeSize + 2))),
    split = separateInlineText(outside);
  assert.ok(split);
  assert.equal(outside.apply(split).doc.textContent, raw + '右');
});
