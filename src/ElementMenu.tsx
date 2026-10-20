import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useMenuPlacement } from './useMenuPlacement';
import { isComposingKey } from './keyboardComposition';
import { menuAppearance } from './menuAppearance';
import './elementMenu.css';
export interface MenuAction {
  id?: string;
  label: string;
  action?(): void;
  disabled?: boolean;
  checked?: boolean;
  children?: MenuAction[];
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
  const [submenu,setSubmenu]=useState<{item:MenuAction;x:number;y:number}|null>(null);
  const submenuRef=useRef<HTMLDivElement>(null);
  useMenuPlacement(ref, x, y);
  useMenuPlacement(submenuRef,submenu?.x||0,submenu?.y||0,!!submenu);
  const section=(action:MenuAction)=>{const value=menuAppearance(action.id).section;return value==='clipboard'?'copy':value;};
  const formats=actions.filter(action=>menuAppearance(action.id).section==='format');
  const rows=actions.filter(action=>!formats.includes(action));
  const invoke=(action:MenuAction)=>{if(action.disabled)return;action.action?.();close();};
  const expand=(item:MenuAction,button:HTMLButtonElement)=>{
    const box=button.getBoundingClientRect(),width=220;
    setSubmenu({item,x:box.right+width+8>innerWidth?box.left-width-4:box.right+4,y:box.top-4});
  };
  useLayoutEffect(()=>{if(submenu)submenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});},[submenu?.item]);
  useLayoutEffect(() => {
    const el = ref.current!, previous = document.activeElement as HTMLElement | null;
    preview?.classList.add('context-target');
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      preview?.classList.remove('context-target');
      // Actions may open a different editor or dialog. Restore only menu-owned focus.
      if ((el.contains(document.activeElement) || submenuRef.current?.contains(document.activeElement)) && previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [x, y, preview]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)&&!submenuRef.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (isComposingKey(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if(submenu){setSubmenu(null);ref.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus();}else close();
      }
      const item=actions.find(action=>action.id===(document.activeElement as HTMLElement)?.dataset.menuId);
      const compact=document.activeElement?.closest('.menu-formats');
      if(compact&&['ArrowLeft','ArrowRight'].includes(e.key)){
        e.preventDefault();e.stopPropagation();
        const buttons=[...compact.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length]?.focus();return;
      }
      if(e.key==='ArrowRight'&&item?.children){e.preventDefault();e.stopPropagation();expand(item,document.activeElement as HTMLButtonElement);}
      if(e.key==='ArrowLeft'&&submenu){e.preventDefault();e.stopPropagation();setSubmenu(null);ref.current?.querySelector<HTMLButtonElement>('[aria-expanded=true]')?.focus();}
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key==='Home' || e.key==='End') {
        e.preventDefault();
        e.stopPropagation();
        const scope=submenu&&submenuRef.current?.contains(document.activeElement)?submenuRef.current:ref.current;
        const btns = [...scope!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],
          i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[e.key==='Home'?0:e.key==='End'?btns.length-1:(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
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
  }, [close,submenu,actions]);
  const button=(a:MenuAction,compact=false)=>{
    const {Icon,shortcut,danger}=menuAppearance(a.id);
    return <button role={a.checked===undefined?'menuitem':'menuitemcheckbox'} aria-checked={a.checked} disabled={a.disabled} key={a.id||a.label} data-menu-id={a.id}
      aria-label={a.label} title={compact?(a.checked?'取消':'')+a.label+(shortcut?' · '+shortcut:''):undefined}
      aria-haspopup={a.children?'menu':undefined} aria-expanded={a.children?submenu?.item===a:undefined}
      className={danger?'menu-danger':undefined}
      onMouseEnter={event=>{if(a.children)expand(a,event.currentTarget);else if(!submenuRef.current?.contains(event.currentTarget))setSubmenu(null);}}
      onClick={event=>a.children?expand(a,event.currentTarget):invoke(a)}>
      <Icon size={16} aria-hidden='true'/><span>{a.label}</span>
      {!compact&&shortcut&&<kbd>{shortcut}</kbd>}{a.children&&<ChevronRight size={13} className='menu-chevron' aria-hidden='true'/>}
    </button>;
  };
  return (
    <>
    <div
      ref={ref}
      className='popover-menu context-menu element-menu'
      role='menu'
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
      onScroll={()=>setSubmenu(null)}
    >
      {!!formats.length&&<div className='menu-formats' role='group' aria-label='文字格式'>{formats.map(a=>button(a,true))}</div>}
      {rows.map((a,index)=><div className={'menu-row'+(index>0&&section(a)!==section(rows[index-1])?' menu-section-start':'')} key={a.id||a.label}>{button(a)}</div>)}
    </div>
    {submenu&&<div ref={submenuRef} role='menu' aria-label={submenu.item.label} className='popover-menu context-menu element-menu element-submenu' style={{left:submenu.x,top:submenu.y}} onContextMenu={e=>e.preventDefault()}>{submenu.item.children?.map(a=><div className='menu-row' key={a.id||a.label}>{button(a)}</div>)}</div>}
    </>
  );
}
