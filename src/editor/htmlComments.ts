import { TextSelection } from '@milkdown/kit/prose/state';
import { Plugin } from '@milkdown/kit/prose/state';
import { $nodeSchema, $prose } from '@milkdown/kit/utils';

// Raw comments are document text, never executable DOM or an atomic HTML node.
// Block comments retain their newlines and do not become fenced code blocks.
export const htmlCommentSchema = $nodeSchema('html_comment', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'div[data-html-comment]' }],
  toDOM: () => ['div', { 'data-html-comment': 'true', class: 'markdown-comment comment-block' }, 0],
  parseMarkdown: {
    match: node => node.type === 'commentBlock',
    runner(state, node, type) {
      state.openNode(type);
      if (node.value) state.addText(String(node.value));
      state.closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'html_comment',
    runner(state, node) {
      state.addNode('html', undefined, node.textContent);
    },
  },
}));
export const htmlCommentKeys = $prose(() =>
  new Plugin({
    props: {
      handleKeyDown(view, event) {
        const selection = view.state.selection;
        const parent = selection.$from.parent;
        const block = parent.type.name === 'html_comment';
        if (!block && !(parent.type.name === 'resource_link' && /^<!--/.test(parent.textContent))) {
          return false;
        }
        if (event.key !== 'Enter') return false;
        if (!block && (event.ctrlKey || event.metaKey)) return false;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const end = selection.$from.after(),
            paragraph = view.state.schema.nodes.paragraph.create();
          const tr = view.state.tr.insert(end, paragraph);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
        } else view.dispatch(view.state.tr.insertText('\n').scrollIntoView());
        return true;
      },
    },
  })
);
