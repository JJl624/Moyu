import type {EditorView} from '@codemirror/view';
import {surfaceInputEnvironment} from './codeSelection';
import {mayAcquireInput, type FocusIntent} from './selectionPolicy';

/** Whole-document source editing uses the same permission policy as rich code. */
export function focusSourceEditor(view: EditorView, intent: FocusIntent) {
  const input = surfaceInputEnvironment(view.dom, !view.state.readOnly, view.composing, view.hasFocus);
  if (mayAcquireInput(intent, input)) view.focus();
}
