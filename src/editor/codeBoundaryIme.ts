import {Plugin, TextSelection} from '@milkdown/kit/prose/state';
import type {EditorView} from '@milkdown/kit/prose/view';
import {$prose} from '@milkdown/kit/utils';
import {enterAdjacentCode} from './blockNavigation';
import {codeBoundaryAt, isEmptyCodeBridge, type CodeBoundary} from './codeBoundary';
import {inputEnvironment} from './codeSelection';

type BoundaryState = {kind: 'idle' | 'pointer' | 'disposed'}
  | {kind: 'boundary'; boundary: CodeBoundary; processing: boolean};

function sameOrigin(left: CodeBoundary, right: CodeBoundary) {
  return left.selection.$head.doc === right.selection.$head.doc
    && left.selection.eq(right.selection) && left.backward === right.backward;
}

// Android Gecko may select an empty code boundary before its DOM-first delete,
// without beforeinput. This adapter recognizes that transition; the shared
// boundary command alone owns document changes and input ownership transfer.
export const codeBoundaryIme = $prose(() => {
  let state: BoundaryState = {kind: 'idle'};
  let repairQueued = false;
  let editor: EditorView | undefined;
  const clear = () => { state = {kind: 'idle'}; };
  const enabled = (view: EditorView) => {
    const input = inputEnvironment(view);
    return input.mobile && input.editable && input.keyboardVisible && !input.composing;
  };
  const remember = (view: EditorView) => {
    if (state.kind === 'pointer' || state.kind === 'disposed') return;
    const selected = view.state.selection;
    // Preserve the originating caret while the IME temporarily expands it.
    if (!(selected instanceof TextSelection) || !selected.empty) return;
    for (const backward of [true, false]) {
      const boundary = codeBoundaryAt(view.state, selected, backward);
      if (boundary && !boundary.code.content.size) {
        const processing = state.kind === 'boundary' && state.processing && sameOrigin(state.boundary, boundary);
        state = {kind: 'boundary', boundary, processing};
        return;
      }
    }
    clear();
  };
  const repair = (view: EditorView) => {
    if (repairQueued || state.kind !== 'boundary' || !state.processing) return;
    const origin = state.boundary;
    repairQueued = true;
    queueMicrotask(() => {
      repairQueued = false;
      if (view.isDestroyed || !enabled(view) || state.kind !== 'boundary' || !state.processing
        || !sameOrigin(origin, state.boundary) || origin.selection.$head.doc !== view.state.doc) return;
      if (!isEmptyCodeBridge(origin, view.state.selection) && !view.state.selection.eq(origin.selection)) return;
      clear();
      enterAdjacentCode(view, origin.backward, origin.selection);
    });
  };

  return new Plugin({
    props: {handleDOMEvents: {
      pointerdown() { state = {kind: 'pointer'}; return false; },
      pointerup(view) {
        clear();
        if (view.dom.ownerDocument.getSelection()?.isCollapsed) remember(view);
        return false;
      },
      pointercancel() { clear(); return false; },
      keydown(view, event) {
        if ((event.key === 'Process' || event.keyCode === 229) && enabled(view)) {
          if (state.kind === 'boundary') {
            state = {...state, processing: true};
            if (isEmptyCodeBridge(state.boundary, view.state.selection)) repair(view);
          }
        } else clear();
        return false;
      },
      beforeinput(_view, event) {
        if (!/^delete(?:Content|Word|SoftLine|HardLine|EntireSoftLine)/.test(event.inputType)) clear();
        return false;
      },
    }},
    filterTransaction(transaction, before) {
      if (state.kind !== 'boundary' || !state.processing || !editor || !enabled(editor)
        || state.boundary.selection.$head.doc !== before.doc || !transaction.docChanged) return true;
      const origin = state.boundary, node = before.doc.nodeAt(origin.position);
      if (node?.type.name !== 'code_block' || node.content.size
        || transaction.doc.textContent !== before.doc.textContent) return true;
      const mapped = transaction.mapping.mapResult(origin.position);
      if (mapped.deleted && transaction.doc.nodeAt(mapped.pos)?.type !== node.type) {
        repair(editor);
        return false;
      }
      return true;
    },
    view(view) {
      editor = view;
      remember(view);
      const outsidePointer = (event: PointerEvent) => { if (!view.dom.contains(event.target as Node)) clear(); };
      view.dom.ownerDocument.addEventListener('pointerdown', outsidePointer, true);
      return {
        update(view, before) {
          const input = inputEnvironment(view);
          if (!input.editable || !input.mobile) { clear(); return; }
          if (!enabled(view) && state.kind === 'boundary') state = {...state, processing: false};
          if (state.kind === 'boundary' && state.processing && isEmptyCodeBridge(state.boundary, view.state.selection)) {
            repair(view);
            return;
          }
          if (before.doc !== view.state.doc && state.kind !== 'pointer') clear();
          remember(view);
        },
        destroy() {
          view.dom.ownerDocument.removeEventListener('pointerdown', outsidePointer, true);
          editor = undefined;
          state = {kind: 'disposed'};
        },
      };
    },
  });
});
