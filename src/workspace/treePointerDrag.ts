import type React from 'react';

// Keep internal file dragging in the page so wheel and right-click remain
// available. The editors receive the same drop payload as a native file drag.
export function startTreePointerDrag(event: React.PointerEvent, options: {
  start(): DataTransfer;
  finish(): void;
  toggle(target: Element): void;
  position(x: number, y: number): void;
}) {
  const document = event.currentTarget.ownerDocument, origin = { x: event.clientX, y: event.clientY };
  const pointerId=event.pointerId,capture=document.body;
  let data: DataTransfer | undefined,
    target: Element | null = null,
    x = origin.x,
    y = origin.y,
    done = false,
    timer: ReturnType<typeof setInterval> | undefined;
  const send = (type: string, element = target, relatedTarget: Element | null = null) =>
    element?.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: x,
        clientY: y,
        relatedTarget,
      }),
    );
  const hit = () => {
    const next = document.elementFromPoint(x, y);
    if (next !== target) {
      send('dragleave', target, next);
      target = next;
    }
    send('dragover');
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== event.pointerId) return;
    x = e.clientX;
    y = e.clientY;
    if (!data && Math.hypot(x - origin.x, y - origin.y) < 6) return;
    if (!data) {
      data = options.start();
      // Keep receiving the release over embedded previews and when an ancestor
      // folder closes and removes the original row from the DOM.
      capture.setPointerCapture(pointerId);
      document.body.classList.add('dragging-tree-file');
      document.getSelection()?.removeAllRanges();
      // Re-hit after scrolling or a folder layout changes under a still pointer.
      timer = setInterval(() => {
        options.position(x, y);
        hit();
      }, 100);
    }
    e.preventDefault();
    options.position(x, y);
    hit();
  };
  const cleanup = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    if(capture.hasPointerCapture(pointerId))capture.releasePointerCapture(pointerId);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('contextmenu', context, true);
    document.removeEventListener('wheel', wheel, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    document.body.classList.remove('dragging-tree-file');
    if (data) {
      send('dragleave');
      options.finish();
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === event.pointerId && e.button === 0) {
      if (data) {
        hit();
        send('drop');
        e.preventDefault();
      }
      cleanup();
    }
  };
  const cancel = () => cleanup();
  const context = (e: MouseEvent) => {
    if (!data) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const element = document.elementFromPoint(e.clientX, e.clientY);
    if (element) options.toggle(element);
  };
  const wheel = (e: WheelEvent) => {
    if (!data) return;
    const scroll = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(
      '.sidebar-scroll,.document-scroll,.cm-scroller',
    );
    if (!scroll) return;
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? scroll.clientHeight : 1;
    scroll.scrollBy(e.deltaX * unit, e.deltaY * unit);
    hit();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cleanup();
    }
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('contextmenu', context, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  document.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
  return cleanup;
}
