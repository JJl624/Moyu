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
    const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset),
      head = view.posAtDOM(native.focusNode, native.focusOffset),doc = view.state.doc;
    // Select-all may end at document boundaries. Keep the editor's AllSelection
    // rather than constructing an invalid TextSelection (which also logs a warning).
    if (!doc.resolve(anchor).parent.inlineContent || !doc.resolve(head).parent.inlineContent) return;
    const selected = TextSelection.create(doc, anchor, head);
    if (!selected.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selected));
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
