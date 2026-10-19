import { commandsCtx, type Editor } from '@milkdown/kit/core';
import {
  headingSchema,
  turnIntoTextCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { type Command, Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $inputRule, $prose } from '@milkdown/kit/utils';
// Source headings already contain their markers. The commonmark input rule
// adds their count to the current heading level when composition ends, even
// without new input. Only convert paragraphs and retain the typed prefix in
// the same transaction, so no appended marker insertion can be replayed.
export function createSourceHeadingRule() {
  return new InputRule(/^(#{1,6})[ \t]$/, (state, match, start, end) => {
    const from = state.doc.resolve(start), type = state.schema.nodes.heading;
    if (
      from.parent.type.name !== 'paragraph' || from.parentOffset !== 0
      || !from.node(-1).canReplaceWith(from.index(-1), from.indexAfter(-1), type)
    ) return null;
    return state.tr.insertText(match[0], start, end).setBlockType(start, start, type, {
      level: match[1].length,
      sourceHeading: true,
    });
  }, { undoable: false });
}
export const sourceHeadingInputRule = $inputRule(() => createSourceHeadingRule());
export const sourceHeadings = headingSchema.extendSchema(previous => ctx => {
  const schema = previous(ctx);
  return {
    ...schema,
    attrs: { ...schema.attrs, sourceHeading: { default: false } },
    toDOM(node) {
      const prefix = node.textContent.match(/^#{1,6}[ \t]+/)?.[0] || '';
      return schema.toDOM!(
        node.type.create(node.attrs, node.content.cut(prefix.length), node.marks),
      );
    },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        const level = Number(node.depth) || 1;
        state.openNode(type, { level, sourceHeading: true });
        state.addText('#'.repeat(level) + ' ');
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        const prefix = node.textContent.match(/^#{1,6}[ \t]+/)?.[0] || '';
        state.openNode('heading', undefined, { depth: node.attrs.level });
        state.next(node.content.cut(prefix.length));
        state.closeNode();
      },
    },
  };
});
export function setSourceHeading(level: number): Command {
  return (state, dispatch) => {
    const changes: { pos: number; prefix: number }[] = [];
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        changes.push({
          pos,
          prefix: node.type.name === 'heading'
            ? node.textContent.match(/^#{1,6}[ \t]+/)?.[0].length || 0
            : 0,
        });
        return false;
      }
    });
    if (!changes.length) return false;
    const tr = state.tr;
    for (const { pos, prefix } of changes.reverse()) {
      if (prefix) tr.delete(pos + 1, pos + 1 + prefix);
      tr.setNodeMarkup(
        pos,
        state.schema.nodes[level ? 'heading' : 'paragraph'],
        level ? { level, sourceHeading: true } : undefined,
      );
      if (level) tr.insertText('#'.repeat(level) + ' ', pos + 1);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}
export function installHeadingCommands(ctx: Parameters<Parameters<Editor['action']>[0]>[0]) {
  const commands = ctx.get(commandsCtx);
  commands.create(wrapInHeadingCommand.key, level => setSourceHeading(level || 1));
  commands.create(turnIntoTextCommand.key, () => setSourceHeading(0));
}
export const headingSource = $prose(() =>
  new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const changes: { pos: number; level: number; old: number; initialize: boolean }[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;
        const prefix = node.textContent.match(/^#{1,6}[ \t]+/)?.[0] || '';
        const level = prefix.trim().length;
        if (!node.attrs.sourceHeading || level !== node.attrs.level) {
          changes.push({
            pos,
            level: node.attrs.sourceHeading ? level : node.attrs.level,
            old: prefix.length,
            initialize: !node.attrs.sourceHeading,
          });
        }
      });
      if (!changes.length) return null;
      const tr = state.tr;
      for (const item of changes.reverse()) {
        if (!item.level) {
          tr.setNodeMarkup(item.pos, state.schema.nodes.paragraph);
          continue;
        }
        const node = tr.doc.nodeAt(item.pos)!;
        tr.setNodeMarkup(item.pos, undefined, {
          ...node.attrs,
          level: item.level,
          sourceHeading: true,
        });
        if (item.initialize) {
          tr.insertText('#'.repeat(item.level) + ' ', item.pos + 1, item.pos + 1 + item.old);
        }
      }
      return tr;
    },
    props: {
      decorations(state) {
        const result: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading' || !node.attrs.sourceHeading) return;
          const prefix = node.textContent.match(/^#{1,6}[ \t]+/)?.[0];
          if (!prefix) {
            return;
          }
          const active = state.selection.from <= pos + node.nodeSize && state.selection.to >= pos;
          result.push(
            Decoration.inline(pos + 1, pos + 1 + prefix.length, {
              class: 'moyu-heading-marker' + (active ? '' : ' hidden-marker'),
            }),
          );
        });
        return DecorationSet.create(state.doc, result);
      },
    },
  })
);
