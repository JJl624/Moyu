import { blockquoteSchema } from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $inputRule, $prose, $remark } from '@milkdown/kit/utils';
import remarkFoldingQuotes from '../../shared/remark-folding-quotes.mjs';

export const foldingQuoteRemark = $remark('foldingQuotes', () => remarkFoldingQuotes);
export const foldingQuoteSchema = blockquoteSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return {
    ...schema,
    attrs: { ...schema.attrs, folding: { default: null } },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        state.openNode(type, { folding: typeof node.folding === 'boolean' ? node.folding : null }).next(node.children).closeNode();
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        state.openNode('blockquote', undefined, { folding: node.attrs.folding }).next(node.content).closeNode();
      },
    },
  };
});

export const foldingQuoteInput = $inputRule(() => new InputRule(/^\[([+-])\]$/, (state, match, start, end) => {
  const at = state.doc.resolve(start);
  if (at.parent.type.name !== 'paragraph' || at.depth < 2 || at.index(-1) !== 0 || at.node(-1).type.name !== 'blockquote') return null;
  return state.tr.insertText(match[0], start, end).setNodeMarkup(at.before(-1), undefined, { ...at.node(-1).attrs, folding: match[1] === '+' });
}));

const key = new PluginKey<Map<number, boolean>>('foldingQuotes');
const marker = /^\[[+-]\][ \t]*/;
export const foldingQuotes = $prose(() => new Plugin({
  key,
  state: {
    init: () => new Map(),
    apply(tr, old) {
      const next = new Map<number, boolean>();
      for (const [pos, open] of old) {
        const mapped = tr.mapping.mapResult(pos, 1);
        if (!mapped.deleted && tr.doc.nodeAt(mapped.pos)?.type.name === 'blockquote') next.set(mapped.pos, open);
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
