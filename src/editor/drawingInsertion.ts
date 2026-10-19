import type { EditorState } from "@milkdown/kit/prose/state";

// A drawing is an inline attachment, inserted wherever ordinary body text is editable.
// Raw syntax and fenced code retain their literal text editing behavior.
export function canInsertInlineDrawing(state: Pick<EditorState, "selection">) {
  const s = state.selection;
  return s.empty && ["paragraph", "heading"].includes(s.$from.parent.type.name)
    && !s.$from.marks().some(mark => mark.type.name === "inlineCode");
}
