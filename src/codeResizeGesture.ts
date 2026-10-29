import {keepClosedKeyboard} from './editor/controlFocus';
import {touchSettings} from './touchSettings';
type ResizeOptions={
  mobile:boolean;enabled?():boolean;measure():number;value():number|null;
  preview(height:number|null):void;commit(height:number|null):void;active?(value:boolean):void;
};

// Touch scrolling owns a gesture until the hold finishes. Touch events then
// drive resizing directly: Android may cancel pointer events when panning starts.
export function bindCodeResize(handle:HTMLElement,options:ResizeOptions){
  let origin:{id:number;touch:boolean;x:number;y:number;height:number;value:number|null;at:number}|null=null;
  let armed=false,moved=false,timer:ReturnType<typeof setTimeout>|undefined,lastTap=0,lastX=0,lastY=0;
  const clear=()=>{clearTimeout(timer);timer=undefined;armed=false;options.active?.(false);handle.classList.remove('resize-ready');origin=null;};
  const cancel=()=>{const previous=origin?.value;lastTap=0;clear();if(previous!==undefined)options.preview(previous);};
  const start=(id:number,touch:boolean,x:number,y:number)=>{
    if(origin||options.enabled?.()===false)return;
    if(options.mobile)keepClosedKeyboard(handle);
    origin={id,touch,x,y,height:options.measure(),value:options.value(),at:performance.now()};moved=false;
    const arm=()=>{timer=undefined;if(!origin)return;armed=true;options.active?.(true);handle.classList.add('resize-ready');if(touch)navigator.vibrate?.(12);};
    if(touch&&options.mobile)timer=setTimeout(arm,touchSettings().longPressTimeout);else arm();
  };
  const move=(x:number,y:number,event:Event)=>{
    if(!origin)return;
    if(!armed){if(Math.hypot(x-origin.x,y-origin.y)>touchSettings().touchSlop)cancel();return;}
    if(event.cancelable)event.preventDefault();
    if(Math.abs(y-origin.y)>2)moved=true;
    if(moved)options.preview(Math.max(60,Math.min(4000,Math.round(origin.height+y-origin.y))));
  };
  const end=(x:number,y:number,event:Event)=>{
    if(!origin)return;
    const now=performance.now(),tap=!armed&&!moved&&now-origin.at<touchSettings().longPressTimeout,touch=origin.touch;
    const height=moved?Math.max(60,Math.min(4000,Math.round(origin.height+y-origin.y))):null;
    if(touch&&event.cancelable)event.preventDefault();event.stopPropagation();clear();
    if(height!==null)options.commit(height);
    if(tap&&lastTap&&now-lastTap<touchSettings().doubleTapTimeout&&Math.hypot(x-lastX,y-lastY)<24){lastTap=0;options.preview(null);options.commit(null);}
    else{lastTap=tap?now:0;lastX=x;lastY=y;}
  };
  const pointerDown=(event:PointerEvent)=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();if(event.pointerType==='touch')return;start(event.pointerId,false,event.clientX,event.clientY);if(origin)handle.setPointerCapture(event.pointerId);};
  const pointerMove=(event:PointerEvent)=>{if(origin&&!origin.touch&&origin.id===event.pointerId)move(event.clientX,event.clientY,event);};
  const pointerUp=(event:PointerEvent)=>{if(origin&&!origin.touch&&origin.id===event.pointerId)end(event.clientX,event.clientY,event);};
  const pointerCancel=(event:PointerEvent)=>{if(origin&&!origin.touch&&origin.id===event.pointerId)cancel();};
  const touchStart=(event:TouchEvent)=>{if(event.touches.length!==1){cancel();return;}event.stopPropagation();const point=event.changedTouches[0];start(point.identifier,true,point.clientX,point.clientY);};
  const touchMove=(event:TouchEvent)=>{if(!origin?.touch)return;const point=[...event.changedTouches].find(point=>point.identifier===origin!.id);if(point)move(point.clientX,point.clientY,event);};
  const touchEnd=(event:TouchEvent)=>{if(!origin?.touch)return;const point=[...event.changedTouches].find(point=>point.identifier===origin!.id);if(point)end(point.clientX,point.clientY,event);};
  const reset=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();if(options.enabled?.()===false)return;clear();options.preview(null);options.commit(null);};
  const prevent=(event:Event)=>{event.preventDefault();event.stopPropagation();};
  handle.addEventListener('pointerdown',pointerDown);handle.addEventListener('pointermove',pointerMove);handle.addEventListener('pointerup',pointerUp);handle.addEventListener('pointercancel',pointerCancel);handle.addEventListener('lostpointercapture',pointerCancel);
  handle.addEventListener('touchstart',touchStart,{passive:true});handle.addEventListener('touchmove',touchMove,{passive:false});handle.addEventListener('touchend',touchEnd,{passive:false});handle.addEventListener('touchcancel',cancel);
  handle.addEventListener('dblclick',reset);handle.addEventListener('click',prevent);handle.addEventListener('contextmenu',prevent);
  return()=>{cancel();handle.removeEventListener('pointerdown',pointerDown);handle.removeEventListener('pointermove',pointerMove);handle.removeEventListener('pointerup',pointerUp);handle.removeEventListener('pointercancel',pointerCancel);handle.removeEventListener('lostpointercapture',pointerCancel);handle.removeEventListener('touchstart',touchStart);handle.removeEventListener('touchmove',touchMove);handle.removeEventListener('touchend',touchEnd);handle.removeEventListener('touchcancel',cancel);handle.removeEventListener('dblclick',reset);handle.removeEventListener('click',prevent);handle.removeEventListener('contextmenu',prevent);};
}
