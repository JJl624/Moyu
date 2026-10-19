import { Prec } from '@codemirror/state';
import { type EditorView as CodeView, keymap } from '@codemirror/view';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { Fragment } from '@milkdown/kit/prose/model';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { type Command, NodeSelection, Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection, deleteTable } from '@milkdown/kit/prose/tables';
import { $prose } from '@milkdown/kit/utils';

// An empty continuation after a block first becomes a sibling item. An empty
// item then lifts one level per Enter, including the final exit to a paragraph.
export const continueList: Command = (state, dispatch) => {
  const { empty, $from, $to } = state.selection;
  if (
    !empty || !$from.sameParent($to) || $from.parent.type.name !== 'paragraph'
    || $from.parent.content.size || $from.depth < 2
  ) return false;
  const item = $from.node(-1);
  if (item.type.name !== 'list_item') return false;
  if (item.childCount === 1) return liftListItem(item.type)(state, dispatch);
  const index = $from.index(-1);
  if (index !== item.childCount - 1 || index === 0) return false;
  const retained = item.copy(item.content.cut(0, item.content.size - $from.parent.nodeSize));
  const next = item.type.create({
    ...item.attrs,
    checked: item.attrs.checked == null ? item.attrs.checked : false,
  }, state.schema.nodes.paragraph.create());
  const position = $from.before($from.depth - 1);
  if (dispatch) {
    const tr = state.tr.replaceWith(
      position,
      position + item.nodeSize,
      Fragment.fromArray([retained, next]),
    );
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, position + retained.nodeSize + 2))
        .scrollIntoView(),
    );
  }
  return true;
};

export function leaveCodeBlock(view: import('@milkdown/kit/prose/view').EditorView, pos: number) {
  if (!view.editable) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !['code_block','math_block'].includes(node.type.name)) return false;
  const $start = view.state.doc.resolve(pos),
    position = pos + node.nodeSize,
    parent = $start.parent,
    index = $start.index() + 1;
  if (!parent.canReplaceWith(index, index, view.state.schema.nodes.paragraph)) return false;
  const tr = view.state.tr;
  const next = parent.maybeChild(index);
  if (next?.type.name !== 'paragraph') {
    tr.insert(position, view.state.schema.nodes.paragraph.create());
  }
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, position + 1)).scrollIntoView());
  view.focus();
  return true;
}
export function codeExitKeys(ctx: Ctx) {
  const leave = (code: CodeView) => {
    if (!code.state.selection.main.empty) return false;
    const view = ctx.get(editorViewCtx);
    let position: number | undefined;
    view.state.doc.descendants((node, pos) => {
      if (position !== undefined) return false;
      if (!['code_block','math_block'].includes(node.type.name)) return;
      const dom = view.nodeDOM(pos);
      if (dom?.contains(code.dom)) position = pos;
      return false;
    });
    return position !== undefined && leaveCodeBlock(view, position);
  };
  return Prec.highest(keymap.of([
    {
      key: 'ArrowDown',
      run: code =>
        code.state.doc.lineAt(code.state.selection.main.head).to === code.state.doc.length
        && leave(code),
    },
    {
      key: 'ArrowRight',
      run: code => code.state.selection.main.head === code.state.doc.length && leave(code),
    },
    { key: 'Mod-Enter', run: leave },
  ]));
}

export const tableDeleteKeys = $prose(() =>
  new Plugin({
    props: {
      handleDOMEvents: {
        keydown(view, event) {
          if (view.composing || event.isComposing || !['Backspace', 'Delete'].includes(event.key)) {
            return false;
          }
          const selection = view.state.selection,
            whole = selection instanceof NodeSelection && selection.node.type.name === 'table'
              || selection instanceof CellSelection && selection.isRowSelection()
                && selection.isColSelection();
          if (!whole || !deleteTable(view.state, view.dispatch)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  })
);
