import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FontChoice } from './fonts';
export function FontSelector(
  { label, value, change, fonts, inherited, placeholder }: {
    label: string;
    value: string;
    change: (name: string) => void;
    fonts: FontChoice[];
    inherited?: string;
    placeholder?: string;
  },
) {
  const input = useRef<HTMLInputElement>(null),
    container = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    id = useId();
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [index, setIndex] = useState(0),
    [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 260 });
  const options = [
    ...(inherited ? [{ family: '', label: '继承默认（' + inherited + '）', search: '' }] : []),
    ...fonts.filter(f => f.search.includes(search.toLocaleLowerCase())),
  ];
  const locate = () => {
    const r = container.current!.getBoundingClientRect();
    const height = Math.min(260, window.innerHeight - r.bottom - 12);
    setRect({
      left: Math.min(r.left, window.innerWidth - r.width - 12),
      top: height >= 140 ? r.bottom + 4 : Math.max(12, r.top - 264),
      width: r.width,
      height: height >= 140 ? height : 260,
    });
  };
  useEffect(() => {
    if (!open) return;
    locate();
    const click = (e: PointerEvent) => {
      if (
        !container.current?.contains(e.target as Node) && !popup.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const move = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) locate();
    };
    document.addEventListener('pointerdown', click);
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('pointerdown', click);
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', move, true);
    };
  }, [open]);
  useEffect(() => {
    popup.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const select = (family: string) => {
    change(family);
    input.current?.focus();
    setOpen(false);
  };
  const theme: Record<string, string> = {};
  if (container.current) {
    const style = getComputedStyle(container.current);
    for (
      const key of [
        '--bg',
        '--elevated',
        '--text',
        '--secondary',
        '--border-strong',
        '--selected',
        '--accent',
        '--font-ui',
      ]
    ) theme[key] = style.getPropertyValue(key);
  }
  return (
    <div className='font-selector' ref={container}>
      <input
        ref={input}
        aria-label={label}
        role='combobox'
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-autocomplete='list'
        aria-activedescendant={open ? `${id}-${index}` : undefined}
        value={value}
        maxLength={100}
        placeholder={placeholder || inherited}
        onFocus={() => {
          setSearch('');
          setIndex(0);
          setOpen(true);
        }}
        onChange={e => {
          change(e.target.value);
          setSearch(e.target.value);
          setIndex(0);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setIndex(i =>
              Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
            );
          } else if (e.key === 'Enter' && open && options[index]) {
            e.preventDefault();
            select(options[index].family);
          } else if (e.key === 'Tab') setOpen(false);
        }}
      />
      <button
        type='button'
        aria-label={'选择' + label}
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          input.current?.focus();
          setSearch('');
          setIndex(0);
          setOpen(!open);
        }}
      >
        <ChevronDown size={14} />
      </button>
      {open
        && createPortal(
          <div
            className='font-options'
            id={id}
            ref={popup}
            role='listbox'
            aria-label={label + '列表'}
            style={{
              ...theme,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              maxHeight: rect.height,
            }}
            onWheel={e => e.stopPropagation()}
          >
            {options.map((f, i) => (
              <button
                type='button'
                role='option'
                aria-selected={f.family === value}
                id={`${id}-${i}`}
                data-active={index === i}
                key={f.family}
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(f.family)}
              >
                <span>{f.label}</span>
                {f.family === value && <Check size={13} />}
              </button>
            ))}
            {!options.length && <p>未找到匹配字体，可直接输入名称。</p>}
          </div>,
          document.body,
        )}
    </div>
  );
}
