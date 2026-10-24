import { blockquoteSchema } from '@milkdown/kit/preset/commonmark';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose, $remark } from '@milkdown/kit/utils';
import remarkFoldingQuotes from '../../shared/remark-folding-quotes.mjs';
import { foldHeadingAt, foldingMarker, foldingDraft } from './foldingQuoteEditing';

export const foldingQuoteRemark = $remark('foldingQuotes', () => remarkFoldingQuotes);
export const foldingQuoteSchema = blockquoteSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return {
    ...schema,
    attrs: { ...schema.attrs, folding: { default: null }, foldingDraft: { default: false } },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        state.openNode(type, { folding: typeof node.folding === 'boolean' ? node.folding : null, foldingDraft: !!node.foldingDraft }).next(node.children).closeNode();
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        state.openNode('blockquote', undefined, { folding: node.attrs.folding, foldingDraft: node.attrs.foldingDraft }).next(node.content).closeNode();
      },
    },
  };
});

const key = new PluginKey<Map<number, boolean>>('foldingQuotes');
const marker = foldingMarker;
export const foldingQuotes = $prose(() => new Plugin({
  key,
  view(view) {
    const document = view.dom.ownerDocument;
    let settling = false;
    const settle = () => {
      if (settling || view.isDestroyed || view.composing || !view.hasFocus()) return;
      const native = document.getSelection();
      if (!native?.isCollapsed || !native.anchorNode || !view.dom.contains(native.anchorNode)) return;
      try {
        const pos = view.posAtDOM(native.anchorNode, native.anchorOffset), heading = foldHeadingAt(view.state.doc, pos);
        if (!heading || pos > heading.start) return;
        const point = view.domAtPos(heading.start, -1);
        if (native.anchorNode === point.node && native.anchorOffset === point.offset) return;
        settling = true;
        if (!view.state.selection.empty || view.state.selection.head !== heading.start)
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.start)));
        const range = document.createRange();
        range.setStart(point.node, point.offset);range.collapse(true);
        native.removeAllRanges();native.addRange(range);
      } catch { /* The editor can replace a heading while the browser reads selection. */ }
      finally { settling = false; }
    };
    document.addEventListener('selectionchange', settle);
    return { update: settle, destroy() { document.removeEventListener('selectionchange', settle); } };
  },
  state: {
    init: () => new Map(),
    apply(tr, old) {
      const next = new Map<number, boolean>();
      for (const [pos, open] of old) {
        const mapped = tr.mapping.mapResult(pos, 1);
        const node = tr.doc.nodeAt(mapped.pos), previous = tr.before.nodeAt(pos);
        if (!mapped.deleted && node?.type.name === 'blockquote' && typeof node.attrs.folding === 'boolean'
          && previous?.attrs.folding === node.attrs.folding) next.set(mapped.pos, open);
      }
      const toggle = tr.getMeta(key) as { pos: number; open: boolean } | undefined;
      if (toggle) next.set(toggle.pos, toggle.open);
      // Navigation/search into a folded body exposes the caret. Moving around
      // its heading does not override the default collapsed state.
      if (!toggle && tr.selectionSet && tr.selection instanceof TextSelection) {
        const at = tr.selection.$from;
        for (let depth = 1; depth < at.depth; depth++) {
          if (at.node(depth).type.name === 'blockquote' && at.node(depth).attrs.folding !== null && at.index(depth) > 0) next.set(at.before(depth), true);
        }
      }
      return next;
    },
  },
  appendTransaction(transactions, _old, state) {
    const tr = state.tr;
    if (transactions.some(tr => tr.docChanged)) state.doc.descendants((node, pos) => {
      if (node.type.name !== 'blockquote') return;
      const first = node.firstChild?.type.name === 'paragraph' ? node.firstChild.firstChild : null;
      const text = first?.isText ? first.text! : '', match = text.match(marker);
      const folding = match ? match[1] === '+' : null, draft = foldingDraft.test(text);
      if (node.attrs.folding !== folding || node.attrs.foldingDraft !== draft)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, folding, foldingDraft: draft });
    });
    const heading = tr.selection.empty ? foldHeadingAt(tr.doc, tr.selection.head) : null;
    if (heading && tr.selection.head < heading.start)
      tr.setSelection(TextSelection.create(tr.doc, heading.start));
    return tr.docChanged || tr.selectionSet ? tr : null;
  },
  props: {
    decorations(state) {
      const decorations: Decoration[] = [], openStates = key.getState(state)!;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'blockquote' || typeof node.attrs.folding !== 'boolean' || node.firstChild?.type.name !== 'paragraph') return;
        const prefix = node.firstChild.textContent.match(marker)?.[0];
        if (!prefix) return;
        const open = openStates.get(pos) ?? node.attrs.folding;
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'folding-quote', 'data-fold-open': String(open) }));
        decorations.push(Decoration.inline(pos + 2, pos + 2 + prefix.length, { class: 'folding-quote-marker' }));
        decorations.push(Decoration.widget(pos + 2, view => {
          const button = document.createElement('button');
          button.type = 'button';button.className = 'folding-quote-toggle';button.contentEditable = 'false';
          button.setAttribute('aria-expanded', String(open));button.setAttribute('aria-label', (open ? '折叠：' : '展开：') + node.firstChild!.textContent.slice(prefix.length));
          button.title = open ? '折叠' : '展开';
          button.onmousedown = event => event.preventDefault();
          button.onclick = event => {
            event.preventDefault();event.stopPropagation();
            const tr = view.state.tr;
            if (open && tr.selection.from > pos + 1 + node.firstChild!.nodeSize && tr.selection.from < pos + node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, pos + node.firstChild!.nodeSize));
            view.dispatch(tr.setMeta(key, { pos, open: !open }).setMeta('addToHistory', false));
          };
          return button;
        }, { key: `${pos}:${open}:${node.firstChild.textContent}`, side: -1, ignoreSelection: true }));
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
}));
