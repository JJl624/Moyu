import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const documentTail = $prose(() => new Plugin({
  view(view) {
    const parent = view.dom.parentElement!, scope = view.dom.closest('.document-scroll') || parent;
    const tail = (event: MouseEvent) => {
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        || view.composing || !view.editable
        || ![scope, parent, view.dom].includes(event.target as HTMLElement)) return;
      const doc = view.state.doc, last = doc.lastChild;
      if (!last) return;
      const dom = view.nodeDOM(doc.content.size - last.nodeSize);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect(), body = view.dom.getBoundingClientRect();
      if (event.clientY <= rect.bottom + 2 || event.clientX < body.left || event.clientX > body.right) return;
      event.preventDefault();
      event.stopPropagation();
      const tr = view.state.tr;
      if (last.type.name === 'paragraph' && !last.content.size) {
        tr.setSelection(TextSelection.create(doc, doc.content.size - 1));
      } else {
        tr.insert(doc.content.size, view.state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    };
    scope.addEventListener('mousedown', tail as EventListener);
    return { destroy: () => scope.removeEventListener('mousedown', tail as EventListener) };
  },
}));
