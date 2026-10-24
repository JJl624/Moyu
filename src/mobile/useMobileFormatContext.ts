import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import type {EditorHandle,EditorAction,BlockAction} from '../editorTypes';
import {contextFormats,copyTypes,emptyFormatState,type MobileFormatState} from './MobileFormatting';
export function useMobileFormatContext(editor:RefObject<EditorHandle|null>,enabled:boolean,path:string,mode:string,blocked:boolean){
  const [state,setState]=useState(emptyFormatState),frame=useRef(0),signature=useRef('');
  const live=useRef({enabled,blocked});live.current={enabled,blocked};
  const capture=useCallback(()=>{
    const context=live.current.enabled?editor.current?.selectionContext?.()||null:null;
    const next:MobileFormatState={ancestors:context?.ancestors||[],resource:context?.resource,can:{},active:{}};
    if(context)for(const item of contextFormats){
      const type=copyTypes[item.action as keyof typeof copyTypes];
      next.can[item.action]=type?next.ancestors.some(name=>name===type):context.can(item.action as EditorAction|BlockAction);
      if(['bold','italic','underline','highlight','strike','code','math','link','toggleFoldDefault'].includes(item.action))next.active[item.action]=!!context.active?.(item.action as EditorAction|BlockAction);
    }
    if(context?.can('toggleFoldDefault')){next.active.foldOpen=!!context.active?.('toggleFoldDefault');next.active.foldClosed=!next.active.foldOpen;}
    const serialized=JSON.stringify(next);if(serialized!==signature.current){signature.current=serialized;setState(next);}
    return context;
  },[editor]);
  const changed=useCallback(()=>{
    if(frame.current||!live.current.enabled||live.current.blocked)return;
    frame.current=requestAnimationFrame(()=>{frame.current=0;capture();});
  },[capture]);
  useEffect(()=>{if(!blocked)changed();},[blocked,changed]);
  useEffect(()=>{
    signature.current='';setState(emptyFormatState);changed();
    document.addEventListener('selectionchange',changed);document.addEventListener('focusin',changed);
    return()=>{cancelAnimationFrame(frame.current);frame.current=0;document.removeEventListener('selectionchange',changed);document.removeEventListener('focusin',changed);};
  },[enabled,path,mode,changed]);
  return{state,changed,capture};
}
