import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { codeId, withAttribute } from "../../shared/code-documents.mjs";
import { idFloor, reserveIds, exhaustedIdsMessage } from "../codeIds";
export { exhaustedIdsMessage } from '../codeIds';
export function codeIdTransaction(state: EditorState, root: string | undefined, path: string) {
  const seen = new Set<string>();
  let next = idFloor(root, path), tr = state.tr, exhausted = false;
  state.doc.descendants(node => {
    if (node.type.name !== 'code_block') return;
    const id = codeId(node.attrs.meta || '');
    if (id) next = Math.max(next, parseInt(id, 16) + 1);
  });
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return;
    if (!node.attrs.language) tr = tr.setNodeAttribute(pos, 'language', 'text');
    let id = codeId(node.attrs.meta || '');
    if (!id || seen.has(id)) {
      if (next > 0xffff) { exhausted = true; id = ''; }
      else id = (next++).toString(16).padStart(4, '0');
      const meta = withAttribute(node.attrs.meta || '', 'id', id);
      if (meta !== (node.attrs.meta || '')) tr = tr.setNodeAttribute(pos, 'meta', meta);
    }
    if (id) seen.add(id);
  });
  reserveIds(root, path, next);
  return { transaction: tr, exhausted };
}
export const stableCodeIds = (root: string | undefined, path: string, ready = () => true, onError = (_message: string) => {}) =>
  $prose(() => {
    let notified = false;
    return new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!ready() || !transactions.some(t => t.docChanged)) return null;
        const result = codeIdTransaction(state, root, path);
        if (result.exhausted && !notified) { notified = true; onError(exhaustedIdsMessage); }
        return result.transaction.docChanged ? result.transaction : null;
      },
    });
  });
