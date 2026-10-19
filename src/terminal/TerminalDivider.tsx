import { useRef, useState } from 'react';
export function TerminalDivider(
  { direction, size, change }: { direction: 'below' | 'right'; size: number; change(size: number): void },
) {
  const origin = useRef({ point: 0, size }),
    [dragging, setDragging] = useState(false),
    current = useRef(size),
    active = useRef(false);
  const finish = () => {
    if (!active.current) return;
    active.current = false;
    change(current.current);
    setDragging(false);
  };
  const clamp = (value: number, element: HTMLElement) =>
    Math.round(
      Math.max(
        direction === 'below' ? 130 : 220,
        Math.min(value, (direction === 'below' ? element.clientHeight : element.clientWidth) * .8),
      ),
    );
  return (
    <div
      className={'terminal-divider ' + (dragging ? 'dragging' : '')}
      role='separator'
      aria-label='编辑器与终端分隔条'
      aria-orientation={direction === 'below' ? 'horizontal' : 'vertical'}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={e => {
        if (e.button) return;
        active.current = true;
        origin.current = { point: direction === 'below' ? e.clientY : e.clientX, size };
        current.current = size;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={e => {
        if (!dragging) return;
        const host = e.currentTarget.parentElement!, point = direction === 'below' ? e.clientY : e.clientX;
        current.current = clamp(origin.current.size + origin.current.point - point, host);
        host.style.setProperty('--terminal-size', current.current + 'px');
      }}
      onPointerUp={e => {
        finish();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={finish}
      onPointerCancel={finish}
      onKeyDown={e => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          change(clamp(size + (['ArrowUp', 'ArrowLeft'].includes(e.key) ? 20 : -20), e.currentTarget.parentElement!));
        }
      }}
    />
  );
}
