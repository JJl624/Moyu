const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  Module = require("node:module");
const source = require("esbuild").buildSync({
  entryPoints: [path.resolve(__dirname, "../src/editor/asyncDrawingInsert.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["prosemirror-*"],
}).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(source, __filename);
const { createAsyncDrawingInsertPlugin, prepareDrawingInsert } = mod.exports;
const { Schema } = require("prosemirror-model"),
  { EditorState, TextSelection } = require("prosemirror-state"),
  { history, undo } = require("prosemirror-history");
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    code_block: { group: "block", content: "text*", code: true },
    text: { group: "inline" },
    resource_link: { inline: true, group: "inline", content: "text*", code: true },
  },
});
function fixture(text = "前后") {
  const plugin = createAsyncDrawingInsertPlugin(),
    doc = schema.node("doc", null, schema.node("paragraph", null, schema.text(text)));
  const view = {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, text.length + 1),
      plugins: [plugin, history()],
    }),
    dom: { ownerDocument: { getSelection: () => null } },
    isDestroyed: false,
    focus() {},
    dispatch(tr) {
      this.state = this.state.apply(tr);
    },
  };
  const lifecycle = plugin.spec.view(view);
  return { view, lifecycle };
}
test("Asynchronous drawing insertion follows edits before the original caret, inserts exactly once and is undoable", () => {
  const { view, lifecycle } = fixture(), job = prepareDrawingInsert(view);
  view.dispatch(view.state.tr.insertText("追加", 1));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  const raw = "![绘图](attachments/中文绘图.excalidraw)";
  assert.equal(job.insert(raw), true);
  assert.equal(job.insert(raw), false);
  assert.equal(view.state.doc.firstChild.childCount, 2);
  assert.equal(view.state.doc.firstChild.firstChild.textContent, "追加前后");
  assert.equal(view.state.doc.firstChild.lastChild.type.name, "resource_link");
  assert.equal(view.state.doc.firstChild.lastChild.textContent, raw);
  view.state.doc.check();
  assert.equal(undo(view.state, tr => view.dispatch(tr)), true);
  assert.equal(view.state.doc.textContent, "追加前后");
  lifecycle.destroy();
});
test("Deleting the insertion paragraph or destroying its editor cancels pending drawing insertion", () => {
  for (const destroyed of [false, true]) {
    const { view, lifecycle } = fixture(), job = prepareDrawingInsert(view);
    if (destroyed) {
      lifecycle.destroy();
      view.isDestroyed = true;
    } else {view.dispatch(
        view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          schema.node("code_block", null, schema.text("x")),
        ),
      );}
    const before = view.state.doc.toJSON();
    assert.equal(job.insert("![图](x.excalidraw)"), false);
    assert.deepEqual(view.state.doc.toJSON(), before);
    if (!destroyed) lifecycle.destroy();
  }
});
test("Drawing insertion rejects code and nonempty selections and cancellation releases the pending job", () => {
  const { view, lifecycle } = fixture();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)));
  assert.equal(prepareDrawingInsert(view), null);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  const job = prepareDrawingInsert(view);
  job.cancel();
  assert.equal(job.insert("![图](x.excalidraw)"), false);
  view.dispatch(
    view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      schema.node("code_block", null, schema.text("x")),
    ),
  );
  assert.equal(prepareDrawingInsert(view), null);
  lifecycle.destroy();
});
