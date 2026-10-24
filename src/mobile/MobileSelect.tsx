import {Check,ChevronDown} from 'lucide-react';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function MobileSelect({label,value,options,change,disabled=false,commit,className='mobile-setting-row'}:{label:string;value:string;options:readonly {value:string;label:string}[];change(value:string):void;disabled?:boolean;commit?():void;className?:string}){
  const id=useId(),root=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false),[position,setPosition]=useState({top:0,left:0,width:0,maxHeight:320});
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const box=trigger.current?.getBoundingClientRect(),popup=menu.current;if(!box||!popup)return;
      const available=window.visualViewport?.height||innerHeight,below=available-box.bottom-12,above=box.top-12,width=Math.min(innerWidth-24,Math.max(180,box.width));
      popup.style.width=width+'px';const natural=popup.scrollHeight,down=below>=Math.min(220,natural)||below>=above,maxHeight=Math.max(44,Math.min(320,down?below:above)),height=Math.min(maxHeight,natural);
      setPosition({left:Math.max(12,Math.min(innerWidth-width-12,box.right-width)),top:down?box.bottom+4:Math.max(12,box.top-height-4),width,maxHeight});
    };
    place();window.addEventListener('resize',place);
    const scroll=(event:Event)=>{if(event.target instanceof Node&&menu.current?.contains(event.target))return;place();};
    const back=(event:Event)=>{event.stopImmediatePropagation();setOpen(false);trigger.current?.focus({preventScroll:true});};
    window.addEventListener('scroll',scroll,true);window.addEventListener('moyu-mobile-back',back,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);window.removeEventListener('moyu-mobile-back',back,true);};
  },[open,options.length]);
  // Collapse after a pointer click finishes: doing it on pointerdown moves the
  // following setting away from the finger before it can receive its click.
  useEffect(()=>{if(!open)return;const outside=(event:MouseEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!menu.current?.contains(event.target))setOpen(false);};document.addEventListener('click',outside);return()=>document.removeEventListener('click',outside);},[open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  return <div className={className+' mobile-select-row'} ref={root} onBlur={event=>{if(document.documentElement.dataset.mobileInput==='keyboard'&&event.relatedTarget instanceof Node&&!root.current?.contains(event.relatedTarget)&&!menu.current?.contains(event.relatedTarget))setOpen(false);}} onKeyDown={event=>{
    if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);trigger.current?.focus();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!open){setOpen(true);requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus({preventScroll:true}));return;}
      const items=[...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=option]')||[])],index=items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus({preventScroll:true});
    }
  }}><div className='mobile-select-heading'><span id={id+'-label'}>{label}</span><button ref={trigger} type='button' role='combobox' aria-labelledby={id+'-label'} aria-controls={id} aria-expanded={open} aria-haspopup='listbox' data-value={value} disabled={disabled} onClick={()=>setOpen(value=>!value)}><span>{options.find(option=>option.value===value)?.label||value}</span><ChevronDown size={16}/></button></div>
    {open&&createPortal(<div ref={menu} className='mobile-select-options mobile-select-popup' style={position} id={id} role='listbox' aria-labelledby={id+'-label'}>{options.map(option=><button key={option.value} type='button' role='option' aria-selected={option.value===value} data-value={option.value} onClick={()=>{change(option.value);setOpen(false);trigger.current?.focus({preventScroll:true});if(commit)requestAnimationFrame(commit);}}><span>{option.label}</span>{option.value===value&&<Check size={17}/>}</button>)}</div>,root.current?.closest('.mobile-app')||document.body)}
  </div>;
}
