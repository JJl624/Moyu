import { sinkListItem, liftListItem } from '@milkdown/kit/prose/schema-list';
import { type EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state';

export function indentText(state: EditorState, dispatch: (tr: Transaction) => void, backwards: boolean, width: number) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$head.parent.inlineContent
    || selection.$head.parent.type.spec.code && selection.$head.parent.type.name !== 'resource_link') return false;
  const { $head } = selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    if ($head.node(depth).type.name === 'list_item') {
      const command = backwards ? liftListItem($head.node(depth).type) : sinkListItem($head.node(depth).type);
      command(state, dispatch);
      // A first item cannot sink without a preceding item. Consume Tab anyway:
      // falling through would indent its source or move focus out of the editor.
      return true;
    }
  }
  const size = Number.isInteger(width) && width > 0 && width <= 16 ? width : 4;
  const tr = state.tr;
  const inSource = $head.parent.type.name === 'resource_link';
  if (selection.empty && !backwards) {
    let pos = selection.head, enter = false;
    if (inSource && $head.parentOffset === 0) { pos = $head.before(); enter = true; }
    else if (inSource && $head.parentOffset === $head.parent.content.size) pos = $head.after();
    tr.insertText(' '.repeat(size), pos);
    tr.setSelection(TextSelection.create(tr.doc, pos + size + (enter ? 1 : 0)));
  } else {
    const blocks: { pos: number; spaces: number }[] = [];
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (!node.isTextblock || node.type.spec.code) return;
      const text = node.firstChild?.isText ? node.firstChild.text! : '';
      blocks.push({ pos: pos + 1, spaces: Math.min(size, text.match(/^ */)?.[0].length || 0) });
      return false;
    });
    for (const block of blocks.reverse()) {
      if (backwards) { if (block.spaces) tr.delete(block.pos, block.pos + block.spaces); }
      else tr.insertText(' '.repeat(size), block.pos);
    }
  }
  if (tr.docChanged) dispatch(tr.scrollIntoView());
  return true;
}
