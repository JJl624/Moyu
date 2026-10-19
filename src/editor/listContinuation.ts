import { Fragment, type Node } from '@milkdown/kit/prose/model';
import { type EditorState, NodeSelection, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export function resourceBlockPosition(view: EditorView, target: HTMLElement) {
  const sourceId = target.closest<HTMLElement>('.attachment-overlay')?.id;
  const source = sourceId ? view.dom.querySelector<HTMLElement>(`[data-attachment-preview="${sourceId}"]`) : target;
  let found: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (!['table', 'code_block', 'paragraph', 'math_block'].includes(node.type.name)) return;
    const dom = view.nodeDOM(pos);
    if (dom && source && dom.contains(source)) {
      found = pos;
      return false;
    }
  });
  return found;
}
export function indentBlockIntoList(state: EditorState, pos: number, dispatch?: (tr: Transaction) => void) {
  const at = state.doc.resolve(pos), block = state.doc.nodeAt(pos);
  if (!block || !['table', 'code_block', 'paragraph', 'math_block'].includes(block.type.name)) return false;
  let index = at.index() - 1;
  // Keep real blank paragraphs as part of the moved continuation.
  while (index >= 0 && at.parent.child(index).type.name === 'paragraph' && !at.parent.child(index).content.size) {
    index--;
  }
  if (index < 0) return false;
  const list = at.parent.child(index);
  if (!['bullet_list', 'ordered_list'].includes(list.type.name)) return false;
  const item = list.lastChild!;
  if (item.type.name !== 'list_item') return false;
  const additions: Node[] = [];
  for (let i = index + 1; i < at.index(); i++) additions.push(at.parent.child(i));
  additions.push(block);
  const content = item.content.append(Fragment.fromArray(additions));
  if (!item.type.validContent(content)) return false;
  let listPos = at.start();
  for (let i = 0; i < index; i++) listPos += at.parent.child(i).nodeSize;
  if (dispatch) {
    const updated = list.copy(list.content.replaceChild(list.childCount - 1, item.copy(content)));
    const tr = state.tr.replaceWith(listPos, pos + block.nodeSize, updated);
    const moved = listPos + updated.nodeSize - block.nodeSize - 2;
    tr.setSelection(
      block.type.name === 'table' ? NodeSelection.create(tr.doc, moved) : TextSelection.near(tr.doc.resolve(moved + 1)),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// Split the containing list around this block, keeping the remainder of the
// item valid even when it begins with another resource rather than a paragraph.
export function outdentBlockFromList(state: EditorState, pos: number, dispatch?: (tr: Transaction) => void) {
  const at = state.doc.resolve(pos), block = state.doc.nodeAt(pos);
  if (
    !block || !['table', 'code_block', 'paragraph', 'math_block'].includes(block.type.name)
    || at.parent.type.name !== 'list_item' || at.depth < 2
  ) return false;
  const list = at.node(-1);
  if (!['bullet_list', 'ordered_list'].includes(list.type.name)) return false;
  const item = at.parent, itemIndex = at.index(-1), listPos = at.before(at.depth - 1);
  const beforeItem = item.content.cut(0, at.parentOffset);
  const afterItem = item.content.cut(at.parentOffset + block.nodeSize);
  const prefix = beforeItem.size ? item.type.createAndFill(item.attrs, beforeItem) : null;
  const suffix = afterItem.size ? item.type.createAndFill(item.attrs, afterItem) : null;
  if ((beforeItem.size && !prefix) || (afterItem.size && !suffix)) return false;
  let itemStart = 0;
  for (let i = 0; i < itemIndex; i++) itemStart += list.child(i).nodeSize;
  const before = list.content.cut(0, itemStart), itemEnd = itemStart + item.nodeSize;
  const after = list.content.cut(itemEnd);
  const left = before.append(prefix ? Fragment.from(prefix) : Fragment.empty);
  const right = (suffix ? Fragment.from(suffix) : Fragment.empty).append(after);
  const nodes: Node[] = [];
  if (left.size) nodes.push(list.copy(left));
  nodes.push(block);
  if (right.size) {
    nodes.push(list.type.create(
      list.type.name === 'ordered_list'
        ? { ...list.attrs, order: (list.attrs.order ?? 1) + itemIndex + (suffix ? 0 : 1) }
        : list.attrs,
      right,
    ));
  }
  const parent = at.node(-2), index = at.index(-2);
  if (!parent.canReplace(index, index + 1, Fragment.fromArray(nodes))) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, nodes);
    const moved = listPos + (left.size ? nodes[0].nodeSize : 0);
    tr.setSelection(
      block.type.name === 'table' ? NodeSelection.create(tr.doc, moved) : TextSelection.near(tr.doc.resolve(moved + 1)),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
}
