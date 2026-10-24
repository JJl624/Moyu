import {useRef,useState} from 'react';
import {ArrowDown,ArrowUp,GripVertical,RotateCcw,X,Plus} from 'lucide-react';
import {allFormats,formatGroups,quickFormats,sortedFormats} from './MobileFormatting';

export function MobileShortcutSettings({order,change}:{order:string[];change(value:string[]):void}) {
  const list=useRef<HTMLDivElement>(null),drag=useRef<{key:string;original:string[]}|null>(null);
  const latest=useRef(order);latest.current=order;
  const [dragging,setDragging]=useState(''),[announcement,setAnnouncement]=useState('');
  const move=(key:string,to:number)=>{
    const from=latest.current.indexOf(key);if(from===to||to<0||to>=latest.current.length)return;
    const next=[...latest.current];next.splice(from,1);next.splice(to,0,key);latest.current=next;change(next);
    setAnnouncement((allFormats.find(item=>item.action===key)?.label||'')+'，第 '+(to+1)+' 项');
  };
  return <><p className='mobile-caption'>拖动手柄调整顺序。工具栏可左右滑动。</p><h3>已添加 · {order.length}</h3><div className='mobile-shortcut-list' ref={list}
    onPointerMove={event=>{
      if(!drag.current)return;
      const rows=[...list.current?.querySelectorAll<HTMLElement>('[data-shortcut]')||[]];
      const target=rows.findIndex(row=>{const box=row.getBoundingClientRect();return event.clientY>=box.top&&event.clientY<=box.bottom;});
      if(target>=0)move(drag.current.key,target);
      const panel=list.current?.closest('.mobile-sheet-content');if(panel){const box=panel.getBoundingClientRect();if(event.clientY>box.bottom-32)panel.scrollTop+=16;else if(event.clientY<box.top+32)panel.scrollTop-=16;}
    }} onPointerUp={()=>{drag.current=null;setDragging('');}}
    onPointerCancel={()=>{if(drag.current)change(drag.current.original);drag.current=null;setDragging('');}} onLostPointerCapture={()=>{drag.current=null;setDragging('');}}>
    {sortedFormats(order).map((item,index)=><div className={'mobile-shortcut-row'+(dragging===item.action?' dragging':'')} data-shortcut={item.action} key={item.action}>
      <button className='mobile-shortcut-grip' aria-label={'拖动排序 '+item.label} onKeyDown={event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();move(item.action,index+(event.key==='ArrowUp'?-1:1));}}}
        onPointerDown={event=>{if(event.button!==0)return;list.current?.setPointerCapture(event.pointerId);drag.current={key:item.action,original:order};setDragging(item.action);}}><GripVertical size={20}/></button>
      <item.icon size={20}/><span>{item.label}</span><button aria-label={'上移 '+item.label} disabled={index===0} onClick={()=>move(item.action,index-1)}><ArrowUp size={18}/></button><button aria-label={'下移 '+item.label} disabled={index===order.length-1} onClick={()=>move(item.action,index+1)}><ArrowDown size={18}/></button><button aria-label={'移除 '+item.label} onClick={()=>change(order.filter(action=>action!==item.action))}><X size={17}/></button>
    </div>)}
  </div>{!order.length&&<p className='mobile-caption'>工具栏为空。</p>}<div className='mobile-shortcut-available'>{formatGroups.map(group=>{const items=group.items.filter(item=>!order.includes(item.action));return items.length?<section key={group.label}><h3>{group.label}</h3><div className='mobile-format-grid'>{items.map(item=><button key={item.action} aria-label={'添加 '+item.label} onClick={()=>change([...order,item.action])}><item.icon size={20}/><span>{item.label}</span><Plus size={12} aria-hidden='true'/></button>)}</div></section>:null;})}</div><div className='mobile-actions'><button onClick={()=>change(quickFormats.map(item=>item.action))}><RotateCcw size={18}/>恢复默认工具栏</button></div><span className='mobile-sr-only' role='status'>{announcement}</span></>;
}
