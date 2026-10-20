import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

// Chromium can move its caret before ProseMirror's deferred selection read.
// Read it before commands that use the current text position, without taking
// over CodeMirror's selection or a browser drag.
export function readNativeSelection(view: EditorView) {
  const native = view.dom.ownerDocument.getSelection();
  if (
    !native?.anchorNode || !native.focusNode || !view.dom.contains(native.anchorNode)
    || !view.dom.contains(native.focusNode)
  ) return;
  const anchor = native.anchorNode instanceof Element
    ? native.anchorNode
    : native.anchorNode.parentElement;
  const focus = native.focusNode instanceof Element ? native.focusNode : native.focusNode.parentElement;
  // Preview text lives outside the node view's editable contentDOM. Mapping
  // it with posAtDOM can turn a valid document selection into a single caret.
  if (anchor?.closest('.cm-editor,.syntax-preview') || focus?.closest('.cm-editor,.syntax-preview')) return;
  try {
    const selected = TextSelection.create(
      view.state.doc,
      view.posAtDOM(native.anchorNode, native.anchorOffset),
      view.posAtDOM(native.focusNode, native.focusOffset),
    );
    if (
      selected.$from.parent.inlineContent && selected.$to.parent.inlineContent
      && !selected.eq(view.state.selection)
    ) view.dispatch(view.state.tr.setSelection(selected));
  } catch { /* A node view may be replacing its DOM. */ }
}

// A source reveal changes visibility without changing its text DOM. Place the
// native caret explicitly so the next edit reads the same endpoint as PM.
export function syncInlineCaret(view: EditorView) {
  const selected = view.state.selection;
  if (!selected.empty || selected.$head.parent.type.name !== 'resource_link') return;
  const point = view.domAtPos(selected.head), range = view.dom.ownerDocument.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const native = view.dom.ownerDocument.getSelection();
  native?.removeAllRanges();
  native?.addRange(range);
}
