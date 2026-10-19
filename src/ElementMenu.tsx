import { useEffect, useLayoutEffect, useRef } from 'react';
import { useMenuPlacement } from './useMenuPlacement';
import { isComposingKey } from './keyboardComposition';
export interface MenuAction {
  label: string;
  action(): void;
  disabled?: boolean;
}
export interface ElementMenuState {
  x: number;
  y: number;
  actions: MenuAction[];
  preview?: HTMLElement;
}
export function ElementMenu(
  { x, y, actions, close, preview }: ElementMenuState & {
    close(): void;
  },
) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuPlacement(ref, x, y);
  useLayoutEffect(() => {
    const el = ref.current!, previous = document.activeElement as HTMLElement | null;
    preview?.classList.add('context-target');
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      preview?.classList.remove('context-target');
      // Actions may open a different editor or dialog. Restore only menu-owned focus.
      if (el.contains(document.activeElement) && previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [x, y, preview]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (isComposingKey(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const btns = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],
          i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
      }
    };
    // Preview widgets stop bubbling so clicks cannot move the native editor
    // selection. Dismiss menus before that widget-specific handling runs.
    window.addEventListener('mousedown', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [close]);
  return (
    <div
      ref={ref}
      className='popover-menu context-menu element-menu'
      role='menu'
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
    >
      {actions.map(a => (
        <button
          role='menuitem'
          disabled={a.disabled}
          key={a.label}
          onClick={() => {
            a.action();
            close();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
