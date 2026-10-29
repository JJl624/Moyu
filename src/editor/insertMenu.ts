import {api} from '../bridge';
import { isComposingKey } from '../keyboardComposition';
import { createTable } from '@milkdown/kit/preset/gfm';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { canInsertInlineDrawing } from './drawingInsertion';
import { readNativeSelection, focusEditorSelection } from './selectionOwnership';

// The stock slash menu clears the entire paragraph and only opens at its
// beginning. Track the inserted slash separately so surrounding text survives.
export const insertMenu = (drawing: () => void, score?:()=>void) =>
  $prose(ctx => {
    let token: number | null = null, menu: HTMLElement | null = null, selected = 0;
    const items = [{ label: '代码块', icon: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>' }, {
      label: '表格',
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
    }, { label: 'Excalidraw 绘图', icon: '<path d="m4 20 4-1L20 7l-3-3L5 16Z"/>' },...(api.platform==='win32'&&score?[{label:'乐谱',icon:'<path d="M9 18V5l12-2v13M9 9l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'}]:[])];
    return new Plugin({
      view(view) {
        menu = document.createElement('div');
        menu.className = 'moyu-insert-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', '插入');
        menu.hidden = true;
        (view.dom.closest('.app') || document.body).append(menu);
        const hide = () => {
          token = null;
          menu!.hidden = true;
        };
        const run = (index: number) => {
          if (token === null || view.composing) return;
          const s = view.state.selection, end = s.from;
          const allowed = canInsertInlineDrawing(view.state);
          if (index >= 2 && !allowed) return;
          let tr = view.state.tr.delete(token, end);
          tr = tr.setSelection(TextSelection.create(tr.doc, token));
          if (index === 0) {
            tr = tr.replaceSelectionWith(
              view.state.schema.nodes.code_block.create({ language: '', meta: '' }),
            );
          } else if (index === 1) tr = tr.replaceSelectionWith(createTable(ctx, 3, 3));
          hide();
          view.dispatch(tr.scrollIntoView());
          focusEditorSelection(view, 'edit');
          if (index === 2) drawing();
          if (index === 3) score?.();
        };
        const update = () => {
          if (token === null) return;
          const s = view.state.selection;
          if (
            !s.empty || s.from < token + 1
            || s.$from.parent.type.spec.code && s.$from.parent.type.name !== 'resource_link'
            || view.state.doc.textBetween(token, token + 1) !== '/'
          ) {
            hide();
            return;
          }
          const query = view.state.doc.textBetween(token + 1, s.from).toLowerCase();
          if (query.includes('\n') || query.length > 30) {
            hide();
            return;
          }
          menu!.replaceChildren();
          const allowed = canInsertInlineDrawing(view.state);
          items.forEach((item, index) => {
            if (query && !item.label.toLowerCase().includes(query)) return;
            const button = document.createElement('button');
            button.setAttribute('role', 'menuitem');
            button.innerHTML =
              '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'
              + item.icon + '</svg>';
            button.append(document.createTextNode(item.label));
            button.disabled = index >= 2 && !allowed;
            if (button.disabled) button.title = '请在正文中插入绘图链接';
            button.dataset.index = String(index);
            button.addEventListener('mousedown', e => e.preventDefault());
            button.addEventListener('click', () => run(index));
            menu!.append(button);
          });
          const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          selected = Math.max(0, Math.min(selected, buttons.length - 1));
          buttons.forEach((button, index) => button.classList.toggle('active', index === selected));
          const coords = view.coordsAtPos(s.from);
          menu!.hidden = false;
          menu!.style.left = Math.max(8, Math.min(coords.left, innerWidth - 220)) + 'px';
          menu!.style.top =
            Math.max(8, Math.min(coords.bottom + 5, innerHeight - menu!.offsetHeight - 8)) + 'px';
        };
        const outside = (event: MouseEvent) => {
          if (!menu?.contains(event.target as Node)) hide();
        };
        document.addEventListener('mousedown', outside);
        window.addEventListener('resize', update);
        const scope = view.dom.closest('.document-scroll');
        scope?.addEventListener('scroll', update);
        const keys = (event: KeyboardEvent) => {
          if (token === null || isComposingKey(event) || view.composing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            hide();
          } else if (['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            if (event.key === 'Enter') buttons[selected]?.click();
            else {
              if (!buttons.length) return;
              selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length)
                % buttons.length;
              buttons.forEach((b, i) => b.classList.toggle('active', i === selected));
            }
          }
        };
        view.dom.addEventListener('keydown', keys, true);
        return {
          update,
          destroy() {
            document.removeEventListener('mousedown', outside);
            window.removeEventListener('resize', update);
            scope?.removeEventListener('scroll', update);
            view.dom.removeEventListener('keydown', keys, true);
            menu?.remove();
            menu = null;
            token = null;
          },
        };
      },
      props: {
        handleDOMEvents: {
          beforeinput(view, event) {
            if (
              event.data !== '/' || event.inputType !== 'insertText' || event.isComposing
              || view.composing
              || view.state.selection.$from.parent.type.spec.code
                && view.state.selection.$from.parent.type.name !== 'resource_link'
            ) return false;
            readNativeSelection(view);
            token = view.state.selection.from;
            selected = 0;
            event.preventDefault();
            view.dispatch(view.state.tr.insertText('/'));
            return true;
          },
        },
        handleTextInput(view, from, to, text) {
          if (
            text !== '/' || view.composing
            || view.state.selection.$from.parent.type.spec.code
              && view.state.selection.$from.parent.type.name !== 'resource_link'
          ) return false;
          token = from;
          selected = 0;
          view.dispatch(view.state.tr.insertText(text, from, to));
          return true;
        },
        handleKeyDown(view, event) {
          if (
            event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || view.composing
            || view.state.selection.$from.parent.type.spec.code
              && view.state.selection.$from.parent.type.name !== 'resource_link'
          ) return false;
          readNativeSelection(view);
          token = view.state.selection.from;
          selected = 0;
          event.preventDefault();
          view.dispatch(view.state.tr.insertText('/'));
          return true;
        },
      },
    });
  });
