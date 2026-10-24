import { EditorView as CodeView } from '@codemirror/view';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { EditorSelection } from '../editorTypes';
import { codeLayoutsReady, codeScrollContainer } from './codeHeight';
import { readNativeSelection } from './nativeSelection';
import { fromMarkdownSelection, toMarkdownSelection } from './selection';
function codeView(view: EditorView) {
  const selected = view.state.selection.$head;
  if (!['code_block','math_block'].includes(selected.parent.type.name)) return null;
  const pos = selected.before(),
    content = (view.nodeDOM(pos) as HTMLElement)?.querySelector<HTMLElement>('.cm-content');
  const code = content ? CodeView.findFromDOM(content) : null;
  return code ? { code, pos } : null;
}
function caret(view: EditorView) {
  try {
    const code = codeView(view);
    return code
      ? code.code.coordsAtPos(code.code.state.selection.main.head)
      : view.coordsAtPos(view.state.selection.head);
  } catch {
    return null;
  }
}
export function captureRichSelection(view: EditorView, markdown: string): EditorSelection {
  readNativeSelection(view);
  let { anchor, head } = view.state.selection;
  const scope = view.dom.closest('.document-scroll'), block = codeView(view);
  let codeScroll: EditorSelection['codeScroll'];
  let codeTabs: EditorSelection['codeTabs'];
  if (block) {
    const offset = Number(block.code.dom.dataset.codeSourceOffset) || 0;
    anchor = block.pos + 1 + offset + block.code.state.selection.main.anchor;
    head = block.pos + 1 + offset + block.code.state.selection.main.head;
    codeScroll = { pos: block.pos, top: codeScrollContainer(block.code).scrollTop };
    const tabs = block.code.dom.closest<HTMLElement>('[data-tabbed-code]');
    if (tabs) {
      codeTabs = {
        pos: block.pos,
        mode: tabs.dataset.tabsDisplay === 'source' ? 'source' : 'tabs',
        index: Number(tabs.dataset.codeTabIndex) || 0,
      };
    }
  }
  const box = scope?.getBoundingClientRect(),
    point = caret(view),
    offset = box && point ? point.top - box.top : undefined;
  let viewportAnchor: EditorSelection['viewportAnchor'];
  if (box) {
    view.state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return;
      if (!viewportAnchor) {
        const element = view.nodeDOM(pos);
        if (element instanceof HTMLElement) {
          const rect = element.getBoundingClientRect();
          if (rect.bottom > box.top && rect.top < box.bottom) {
            viewportAnchor = { pos, offset: rect.top - box.top };
          }
        }
      }
      return false;
    });
  }
  return {
    anchor: toMarkdownSelection(markdown, view.state.doc, anchor),
    head: toMarkdownSelection(markdown, view.state.doc, head),
    markdown,
    rich: { anchor, head },
    mode: 'rich',
    codeScroll,
    codeTabs,
    caretOffset: offset !== undefined && box && offset >= 0 && offset < box.height
      ? offset
      : undefined,
    scrollTop: scope?.scrollTop || 0,
    viewportAnchor,
  };
}
export function restoreRichSelection(
  view: EditorView,
  markdown: string,
  selected: EditorSelection,
  focus = true,
) {
  const host = view.dom.closest<HTMLElement>('.editor-host');
  if (host) host.dataset.editorPending = 'true';
  const direct = selected.markdown === markdown ? selected.rich : undefined,
    max = view.state.doc.content.size;
  const anchor = Math.max(
      0,
      Math.min(
        max,
        direct?.anchor ?? fromMarkdownSelection(markdown, view.state.doc, selected.anchor),
      ),
    ),
    head = Math.max(
      0,
      Math.min(max, direct?.head ?? fromMarkdownSelection(markdown, view.state.doc, selected.head)),
    );
  if (selected.codeTabs && direct) {
    const dom = view.nodeDOM(selected.codeTabs.pos);
    if (dom instanceof HTMLElement) {
      dom.dispatchEvent(new CustomEvent('moyu-tabs-display', { detail: selected.codeTabs }));
    }
  }
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head)),
    ),
  );
  if (focus) view.focus();
  const initialCode = codeView(view);
  if (initialCode && selected.codeScroll?.pos === initialCode.pos) {
    codeScrollContainer(initialCode.code).scrollTop = selected.codeScroll.top;
  }
  const scope = view.dom.closest<HTMLElement>('.document-scroll');
  if (!scope) return () => {};
  scope.scrollTop = selected.scrollTop;
  // Restore after layout, and keep the saved visual anchor during initial
  // asynchronous media/code layout. Any user navigation immediately releases it.
  let frame = 0,
    stopped = false,
    codeRestored = false,
    codeAligned = false,
    layoutsReady = false,
    stableFrames = 0,
    geometry = '',
    started = performance.now(),
    restoredTop = scope.scrollTop;
  const align = () => {
    frame = 0;
    if (stopped || view.isDestroyed) return;
    const block = codeView(view);
    if (block && !codeRestored) {
      codeRestored = true;
      const code = block.code, scroll = codeScrollContainer(code);
      code.requestMeasure({
        read: () => ({
          point: code.coordsAtPos(code.state.selection.main.head),
          box: scroll.getBoundingClientRect(),
        }),
        write: ({ point, box }) => {
          if (stopped) return;
          if (selected.codeScroll?.pos === block.pos) {
            scroll.scrollTop = selected.codeScroll.top;
          } else if (point) {
            if (point.top < box.top) scroll.scrollTop += point.top - box.top;
            else if (point.bottom > box.bottom) {
              scroll.scrollTop += point.bottom - box.bottom;
            }
          }
          codeAligned = true;
          schedule();
        },
      });
    }
    if (selected.caretOffset !== undefined) {
      const point = caret(view);
      if (point) {
        scope.scrollTop += point.top - scope.getBoundingClientRect().top - selected.caretOffset;
      }
    } else if (direct && selected.viewportAnchor) {
      const element = view.nodeDOM(selected.viewportAnchor.pos);
      if (element instanceof HTMLElement) {
        scope.scrollTop += element.getBoundingClientRect().top - scope.getBoundingClientRect().top
          - selected.viewportAnchor.offset;
      } else scope.scrollTop = selected.scrollTop;
    } else scope.scrollTop = selected.scrollTop;
    restoredTop = scope.scrollTop;
    {
      const next = [scope.scrollTop, caret(view)?.top].join(':');
      stableFrames = next === geometry ? stableFrames + 1 : 0;
      geometry = next;
      const bottom = scope.getBoundingClientRect().bottom;
      const loading = [...host?.querySelectorAll<HTMLElement>('[data-preview-loading]') || []].some(
        element => {
          if (element.closest('[hidden]')) return false;
          return element.getBoundingClientRect().top <= bottom;
        },
      );
      layoutsReady ||= codeLayoutsReady(view);
      if (
        // Inline media settle before paint; virtual code views may finish their
        // mount on the following frame. Require both layouts to stay settled.
        ((!block || codeAligned) && layoutsReady && stableFrames >= 1 && !loading)
        || performance.now() - started > 1500
      ) {
        stop();
      } else schedule();
    }
  };
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(align);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(view.dom);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (host) delete host.dataset.editorPending;
    cancelAnimationFrame(frame);
    resize.disconnect();
    for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
      window.removeEventListener(type, stop, true);
    }
    scope.removeEventListener('scroll', manualScroll);
  };
  // Only our own scroll writes belong to restoration. Scrollbar navigation,
  // outline/data navigation and any other explicit scroll take ownership.
  const manualScroll = () => {
    if (Math.abs(scope.scrollTop - restoredTop) > 1) stop();
  };
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  scope.addEventListener('scroll', manualScroll);
  schedule();
  return stop;
}
