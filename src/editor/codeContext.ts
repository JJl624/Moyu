import type { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import type { EditorContext } from '../editorTypes';

export function prepareCodeContext(view: EditorView, target: HTMLElement, coords: { left: number; top: number }): EditorContext | null {
  if (!view.dom.contains(target)) return null;
  const doc = view.state.doc;
  let selection = view.state.selection;
  const point = view.posAtCoords({ x: coords.left, y: coords.top });
  if (point !== null && (selection.main.empty || !selection.ranges.some(range => range.from <= point && range.to >= point))) {
    selection = EditorSelection.single(point);
  }
  return {
    text: selection.ranges.map(range => doc.sliceString(range.from, range.to)).join('\n'),
    textFor: () => '',
    canInsertDrawing: false,
    can: () => false,
    run: () => false,
    restore: () => {
      if (view.state.doc !== doc || !view.dom.isConnected) return false;
      view.dispatch({ selection });
      view.focus();
      return true;
    },
  };
}
