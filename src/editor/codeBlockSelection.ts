import type { CodeMirrorBlock } from '@milkdown/kit/component/code-block';
import { mayFocusSelection, registerCodeFocus, selectedCode } from './codeSelection';
import { clampCodeRange, type FocusIntent } from './selectionPolicy';

/** Adapt the stock view without letting model updates implicitly open the IME. */
export function codeBlockSelection(block: CodeMirrorBlock) {
  const select = block.setSelection.bind(block);
  const selectNode = block.selectNode.bind(block);
  const destroy = block.destroy.bind(block);
  let pending: FocusIntent | null = null;
  let observer: MutationObserver | undefined;
  let destroyed = false;

  const apply = () => {
    if (destroyed || !pending || !block.cm?.dom.isConnected) return;
    const request = pending;
    pending = null;
    observer?.disconnect();
    // A delayed node-view mount uses today's owner/range, never captured offsets
    // from before a code editor was detached or an undo transaction completed.
    const currentOwner = selectedCode(block.view);
    if (currentOwner?.dom !== block.dom) return;
    const range = clampCodeRange(currentOwner.anchor, currentOwner.head, block.cm.state.doc.length);
    if (mayFocusSelection(block.view, request)) select(range.anchor, range.head);
    else {
      const current = block.cm.state.selection.main;
      if (current.anchor !== range.anchor || current.head !== range.head) block.cm.dispatch({ selection: range });
    }
  };
  const request = (intent: FocusIntent) => {
    pending = intent;
    if (block.cm?.dom.isConnected) apply();
    else {
      observer ??= new MutationObserver(apply);
      observer.observe(block.dom, { childList: true, subtree: true });
    }
  };
  const unregister = registerCodeFocus(block.dom, (_anchor, _head, intent) => request(intent));
  block.setSelection = () => request('node-update');
  block.selectNode = () => {
    if (mayFocusSelection(block.view, 'node-update')) selectNode();
    else block.selected.value = true;
  };
  block.destroy = () => {
    destroyed = true;
    pending = null;
    unregister();
    observer?.disconnect();
    destroy();
  };
  return block;
}
