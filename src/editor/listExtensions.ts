import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose, $view } from '@milkdown/kit/utils';
import { continueList } from './blockNavigation';

// Chromium can deliver a key before its selectionchange has been read.
// Synchronize list text selections using public ProseMirror position APIs,
// before structural keymaps act. Code editors and table cell selections keep
// their own keyboard handling; composition is never interrupted.
export const syncListTextSelection = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          keydown(view, event) {
            if (
              view.composing
              || event.isComposing
              || !view.hasFocus()
              || !['Tab', 'Enter'].includes(event.key)
              || !(view.state.selection instanceof TextSelection)
            ) {
              return false;
            }
            const selection = view.dom.ownerDocument.getSelection();
            if (
              !selection?.anchorNode
              || !selection.focusNode
              || !view.dom.contains(selection.anchorNode)
              || !view.dom.contains(selection.focusNode)
            ) {
              return false;
            }
            try {
              const anchor = view.state.doc.resolve(
                view.posAtDOM(selection.anchorNode, selection.anchorOffset),
              );
              const head = view.state.doc.resolve(
                view.posAtDOM(selection.focusNode, selection.focusOffset),
              );
              if (!['paragraph', 'heading'].includes(anchor.parent.type.name)) {
                return false;
              }
              const ancestors = Array.from(
                { length: anchor.depth },
                (_, index) => anchor.node(index + 1).type.name,
              );
              if (
                !ancestors.includes('list_item')
                || ancestors.some((name) => name.startsWith('table'))
              ) {
                return false;
              }
              const current = TextSelection.between(anchor, head);
              if (!current.eq(view.state.selection)) {
                view.dispatch(view.state.tr.setSelection(current));
              }
            } catch {
              // DOM may be changing during a paste; let ProseMirror finish reading it.
            }
            if (
              event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey
              && !event.altKey && continueList(view.state, view.dispatch)
            ) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
      },
    }),
);

// extendSchema starts from its own factory, not the last installed extension.
// Start with GFM so checked attributes and task serialization remain intact.
export const headingListItems = extendListItemSchemaForTask.extendSchema(
  (previous) => (ctx) => ({
    ...previous(ctx),
    content: '(paragraph | heading) block*',
  }),
);

// Crepe's Vue view restores the captured selection on a scheduled mount.
// Use a synchronous view and let ProseMirror own the current selection.
export const stableListItemView = $view(
  listItemSchema.node,
  () => (initial, view, getPos) => {
    let node = initial;
    const dom = document.createElement('div');
    dom.className = 'milkdown-list-item-block';
    const item = document.createElement('li');
    item.className = 'list-item';
    const marker = document.createElement('div');
    marker.className = 'label-wrapper';
    marker.contentEditable = 'false';
    const label = document.createElement('button');
    label.type = 'button';
    marker.append(label);
    const children = document.createElement('div');
    children.className = 'children';
    const contentDOM = document.createElement('div');
    contentDOM.className = 'content-dom';
    contentDOM.dataset.contentDom = 'true';
    children.append(contentDOM);
    item.append(marker, children);
    dom.append(item);
    function render() {
      const { checked, label: text, listType } = node.attrs;
      const task = checked !== null && checked !== undefined;
      label.className = `label ${
        task ? (checked ? 'checked' : 'unchecked') : listType === 'ordered' ? 'ordered' : 'bullet'
      }`;
      label.textContent = task ? (checked ? '☑' : '☐') : String(text);
      label.tabIndex = task ? 0 : -1;
      label.disabled = !view.editable;
      if (task) {
        label.setAttribute('role', 'checkbox');
        label.setAttribute('aria-checked', String(checked));
        label.setAttribute('aria-label', '完成列表任务');
      } else {
        label.removeAttribute('role');
        label.removeAttribute('aria-checked');
        label.removeAttribute('aria-label');
        label.setAttribute('aria-hidden', 'true');
      }
    }
    function toggle() {
      if (!view.editable || node.attrs.checked == null) return;
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(
        view.state.tr.setNodeAttribute(pos, 'checked', !node.attrs.checked),
      );
    }
    // Preserve the text cursor when clicking a task marker.
    label.onpointerdown = (event) => event.preventDefault();
    label.onclick = (event) => {
      event.preventDefault();
      if (node.attrs.checked != null) toggle();
      else {
        const pos = getPos();
        if (pos === undefined || !view.editable) return;
        const source = node.firstChild?.firstChild?.type.name === 'resource_link';
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, pos + 2 + (source ? 1 : 0)),
          ),
        );
        view.focus();
      }
    };
    render();
    return {
      dom,
      contentDOM,
      update(updated) {
        if (updated.type !== node.type) return false;
        node = updated;
        render();
        return true;
      },
      selectNode() {
        dom.classList.add('selected');
        item.classList.add('ProseMirror-selectednode');
      },
      deselectNode() {
        dom.classList.remove('selected');
        item.classList.remove('ProseMirror-selectednode');
      },
      ignoreMutation(mutation) {
        if (mutation.type === 'selection') return false;
        if (mutation.target === contentDOM && mutation.type === 'attributes') {
          return true;
        }
        return !contentDOM.contains(mutation.target);
      },
      stopEvent(event) {
        return marker.contains(event.target as globalThis.Node);
      },
      destroy() {
        label.onpointerdown = null;
        label.onclick = null;
      },
    };
  },
);
