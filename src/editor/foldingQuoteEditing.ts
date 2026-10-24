import type { Node } from '@milkdown/kit/prose/model';
import type { Command, EditorState } from '@milkdown/kit/prose/state';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';

export const foldingMarker = /^\[([+-])\][ \t]*/;
export const foldingDraft = /^\[(?![+-]\])/;

export function foldHeadingAt(doc: Node, pos: number) {
  const at = doc.resolve(pos);
  if (at.parent.type.name !== 'paragraph' || at.depth < 2 || at.index(-1) !== 0
    || at.node(-1).type.name !== 'blockquote' || typeof at.node(-1).attrs.folding !== 'boolean') return null;
  const prefix = at.parent.textContent.match(foldingMarker)?.[0];
  return prefix ? { pos: at.before(-1), start: at.start() + prefix.length } : null;
}

export const leaveFoldHeading: Command = (state, dispatch) => {
  if (!state.selection.empty) return false;
  const heading = foldHeadingAt(state.doc, state.selection.head);
  if (!heading || state.selection.head > heading.start) return false;
  const previous = Selection.findFrom(state.doc.resolve(heading.pos), -1, true);
  if (previous) dispatch?.(state.tr.setSelection(previous).scrollIntoView());
  return true;
};

export function selectedFold(state: EditorState) {
  const at = state.selection.$from;
  for (let depth = at.depth; depth > 0; depth--) {
    const node = at.node(depth);
    if (node.type.name === 'blockquote' && typeof node.attrs.folding === 'boolean') {
      return { node, pos: at.before(depth) };
    }
  }
  return null;
}

// Run before generic inline rules: a closing bracket here belongs to the quote,
// not to a link. Partial markers serialize literally while they are being typed.
export function foldingInput(state: EditorState, from: number, to: number, text: string) {
  const at = state.doc.resolve(from), end = state.doc.resolve(to);
  if (!at.sameParent(end) || at.parent.type.name !== 'paragraph' || at.depth < 2
    || at.index(-1) !== 0 || at.node(-1).type.name !== 'blockquote'
    || from > at.start() + 3 || !text) return null;
  const tr = state.tr.insertText(text, from, to), paragraph = tr.doc.resolve(from).parent;
  if (!paragraph.firstChild?.isText) return null;
  const value = paragraph.firstChild.text!, marker = value.match(foldingMarker), draft = foldingDraft.test(value);
  if (!marker && !draft) return null;
  return tr.setNodeMarkup(at.before(-1), undefined, {
    ...at.node(-1).attrs, folding: marker ? marker[1] === '+' : null, foldingDraft: draft,
  }).setSelection(TextSelection.create(tr.doc, from + text.length));
}

export const unfoldAtStart: Command = (state, dispatch) => {
  const fold = selectedFold(state), at = state.selection.$head;
  const inlineStart = at.parent.type.name === 'resource_link' && at.parentOffset === 0;
  const paragraph = inlineStart ? at.node(-1) : at.parent, caret = at.pos - (inlineStart ? 1 : 0);
  if (!fold || !state.selection.empty || paragraph !== fold.node.firstChild) return false;
  const prefix = paragraph.textContent.match(foldingMarker)?.[0];
  if (!prefix || caret > fold.pos + 2 + prefix.length) return false;
  if (dispatch) {
    const start = fold.pos + 2, tr = state.tr.delete(start + 2, start + 3);
    tr.setNodeMarkup(fold.pos, undefined, { ...fold.node.attrs, folding: null, foldingDraft: true });
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView());
  }
  return true;
};

export const toggleFoldDefault: Command = (state, dispatch) => {
  const fold = selectedFold(state);
  if (!fold || !fold.node.firstChild?.textContent.match(foldingMarker)) return false;
  if (dispatch) {
    const open = !fold.node.attrs.folding;
    const tr = state.tr.insertText(open ? '+' : '-', fold.pos + 3, fold.pos + 4)
      .setNodeMarkup(fold.pos, undefined, { ...fold.node.attrs, folding: open });
    if (!open && state.selection.head > fold.pos + 1 + fold.node.firstChild!.nodeSize)
      tr.setSelection(TextSelection.create(tr.doc, fold.pos + fold.node.firstChild!.nodeSize));
    dispatch(tr);
  }
  return true;
};
