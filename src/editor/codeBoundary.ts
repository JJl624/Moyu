import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection, type EditorState, type Selection } from '@milkdown/kit/prose/state';
import { isCodeBlock } from './selectionPolicy';

export interface CodeBoundary {
  selection: TextSelection;
  code: Node;
  position: number;
  backward: boolean;
  container: Node;
  paragraphIndex: number;
}

/** A collapsed paragraph edge may cross only to its direct code sibling. */
export function codeBoundaryAt(state: EditorState, selection: Selection, backward: boolean): CodeBoundary | null {
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$head.doc !== state.doc) return null;
  const at = selection.$head;
  if (at.depth < 1 || at.parent.type.name !== 'paragraph'
    || at.parentOffset !== (backward ? 0 : at.parent.content.size)) return null;
  const container = at.node(-1), paragraphIndex = at.index(-1);
  const code = container.maybeChild(paragraphIndex + (backward ? -1 : 1));
  if (!code || !isCodeBlock(code.type.name)) return null;
  return {
    selection, code, container, paragraphIndex, backward,
    position: backward ? at.before() - code.nodeSize : at.after(),
  };
}

/** This native range is an IME bridge only while its originating document lives. */
export function isEmptyCodeBridge(boundary: CodeBoundary, selection: Selection) {
  if (boundary.code.content.size || boundary.selection.$head.doc !== selection.$head.doc || selection.empty) return false;
  return selection.from === boundary.position && selection.to === boundary.position + boundary.code.nodeSize
    || selection.from === Math.min(boundary.position + 1, boundary.selection.head)
      && selection.to === Math.max(boundary.position + 1, boundary.selection.head);
}
