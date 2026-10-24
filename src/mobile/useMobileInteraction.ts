import {useEffect} from 'react';

// Dialog focus restoration can inherit :focus-visible from its previous target.
// Keep focus for accessibility and keyboard navigation, but don't paint it after touch.
export function useMobileInteraction(){
  useEffect(()=>{
    const root=document.documentElement;
    const pointer=(event:PointerEvent)=>{root.dataset.mobileInput=event.pointerType==='mouse'?'pointer':'touch';};
    const key=(event:KeyboardEvent)=>{if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))root.dataset.mobileInput='keyboard';};
    root.dataset.mobileInput='touch';
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);delete root.dataset.mobileInput;};
  },[]);
}
