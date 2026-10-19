import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMenuPlacement } from '../useMenuPlacement';
import { type ExplorerOrder, type FileSort, moveOrder, sortLabels, toggleOrder } from './fileExplorer';

export function ExplorerSortMenu({ x, y, order, change, close }: {
  x: number;
  y: number;
  order: ExplorerOrder[];
  change(order: ExplorerOrder[]): void;
  close(): void;
}) {
  const ref = useRef<HTMLDivElement>(null), dragging = useRef<FileSort | null>(null);
  const [target, setTarget] = useState<FileSort | null>(null);
  useMenuPlacement(ref, x, y);
  useLayoutEffect(() => {
    const element = ref.current!, previous = document.activeElement as HTMLElement | null;
    element.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true });
    return () => {
      if (element.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('mousedown', dismiss, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('keydown', escape);
    };
  }, [close]);
  return (
    <div
      ref={ref}
      className='popover-menu explorer-sort-menu'
      role='menu'
      aria-label='排序优先级'
      style={{ left: x, top: y }}
      onContextMenu={event => event.preventDefault()}
    >
      {order.map((item, index) => (
        <div
          key={item.key}
          data-sort-key={item.key}
          className={'explorer-sort-row' + (target === item.key ? ' drop-target' : '')}
          onDragOver={event => {
            if (dragging.current) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setTarget(item.key);
            }
          }}
          onDrop={event => {
            if (!dragging.current) return;
            event.preventDefault();
            event.stopPropagation();
            change(moveOrder(order, dragging.current, item.key));
            dragging.current = null;
            setTarget(null);
          }}
        >
          <span
            className='sort-grip'
            draggable
            title='拖动调整优先级'
            onDragStart={event => {
              dragging.current = item.key;
              event.dataTransfer.setData('application/x-moyu-sort', item.key);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              dragging.current = null;
              setTarget(null);
            }}
          >
            <GripVertical size={13} />
          </span>
          <button
            role='menuitem'
            aria-label={sortLabels[item.key]}
            aria-description={item.descending ? '降序' : '升序'}
            data-direction={item.descending ? 'descending' : 'ascending'}
            title={(item.descending ? '降序' : '升序') + '；Alt+↑/↓ 调整优先级'}
            onClick={() => change(toggleOrder(order, item.key))}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              const next = index + (event.key === 'ArrowUp' ? -1 : 1);
              if (event.altKey) {if (order[next]) change(moveOrder(order, item.key, order[next].key));}
              else {ref.current?.querySelectorAll<HTMLButtonElement>(
                  '[role=menuitem]',
                )[(next + order.length) % order.length]?.focus();}
            }}
          >
            <span className='sort-priority' aria-hidden='true'>{index + 1}</span>
            <span>{sortLabels[item.key]}</span>
            {item.descending ? <ArrowDown size={14} aria-hidden='true' /> : <ArrowUp size={14} aria-hidden='true' />}
          </button>
        </div>
      ))}
    </div>
  );
}
