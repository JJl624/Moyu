import { type RefObject, useLayoutEffect } from 'react';

export function useMenuPlacement(ref: RefObject<HTMLElement | null>, x: number, y: number, enabled = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const place = () => {
      const box = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8)) + 'px';
      const top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) + 'px';
      if (element.style.left !== left) element.style.left = left;
      if (element.style.top !== top) element.style.top = top;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [ref, x, y, enabled]);
}
