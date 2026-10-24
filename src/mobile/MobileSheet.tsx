import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft,X } from 'lucide-react';

const openSheets=new Set<symbol>();
export function useMobileSheetOpen(){
  const [open,setOpen]=useState(openSheets.size>0);
  useEffect(()=>{const update=()=>setOpen(openSheets.size>0);window.addEventListener('moyu-mobile-sheet',update);update();return()=>window.removeEventListener('moyu-mobile-sheet',update);},[]);
  return open;
}

export function MobileSheet({ title, close, back, children }: { title: string; close(): void; back?:()=>void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const token=Symbol();openSheets.add(token);window.dispatchEvent(new Event('moyu-mobile-sheet'));
    return () => {
      openSheets.delete(token);window.dispatchEvent(new Event('moyu-mobile-sheet'));
      // Closing a menu must not reopen the IME. Formatting explicitly restores
      // the captured editor selection only when an action is chosen.
      if(previous?.isConnected&&!previous.closest('[contenteditable],input,textarea'))previous.focus({preventScroll:true});
    };
  }, []);
  return <dialog ref={dialog} className='mobile-sheet' aria-label={title}
    onCancel={event => { event.preventDefault(); (back||close)(); }}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientY < box.top) close(); } }}>
    <header>{back&&<button aria-label='返回上一级面板' onClick={back}><ArrowLeft size={20}/></button>}<h2>{title}</h2><button aria-label={'关闭' + title} onClick={close}><X size={20} /></button></header>
    <div className='mobile-sheet-content'>{children}</div>
  </dialog>;
}
