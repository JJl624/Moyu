import type { EditorView } from '@milkdown/kit/prose/view';
import { TextSelection } from '@milkdown/kit/prose/state';
import { isCodeBlock, mayAcquireInput, type FocusIntent, type InputEnvironment } from './selectionPolicy';

type CodeFocus = (anchor: number, head: number, intent: FocusIntent) => void;
const surfaces = new WeakMap<globalThis.Node, CodeFocus>();

/** Node views register one input surface and must unregister on destruction. */
export function registerCodeFocus(dom: globalThis.Node, focus: CodeFocus) {
  surfaces.set(dom, focus);
  return () => { if (surfaces.get(dom) === focus) surfaces.delete(dom); };
}

export function surfaceInputEnvironment(dom: HTMLElement, editable: boolean, composing: boolean, focused: boolean): InputEnvironment {
  const root = dom.ownerDocument.documentElement;
  return {
    editable,
    composing,
    mobile: !!dom.closest('.mobile-app'),
    keyboardVisible: root.dataset.mobileKeyboard === 'true',
    keyboardNavigation: root.dataset.mobileInput === 'keyboard',
    deleting: dom.closest<HTMLElement>('.editor-host')?.dataset.mobileDeletion === 'true',
    outerFocused: focused,
  };
}

export function inputEnvironment(view: EditorView): InputEnvironment {
  return surfaceInputEnvironment(view.dom, view.editable, view.composing, view.hasFocus());
}

export function mayFocusSelection(view: EditorView, intent: FocusIntent) {
  if (view.isDestroyed) return false;
  return mayAcquireInput(intent, inputEnvironment(view));
}

/** PM offsets are authoritative here; tab offsets are translated by the view. */
export function selectedCode(view: EditorView) {
  if (view.isDestroyed) return null;
  const selection = view.state.selection, head = selection.$head;
  if (!(selection instanceof TextSelection) || !isCodeBlock(head.parent.type.name)
    || !head.sameParent(selection.$anchor)) return null;
  const position = head.before(), dom = view.nodeDOM(position);
  return { position, dom, anchor: selection.$anchor.parentOffset, head: head.parentOffset };
}

export function focusCodeSelection(view: EditorView, intent: FocusIntent) {
  const selected = selectedCode(view), focus = selected?.dom && surfaces.get(selected.dom);
  if (!selected || !focus) return false;
  focus(selected.anchor, selected.head, intent);
  return true;
}
