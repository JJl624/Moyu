const test = require('node:test'), assert = require('node:assert/strict'),
  path = require('node:path'), Module = require('node:module');
const source = require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../src/editor/headingSource.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename; mod.paths = module.paths; mod._compile(source, __filename);
const { createSourceHeadingRule } = mod.exports;
const { Schema } = require('prosemirror-model');
const { EditorState, TextSelection } = require('prosemirror-state');
const { history, undo, redo } = require('prosemirror-history');
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 }, sourceHeading: { default: false } } },
  bullet_list: { group: 'block', content: 'list_item+' },
  list_item: { content: '(paragraph | heading) block*' }, text: { group: 'inline' },
} });
test('Heading input survives undo/redo in paragraphs and lists without replaying source markers', () => {
  const rule = createSourceHeadingRule();
  for (const listed of [false, true]) for (let level = 1; level <= 6; level++) {
    const hashes = '#'.repeat(level), p = schema.node('paragraph', null, schema.text(hashes + '标题'));
    const doc = schema.node('doc', null, listed ? schema.node('bullet_list', null, schema.node('list_item', null, p)) : p);
    const start = listed ? 3 : 1, end = start + level;
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, end), plugins: [history()] });
    const match = rule.match.exec(hashes + ' ');
    state = state.apply(rule.handler(state, match, start, end));
    const heading = state.doc.nodeAt(start - 1);
    assert.equal(heading.type.name, 'heading');
    assert.equal(heading.attrs.level, level);
    assert.equal(heading.textContent, hashes + ' 标题');
    assert.equal(state.selection.head, end + 1);
    assert.equal(rule.handler(state, match, start, end + 1), null);
    assert(undo(state, tr => { state = state.apply(tr); }));
    assert.deepEqual(state.doc.toJSON(), doc.toJSON());
    assert(redo(state, tr => { state = state.apply(tr); }));
    assert.equal(state.doc.nodeAt(start - 1).textContent, hashes + ' 标题');
  }
});
test('Heading input leaves non-Markdown prefixes and markers after ordinary text untouched', () => {
  const rule = createSourceHeadingRule();
  for (const text of ['####### ', '#标题', '正文# ', '#  ', '#\n']) assert.equal(rule.match.exec(text), null);
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('正文#')));
  const state = EditorState.create({ doc });
  assert.equal(rule.handler(state, rule.match.exec('# '), 3, 4), null);
});
