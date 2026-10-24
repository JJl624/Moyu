import {useEffect,useRef} from 'react';
import {Plus} from 'lucide-react';
import {automaticFormats,formatLabel,formatEnabled,sortedFormats,type MobileFormatAction,type MobileFormatState} from './MobileFormatting';
export function MobileFormatToolbar({order,state,busy,run,more}:{order:string[];state:MobileFormatState;busy:boolean;run(action:MobileFormatAction):void;more():void}){
  const scroll=useRef<HTMLDivElement>(null),automatic=automaticFormats(state).filter(item=>!order.includes(item.action));
  const contextKey=state.ancestors.filter(name=>['table','code_block','math_block','blockquote','list_item'].includes(name)).join('/')+(state.resource?'/resource':'');
  useEffect(()=>{if(scroll.current)scroll.current.scrollLeft=0;},[contextKey]);
  return <div className='mobile-formatbar' role='toolbar' aria-label='文本格式'><div className='mobile-format-scroll' ref={scroll}>
    {automatic.map(item=><button className='mobile-context-format' key={'context-'+item.action} data-format-action={item.action} aria-label={formatLabel(item,state.active.toggleFoldDefault)} title={formatLabel(item,state.active.toggleFoldDefault)} aria-pressed={state.active[item.action]} onPointerDown={event=>event.preventDefault()} onClick={()=>run(item.action)}><item.icon size={17}/><span>{item.action==='toggleFoldDefault'?formatLabel(item,state.active.toggleFoldDefault):item.short}</span></button>)}
    {!!automatic.length&&!!order.length&&<span className='mobile-format-separator' aria-hidden='true'/>}
    {sortedFormats(order).map(item=><button key={item.action} data-format-action={item.action} aria-label={item.label} title={item.label} aria-pressed={state.active[item.action]} disabled={!formatEnabled(item,state)||item.action==='attachment'&&busy} onPointerDown={event=>event.preventDefault()} onClick={()=>run(item.action)}><item.icon size={20}/></button>)}
  </div><button aria-label='全部格式' onPointerDown={event=>event.preventDefault()} onClick={more}><Plus size={22}/></button></div>;
}
