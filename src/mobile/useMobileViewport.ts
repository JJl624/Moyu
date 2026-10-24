import {useEffect} from 'react';

// Android resizes the WebView for the IME; visualViewport also covers browsers
// which resize only the visual viewport. Never subtract the keyboard twice.
export function useMobileViewport() {
  useEffect(() => {
    const root=document.documentElement, viewport=window.visualViewport;
    let frame=0, timer=0;
    const reveal=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const selected=document.getSelection();
        if(!selected?.isCollapsed||!selected.rangeCount)return;
        const active=document.activeElement;
        if(!(active instanceof HTMLElement)||!active.closest('.mobile-document'))return;
        if(active.closest('.source-editor,.milkdown-code-block'))return; // CodeMirror owns its caret scrolling.
        const range=selected.getRangeAt(0), caret=range.getBoundingClientRect();
        const scroller=active.closest('.mobile-document');
        if(!scroller||!caret.height)return;
        const box=scroller.getBoundingClientRect(),top=box.top+12,bottom=box.bottom-24;
        if(caret.bottom>bottom)scroller.scrollTop+=caret.bottom-bottom;
        else if(caret.top<top)scroller.scrollTop-=top-caret.top;
      });
    };
    const resize=()=>{
      // A pinch-zoomed page must remain zoomable; resizing its layout fights the gesture.
      if(!viewport||viewport.scale===1)root.style.setProperty('--mobile-viewport-height',(viewport?.height||innerHeight)+'px');
      clearTimeout(timer);timer=window.setTimeout(reveal,80);
    };
    resize();viewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);
    document.addEventListener('input',reveal);document.addEventListener('compositionend',reveal);
    return()=>{clearTimeout(timer);cancelAnimationFrame(frame);viewport?.removeEventListener('resize',resize);window.removeEventListener('resize',resize);document.removeEventListener('input',reveal);document.removeEventListener('compositionend',reveal);root.style.removeProperty('--mobile-viewport-height');};
  },[]);
}
