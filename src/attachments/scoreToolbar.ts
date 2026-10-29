const icons:Record<string,string>={
  play:'<path d="m7 4 13 8-13 8Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',
  repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  metronome:'<path d="m12 3 7 17H5L12 3Zm0 13 5-7"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
export const scoreIcon=(name:string)=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
function button(label:string,name:string){
  const element=document.createElement('button');element.type='button';element.title=label;element.setAttribute('aria-label',label);element.innerHTML=scoreIcon(name);return element;
}
function select(label:string,options:Array<[string,string]>,value:string){
  const element=document.createElement('select');element.title=label;element.setAttribute('aria-label',label);
  for(const [value,label]of options)element.add(new Option(label,value));element.value=value;return element;
}
function optionRow(label:string,control:HTMLElement){
  const row=document.createElement('label');row.className='score-option-row';row.append(document.createTextNode(label),control);return row;
}
/** View-only controls; no score or editor commands belong here. The native
 * popover avoids clipping inside narrow/list previews and handles dismissal. */
export function createScoreToolbar(host:HTMLElement,signal:AbortSignal){
  host.classList.add('score-player');
  const toolbar=document.createElement('div');toolbar.className='attachment-controls score-controls score-transport';toolbar.dataset.attachmentControl='true';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','乐谱控件');
  const viewport=document.createElement('div');viewport.className='attachment-score-viewport';viewport.dataset.attachmentControl='true';viewport.tabIndex=0;viewport.setAttribute('aria-label','乐谱视图');
  const sheet=document.createElement('div');sheet.className='attachment-score-sheet';viewport.append(sheet);
  const play=button('播放乐谱','play'),stop=button('停止播放','stop'),loop=button('循环播放','repeat'),metronome=button('节拍器','metronome');play.className='score-play';play.disabled=true;stop.disabled=true;
  for(const control of [loop,metronome]){control.setAttribute('aria-pressed','false');control.append(document.createTextNode(control.title));}
  const speed=select('播放速度',[['0.5','0.5×'],['0.75','0.75×'],['1','1×'],['1.25','1.25×'],['1.5','1.5×'],['2','2×']],'1');
  const zoom=select('乐谱缩放',[['0.5','50%'],['0.7','70%'],['0.85','85%'],['1','100%'],['1.25','125%'],['1.5','150%']],'0.85');
  const layout=select('乐谱布局',[['page','分页'],['horizontal','横向']],'page');
  const tracks=select('乐谱音轨',[['all','全部音轨']],'all');tracks.className='score-tracks';tracks.disabled=true;
  const seek=document.createElement('input');seek.type='range';seek.min='0';seek.max='1';seek.step='20';seek.value='0';seek.disabled=true;seek.className='score-seek';seek.setAttribute('aria-label','播放位置');
  const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.step='1';volume.value='70';volume.setAttribute('aria-label','乐谱音量');volume.title='音量 70%';
  const time=document.createElement('span');time.className='score-play-time';time.textContent='0:00 / --:--';time.setAttribute('aria-label','播放进度');
  const status=document.createElement('div');status.className='score-player-status';status.setAttribute('role','status');status.dataset.attachmentControl='true';
  const more=button('播放选项','more'),options=document.createElement('div');options.className='score-options attachment-controls';options.popover='auto';options.dataset.attachmentControl='true';options.setAttribute('role','dialog');options.setAttribute('aria-label','播放选项');
  more.popoverTargetElement=options;more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-expanded','false');
  const toggles=document.createElement('div');toggles.className='score-option-toggles';toggles.append(loop,metronome);
  const display=document.createElement('div');display.className='score-display-options';const zoomRow=optionRow('缩放',zoom),layoutRow=optionRow('布局',layout);
  stop.className='score-stop';stop.append(document.createTextNode('停止播放'));
  options.append(display,optionRow('音量',volume),optionRow('播放速度',speed),toggles,stop);
  const position=()=>{
    if(!options.matches(':popover-open'))return;
    const anchor=more.getBoundingClientRect(),width=options.offsetWidth,height=options.offsetHeight;
    options.style.left=Math.max(8,Math.min(anchor.right-width,window.innerWidth-width-8))+'px';
    options.style.top=Math.max(8,anchor.top-height-5>=8?anchor.top-height-5:Math.min(anchor.bottom+5,window.innerHeight-height-8))+'px';
  };
  // Native autofocus runs before our fixed popover has been positioned and may
  // scroll the document, immediately dismissing the menu. Focus after opening.
  options.addEventListener('toggle',()=>{const open=options.matches(':popover-open');more.setAttribute('aria-expanded',String(open));if(open){position();volume.focus({preventScroll:true});}},{signal});
  window.addEventListener('resize',position,{signal});
  window.addEventListener('scroll',event=>{
    if(!options.matches(':popover-open')||!(event.target instanceof Node)||options.contains(event.target))return;
    const anchor=more.getBoundingClientRect(),region=more.closest('.document-scroll')?.getBoundingClientRect();
    if(anchor.bottom<Math.max(0,region?.top||0)||anchor.top>Math.min(innerHeight,region?.bottom??innerHeight))options.hidePopover();
    else position();
  },{capture:true,signal});
  signal.addEventListener('abort',()=>{if(options.matches(':popover-open'))options.hidePopover();},{once:true});
  toolbar.append(play,tracks,seek,time,zoom,layout,more);host.replaceChildren(toolbar,status,viewport,options);
  let compact:boolean|undefined;const adapt=()=>{const next=host.clientWidth<600;if(compact===next)return;compact=next;host.dataset.compact=String(next);if(next){zoomRow.append(zoom);layoutRow.append(layout);display.append(zoomRow,layoutRow);}else{display.replaceChildren();toolbar.insertBefore(zoom,more);toolbar.insertBefore(layout,more);}position();};
  const observer=new ResizeObserver(adapt);observer.observe(host);adapt();signal.addEventListener('abort',()=>observer.disconnect(),{once:true});
  return {play,stop,loop,metronome,speed,zoom,layout,tracks,seek,volume,time,status,viewport,sheet};
}
