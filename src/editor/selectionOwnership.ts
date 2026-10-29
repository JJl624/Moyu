import {TextSelection} from '@milkdown/kit/prose/state';
import type {EditorView} from '@milkdown/kit/prose/view';
import {focusCodeSelection, mayFocusSelection, selectedCode} from './codeSelection';
import type {FocusIntent} from './selectionPolicy';

const elementAt = (node: globalThis.Node) => node.nodeType === 1 ? node as Element : node.parentElement;

/** Read only native outer-text selections; code and IME composition own theirs. */
export function readNativeSelection(view: EditorView) {
  if (view.isDestroyed || view.composing) return;
  const native = view.dom.ownerDocument.getSelection();
  if (!native?.anchorNode || !native.focusNode || !view.dom.contains(native.anchorNode)
    || !view.dom.contains(native.focusNode)) return;
  const anchorElement = elementAt(native.anchorNode), focusElement = elementAt(native.focusNode);
  if (anchorElement?.closest('.cm-editor,.syntax-preview') || focusElement?.closest('.cm-editor,.syntax-preview')) return;
  for(const element of [anchorElement,focusElement]){
    if(element?.closest('.attachment-space'))return;
    const source=element?.closest('.syntax-raw');
    if(source&&view.dom.ownerDocument.defaultView?.getComputedStyle(source).display==='none')return;
  }
  try {
    const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
    const head = view.posAtDOM(native.focusNode, native.focusOffset), document = view.state.doc;
    // AllSelection and block selections are not invalid text selections.
    if (!document.resolve(anchor).parent.inlineContent || !document.resolve(head).parent.inlineContent) return;
    const selection = TextSelection.create(document, anchor, head);
    if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
  } catch { /* A node view may be replacing its DOM. Keep the model selection. */ }
}

function syncTextCaret(view: EditorView) {
  const selection = view.state.selection, parent = selection.$head.parent;
  if (!selection.empty || view.composing || !parent.inlineContent
    || parent.type.spec.code && parent.type.name !== 'resource_link') return;
  const native = view.dom.ownerDocument.getSelection();
  if (!native) return;
  // A paragraph boundary beside an inline source has no native glyph box.
  // Use the same visible source edge for the DOM caret; boundary input is
  // mapped back to its outer position by resourceKeys before editing.
  const edge=selection.$head;
  const position=edge.nodeAfter?.type.name==='resource_link'?selection.head+1
    :edge.nodeBefore?.type.name==='resource_link'?selection.head-1:selection.head;
  const point = view.domAtPos(position);
  if(point.node.nodeType===1&&elementAt(point.node)?.closest('.syntax-raw')){
    const after=point.node.childNodes[point.offset],backward=!after;
    let text=after||point.node.childNodes[point.offset-1];
    while(text?.nodeType===1&&!(text as HTMLElement).matches('[contenteditable=false]'))text=(backward?text.lastChild:text.firstChild)!;
    if(text?.nodeType===3){point.node=text;point.offset=backward?text.textContent?.length||0:0;}
  }
  // Re-collapsing the same range triggers native selection observers in every
  // mounted code view and can force layout during a document switch.
  if (!native.isCollapsed || native.anchorNode !== point.node || native.anchorOffset !== point.offset)
    native.collapse(point.node, point.offset);
}

export function syncInlineCaret(view: EditorView) {
  if (view.state.selection.$head.parent.type.name === 'resource_link') syncTextCaret(view);
}

/** A restored preview changes geometry, never the logical caret. Reconcile the
 * native range once after node views settle, without requesting input focus. */
export function reconcileAttachmentCaret(view:EditorView){
  const {doc,selection}=view.state,head=selection.$head;
  if(!selection.empty||![head.parent,head.nodeBefore,head.nodeAfter].some(node=>node?.type.name==='resource_link'))return;
  queueMicrotask(()=>{
    if(view.isDestroyed||view.composing||view.state.doc!==doc||!view.state.selection.eq(selection)||!view.hasFocus())return;
    syncTextCaret(view);
  });
}

/** Transfer input only after the document and logical selection have committed. */
export function focusEditorSelection(view: EditorView, intent: FocusIntent) {
  if (!mayFocusSelection(view, intent)) return;
  if (selectedCode(view)) {
    // A missing/detached code surface must never fall back to the outer editor.
    focusCodeSelection(view, intent);
    return;
  }
  const document = view.dom.ownerDocument, active = document.activeElement;
  const ElementType = document.defaultView?.HTMLElement;
  if (ElementType && active instanceof ElementType && active.closest('.cm-editor')) active.blur();
  // Gecko can restore its previous input connection on focus. Establish the
  // outer range first, then verify it again after transferring focus.
  syncTextCaret(view);
  view.focus();
  syncTextCaret(view);
}
