import { codeBlockConfig, CodeMirrorBlock } from "@milkdown/kit/component/code-block";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $nodeSchema, $prose, $view } from "@milkdown/kit/utils";
import { codeLanguage } from "../highlight";
import { readNativeSelection } from "./selectionOwnership";

// Display math is Markdown math, not a persisted programming-language fence.
export const displayMathSchema = $nodeSchema("math_block", () => ({
  content: "text*",
  group: "block",
  code: true,
  defining: true,
  marks: "",
  attrs: { language: { default: "latex" }, meta: { default: "" } },
  parseDOM: [{ tag: "div[data-math-block]", preserveWhitespace: "full" }],
  toDOM: () => ["div", { "data-math-block": "true" }, 0],
  parseMarkdown: {
    match: n => n.type === "math",
    runner(state, node, type) {
      state.openNode(type);
      if (node.value) state.addText(String(node.value));
      state.closeNode();
    },
  },
  toMarkdown: {
    match: n => n.type.name === "math_block",
    runner(state, node) {
      state.addNode("math", undefined, node.textContent);
    },
  },
}));
export const displayMathView = $view(displayMathSchema.node, ctx => {
  const config = ctx.get(codeBlockConfig.key),
    loader = {
      load: () => codeLanguage("latex")?.load() || Promise.resolve(undefined),
      getAll: () => [{ name: "数学公式", alias: ["latex"] }],
    } as unknown as ConstructorParameters<typeof CodeMirrorBlock>[3];
  return (node, view, getPos) => {
    const block = new CodeMirrorBlock(node, view, getPos, loader, config);
    block.dom.classList.add("math-block");
    block.dom.dataset.mathBlock = "true";
    return block;
  };
});
export const displayMathInput = $prose(() =>
  new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          if (
            event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
            || event.isComposing || view.composing
          ) return false;
          readNativeSelection(view);
          const s = view.state.selection;
          if (
            !s.empty || s.$from.parent.type.name !== "paragraph" || s.$from.parent.textContent.trim() !== "$$"
          ) return false;
          const pos = s.$from.before(),
            tr = view.state.tr.replaceWith(
              pos,
              pos + s.$from.parent.nodeSize,
              view.state.schema.nodes.math_block.create(),
            );
          event.preventDefault();
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
          return true;
        },
      },
    },
  })
);
