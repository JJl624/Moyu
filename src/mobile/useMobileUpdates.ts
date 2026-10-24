import {useEffect,useRef,useState} from 'react';
import {mobileUpdates} from './mobileUpdates';
export function useMobileUpdates(ready:boolean){
  const [state,setState]=useState(()=>mobileUpdates.state()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState(false),[dismissed,setDismissed]=useState('');
  const live=useRef(true),foreground=useRef(document.visibilityState!=='hidden');
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const check=async()=>{setBusy(true);setError('');setChecked(false);try{const next=await mobileUpdates.check(true);if(live.current){setState(next);setChecked(true);}}catch(error){if(live.current)setError((error as Error).message);}finally{if(live.current)setBusy(false);}};
  const configure=async(automatic:boolean)=>{setState(value=>({...value,automatic}));try{setState(await mobileUpdates.configure(automatic));}catch(error){setState(mobileUpdates.state());setError((error as Error).message);}};
  useEffect(()=>{
    if(!ready||!state.automatic)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const start=()=>{clearTimeout(timer);if(foreground.current&&document.visibilityState!=='hidden')timer=setTimeout(()=>{void mobileUpdates.check().then(next=>{if(!cancelled)setState(next);}).catch(()=>{});},5000);};
    const pause=()=>{foreground.current=false;clearTimeout(timer);},resume=()=>{foreground.current=true;start();},visibility=()=>document.visibilityState==='hidden'?pause():resume();
    window.addEventListener('moyu-mobile-pause',pause);window.addEventListener('moyu-mobile-resume',resume);document.addEventListener('visibilitychange',visibility);start();
    return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('moyu-mobile-pause',pause);window.removeEventListener('moyu-mobile-resume',resume);document.removeEventListener('visibilitychange',visibility);};
  },[ready,state.automatic]);
  return{state,busy,error,checked,check,configure,dismissed,dismiss:()=>setDismissed(state.latest?.version||'')};
}
export type MobileUpdateController=ReturnType<typeof useMobileUpdates>;
