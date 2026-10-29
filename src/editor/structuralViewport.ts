import type {EditorView} from '@milkdown/kit/prose/view';
import {$prose} from '@milkdown/kit/utils';
import {Plugin} from '@milkdown/kit/prose/state';
import {EditorView as CodeView} from '@codemirror/view';
import {selectedCode} from './codeSelection';

interface Guard {
  original: string;
  stopPending(): void;
  release(): void;
}
const guards = new WeakMap<EditorView, Guard>();

/** Keep a structural edit atomic to the viewport as well as the document.
 * A node-view replacement can temporarily remove an entire list. Without a
 * scroll extent floor the browser clamps scrollTop during that intermediate DOM.
 */
export function withStructuralViewport<T>(view: EditorView, change: () => T): T {
  const scroll = view.dom.closest<HTMLElement>('.document-scroll');
  const window = view.dom.ownerDocument.defaultView;
  if (!scroll || !window || view.isDestroyed) return change();
  const previous = guards.get(view), original = previous?.original ?? view.dom.style.minHeight;
  const top = scroll.scrollTop, left = scroll.scrollLeft;
  const extent = scroll.clientHeight - (view.dom.getBoundingClientRect().top - scroll.getBoundingClientRect().top);
  previous?.release();
  // The app's editors use border-box. Reserve only the currently visible extent,
  // not the historical height of a potentially much longer document.
  view.dom.style.minHeight = Math.max(0, extent) + 'px';
  scroll.scrollTop = top;
  scroll.scrollLeft = left;
  let frame = 0, pending = true;
  const document = view.dom.ownerDocument;
  const stopPending = () => {
    pending = false;
    window.cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', stopPending, true);
    document.removeEventListener('keydown', stopPending, true);
  };
  const release = (event?: Event) => {
    stopPending();
    if (event?.type === 'beforeinput' && /^history/.test((event as InputEvent).inputType)) return;
    if (guards.get(view) !== guard) return;
    guards.delete(view);
    view.dom.style.minHeight = original;
    for (const name of ['wheel', 'touchmove', 'beforeinput', 'compositionstart']) scroll.removeEventListener(name, release, true);
  };
  const guard = {original, stopPending, release};
  guards.set(view, guard);
  document.addEventListener('pointerdown', stopPending, true);
  document.addEventListener('keydown', stopPending, true);
  for (const name of ['wheel', 'touchmove', 'beforeinput', 'compositionstart']) scroll.addEventListener(name, release, {capture: true, passive: true});
  const restore = () => {
    if (!pending || guards.get(view) !== guard || view.isDestroyed) return;
    scroll.scrollTop = top;
    scroll.scrollLeft = left;
  };
  try { return change(); }
  finally {
    const documentAfter = view.state.doc;
    restore();
    // Code controls mount in microtasks. One frame reconciles that layout,
    // without polling or fighting subsequent input, scrolling or document edits.
    frame = window.requestAnimationFrame(() => {
      if (view.state.doc === documentAfter) restore();
      stopPending();
    });
  }
}

export const structuralViewport = $prose(() => new Plugin({
  props: {
    handleScrollToSelection(view) {
      const selected = selectedCode(view), dom = selected?.dom;
      if (!selected || !(dom instanceof HTMLElement)) return false;
      const content = dom.querySelector<HTMLElement>('.cm-content');
      const code = content && CodeView.findFromDOM(content);
      const scroll = view.dom.closest('.document-scroll');
      if (!code || !scroll) return false;
      const offset = Number(code.dom.dataset.codeSourceOffset) || 0;
      const point = code.coordsAtPos(Math.max(0, Math.min(code.state.doc.length, selected.head - offset)));
      const box = scroll.getBoundingClientRect();
      // PM sees an opaque node view, not the actual inner caret. In particular
      // history must not reveal the block's offscreen header when its caret is
      // already visible inside CodeMirror.
      return !!point && point.top >= box.top && point.bottom <= box.bottom;
    },
  },
  view: view => ({destroy: () => guards.get(view)?.release()}),
}));
