import { type Command, type EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { findWrapping, liftTarget } from "@milkdown/kit/prose/transform";

// Text lines are paragraphs after splitting soft line breaks. The selection's
// mapped endpoints keep this operation limited to selected lines or the caret.
function lineTransaction(state: EditorState, quotedOnly = false) {
  const tr = state.tr, breaks: number[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== "paragraph") return;
    const at = state.doc.resolve(pos);
    if (
      quotedOnly && !Array.from({ length: at.depth }, (_, i) => at.node(i + 1)).some(n => n.type.name === "blockquote")
    ) return false;
    node.forEach((child, offset) => {
      if (child.type.name === "hardbreak" || child.type.name === "hard_break") breaks.push(pos + 1 + offset);
      if (child.isText) {
        for (const match of child.text!.matchAll(/\n/g)) breaks.push(pos + 1 + offset + match.index!);
      }
    });
    return false;
  });
  for (const pos of breaks.reverse()) {
    tr.delete(pos, pos + 1);
    tr.split(pos);
  }
  return tr;
}
export const removeQuoteLayer: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection)) return false;
  const tr = lineTransaction(state, true),
    range = tr.selection.$from.blockRange(tr.selection.$to, n => n.type.name === "blockquote");
  if (!range || liftTarget(range) !== range.depth - 1) return false;
  dispatch?.(tr.lift(range, range.depth - 1).scrollIntoView());
  return true;
};
export const addQuoteLayer: Command = (state, dispatch) => {
  // Editable Markdown marks are inline nodes. Skip their containing inline
  // parents and wrap the enclosing text block, just as for an ordinary caret.
  const tr = lineTransaction(state), range = tr.selection.$from.blockRange(tr.selection.$to, node => !node.inlineContent);
  const wrapping = range && findWrapping(range, state.schema.nodes.blockquote);
  if (!range || !wrapping) return false;
  dispatch?.(tr.wrap(range, wrapping).scrollIntoView());
  return true;
};
