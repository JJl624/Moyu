import { EditorView as CodeView } from '@codemirror/view';
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list';
import { type Command, EditorState, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { BlockAction, EditorAction, EditorContext } from '../editorTypes';
import { canInsertInlineDrawing } from './drawingInsertion';
import { resourceBlockPosition } from './listContinuation';
import { addQuoteLayer, removeQuoteLayer } from './quoteEditing';
import { formatInline } from './inlineFormatting';
import { richFormatState } from './richFormatState';
import { inlineKinds } from './inlineFormatState';

export const contextCommands: Partial<Record<EditorAction | BlockAction, Command>> = {
  bold: formatInline('strong'),
  italic: formatInline('emphasis'),
  strike: formatInline('delete'),
  code: formatInline('inlineCode'),
  highlight: formatInline('highlight'),
  underline: formatInline('underline'),
  math: formatInline('inlineMath'),
  link: formatInline('link'),
  quote: addQuoteLayer,
  unquote: removeQuoteLayer,
  indent: (state, dispatch) => sinkListItem(state.schema.nodes.list_item)(state, dispatch),
  outdent: (state, dispatch) => liftListItem(state.schema.nodes.list_item)(state, dispatch),
  rowAfter: addRowAfter,
  columnAfter: addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable: (state, dispatch) => {
    if (state.selection instanceof NodeSelection && state.selection.node.type.name === 'table') {
      dispatch?.(state.tr.deleteSelection().scrollIntoView());
      return true;
    }
    return deleteTable(state, dispatch);
  },
  selectTable: (state, dispatch) => {
    if (state.selection instanceof NodeSelection && state.selection.node.type.name === 'table') return true;
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'table') {
        dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(depth))));
        return true;
      }
    }
    return false;
  },
};

export function prepareRichContext(view: EditorView, target: HTMLElement, coords: { left: number; top: number }): EditorContext | null {
  const preview = target.closest<HTMLElement>('.attachment-overlay');
  if (!preview && !view.dom.contains(target)) return null;
  const doc = view.state.doc;
  let selection = view.state.selection;
  try {
    const codeElement = target.closest<HTMLElement>('.cm-editor');
    if (codeElement) {
      const code = CodeView.findFromDOM(codeElement), pos = resourceBlockPosition(view, target);
      if (code && pos !== undefined) {
        const offset = pos + 1 + (Number(code.dom.dataset.codeSourceOffset) || 0);
        selection = TextSelection.create(doc, offset + code.state.selection.main.anchor, offset + code.state.selection.main.head);
      }
    } else {
      const native = view.dom.ownerDocument.getSelection();
      const element = native?.anchorNode instanceof Element ? native.anchorNode : native?.anchorNode?.parentElement;
      const focusElement = native?.focusNode instanceof Element ? native.focusNode : native?.focusNode?.parentElement;
      if (native?.anchorNode && native.focusNode && view.dom.contains(native.anchorNode)
        && view.dom.contains(native.focusNode) && !element?.closest('.cm-editor,.syntax-preview')
        && !focusElement?.closest('.cm-editor,.syntax-preview')) {
        const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset), head = view.posAtDOM(native.focusNode, native.focusOffset);
        if (doc.resolve(anchor).parent.inlineContent && doc.resolve(head).parent.inlineContent) {
          selection = TextSelection.create(doc, anchor, head);
        }
      }
      const block = resourceBlockPosition(view, target);
      const border = target.closest('.milkdown-table-block,table') && !target.closest('td,th');
      const point = preview ? (block === undefined ? undefined : block + 1) : view.posAtCoords(coords)?.pos;
      if (border && block !== undefined && doc.nodeAt(block)?.type.name === 'table') {
        selection = NodeSelection.create(doc, block);
      } else if (point !== undefined && (selection.empty || point < selection.from || point > selection.to)) {
        selection = TextSelection.near(doc.resolve(point));
      }
    }
  } catch { return null; }
  // Query commands without dispatching transactions or revealing an attachment
  // just because its context menu opened. Reject stale menus after a doc edit.
  const query = EditorState.create({ doc, selection });
  const restore = () => {
    if (view.isDestroyed || view.state.doc !== doc) return false;
    if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
    return true;
  };
  return {
    text: selection.empty ? '' : doc.textBetween(selection.from, selection.to, '\n'),
    textFor: type => {
      const matches = (name: string) => type === 'cell' ? ['table_cell', 'table_header'].includes(name) : name === type;
      let node = selection instanceof NodeSelection && matches(selection.node.type.name) ? selection.node : undefined;
      for (let depth = selection.$from.depth; !node && depth > 0; depth--) {
        if (matches(selection.$from.node(depth).type.name)) node = selection.$from.node(depth);
      }
      if (!node) return '';
      if (type === 'table') {
        const rows: string[] = [];
        node.forEach(row => {
          const cells: string[] = [];
          row.forEach(cell => cells.push(cell.textBetween(0, cell.content.size, '\n')));
          rows.push(cells.join('\t'));
        });
        return rows.join('\n');
      }
      const text = node.textBetween(0, node.content.size, '\n');
      return type === 'heading' ? text.replace(/^#{1,6}\s+/, '') : text;
    },
    canInsertDrawing: canInsertInlineDrawing(query),
    active: action=>!!inlineKinds[action]&&richFormatState(query,inlineKinds[action]).active,
    can: action => !!contextCommands[action]?.(query),
    run: action => {
      const command = contextCommands[action];
      if (!command?.(query) || !restore()) return false;
      const result = command(view.state, view.dispatch);
      view.focus();
      return result;
    },
    restore,
  };
}
