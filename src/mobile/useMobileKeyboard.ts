import {useEffect,useRef} from 'react';
import {mobileFeature,nativeAvailable} from './native';

// Hiding the Android IME does not necessarily blur the WebView's editable DOM.
export function useMobileKeyboard(){
  const visible=useRef(false);
  useEffect(()=>{
    let live=true,revision=0;
    const changed=(event:Event)=>{revision++;visible.current=(event as CustomEvent<boolean>).detail===true;};
    window.addEventListener('moyu-mobile-keyboard',changed);
    if(nativeAvailable())void mobileFeature<boolean>('mobile.keyboard-visible').then(value=>{if(live&&!revision)visible.current=value;}).catch(()=>{});
    return()=>{live=false;window.removeEventListener('moyu-mobile-keyboard',changed);};
  },[]);
  return visible;
}
