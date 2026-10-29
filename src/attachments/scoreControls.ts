import {mountScore} from './scoreAdapter';
import {createScoreToolbar,scoreIcon} from './scoreToolbar';
import {type AttachmentViewState,reportAttachmentViewError} from './viewState';
import {resizeAttachmentViewport} from './viewportResize';
const instances=new Set<{pause():void}>();
/** Controls follow the official Playground: real rendered tracks, audible
 * playback position, seek, volume and synth readiness. Everything is view state. */
export async function mountScoreControls(host:HTMLElement,path:string,signal:AbortSignal,context:{source?:string;embedded?:boolean;state?:AttachmentViewState}={}){
  const {play,stop,loop,metronome,speed,zoom,layout,tracks,seek,volume,time,status,viewport,sheet}=createScoreToolbar(host,signal);
  const saved=context.state?.get()||{};
  const value=(control:HTMLSelectElement,value:string)=>{if(![...control.options].some(option=>option.value===value))control.add(new Option(value,value));control.value=value;};
  value(zoom,String(saved.scoreZoom??.85));value(speed,String(saved.scoreSpeed??1));layout.value=saved.scoreLayout||'page';volume.value=String(saved.scoreVolume??70);
  loop.setAttribute('aria-pressed',String(!!saved.scoreLoop));metronome.setAttribute('aria-pressed',String(!!saved.scoreMetronome));
  if(context.embedded)resizeAttachmentViewport(viewport,'调整乐谱视窗高度',signal,context.state,()=>Math.max(180,Math.min(400,sheet.getBoundingClientRect().height)));
  const mounted=await mountScore(sheet,path,signal,context.source,{scale:Number(zoom.value),layout:layout.value});if(!mounted||signal.aborted)return;
  const {api,alpha}=mounted;let enabled=false,pendingPlay=false,scrubbing=false,total=0,lastTime='',lastPercent=-1,audibleKey='',optionKey='',fitOnRender=false,positionRestored=false;
  api.renderFinished.on(()=>{
    if(signal.aborted||!fitOnRender)return;
    fitOnRender=false;
    // Fit once after all initial tracks are laid out. Later zoom, playback and
    // layout events must preserve the user's native viewport resize.
    viewport.style.height=Math.max(180,Math.min(400,sheet.getBoundingClientRect().height))+'px';
  });
  const duration=(value:number)=>{const seconds=Math.floor(Math.max(0,value)/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
  const position=(current:number,end=total)=>{
    total=Number.isFinite(end)&&end>0?end:total;
    const label=duration(current)+' / '+(total?duration(total):'--:--');if(label!==lastTime){time.textContent=label;lastTime=label;seek.setAttribute('aria-valuetext',label);}
    const max=String(total||1);if(seek.max!==max)seek.max=max;
    if(!scrubbing){const value=String(Math.min(total||1,current));if(seek.value!==value)seek.value=value;}seek.disabled=!enabled||!api.isReadyForPlayback||!total;
  };
  const other={pause:()=>{pendingPlay=false;api.pause();}};instances.add(other);
  signal.addEventListener('abort',()=>instances.delete(other),{once:true});
  const options=()=>{
    const controls=[speed.value,volume.value,loop.getAttribute('aria-pressed'),metronome.getAttribute('aria-pressed')].join(':');
    if(controls!==optionKey){optionKey=controls;api.playbackSpeed=Number(speed.value);api.masterVolume=Number(volume.value)/100;api.isLooping=loop.getAttribute('aria-pressed')==='true';api.metronomeVolume=metronome.getAttribute('aria-pressed')==='true'?0.5:0;}
    const audible=new Set(api.tracks.map(track=>track.index));
    const key=[...audible].join(',');
    if(api.score&&audibleKey!==key){audibleKey=key;for(const track of api.score.tracks)api.changeTrackMute([track],!audible.has(track.index));}
  };
  const renderedTracks=()=>{
    if(signal.aborted||!api.score)return;
    const actual=api.tracks;
    tracks.value=actual.length===api.score.tracks.length?'all':String(actual[0]?.index??0);
    if(enabled)options();
  };
  api.renderStarted.on(renderedTracks);
  api.playerReady.on(()=>{
    if(signal.aborted)return;play.disabled=false;stop.disabled=false;status.textContent='';options();if(!positionRestored){positionRestored=true;const point=context.state?.get().scorePosition??saved.scorePosition;if(point)api.timePosition=Math.min(point,api.endTime);}position(api.timePosition,api.endTime);
    if(pendingPlay){pendingPlay=false;api.play();}
  });
  api.midiLoaded.on(event=>{if(!signal.aborted)position(event.currentTime,event.endTime);});
  api.soundFontLoad.on(event=>{if(signal.aborted)return;const percent=Math.floor(event.loaded/Math.max(1,event.total)*100);if(percent!==lastPercent){status.textContent='音源 '+percent+'%';lastPercent=percent;}});
  api.playerStateChanged.on((event:{state:number})=>{
    if(signal.aborted)return;const playing=event.state===alpha.synth.PlayerState.Playing;play.innerHTML=scoreIcon(playing?'pause':'play');play.title=playing?'暂停乐谱':'播放乐谱';play.setAttribute('aria-label',play.title);host.dataset.playing=String(playing);
    if(enabled&&!playing)context.state?.update({scorePosition:api.timePosition});
  });
  api.playerPositionChanged.on(event=>{if(!signal.aborted&&!scrubbing)position(event.currentTime,event.endTime);});
  play.onclick=()=>{
    for(const item of instances)if(item!==other)item.pause();
    if(!enabled){
      enabled=true;pendingPlay=true;play.disabled=true;play.title='正在加载音源';status.textContent='加载音源…';
      api.settings.player.outputMode=alpha.PlayerOutputMode.WebAudioAudioWorklets;
      api.settings.player.enablePlayer=true;api.settings.player.soundFont=new URL('vendor/alphatab/soundfont/sonivox.sf3',document.baseURI).href;
      api.settings.player.scrollElement=viewport;api.settings.player.enableUserInteraction=true;api.settings.player.enableCursor=true;api.settings.player.enableElementHighlighting=true;
      api.updateSettings();
    }else if(api.isReadyForPlayback){options();api.playPause();}
    else{pendingPlay=true;play.disabled=true;api.loadSoundFont(new URL('vendor/alphatab/soundfont/sonivox.sf3',document.baseURI).href);}
  };
  stop.onclick=()=>{pendingPlay=false;api.stop();position(0);};
  seek.oninput=()=>{scrubbing=true;position(Number(seek.value));};
  seek.onchange=()=>{const value=Number(seek.value);scrubbing=false;if(api.isReadyForPlayback)api.timePosition=value;position(value);context.state?.update({scorePosition:value});};
  seek.onpointercancel=()=>{scrubbing=false;position(api.timePosition);};
  volume.oninput=()=>{volume.title='音量 '+volume.value+'%';if(enabled)options();context.state?.update({scoreVolume:Number(volume.value)});};
  for(const control of [loop,metronome])control.onclick=()=>{control.setAttribute('aria-pressed',String(control.getAttribute('aria-pressed')!=='true'));if(enabled)options();context.state?.update(control===loop?{scoreLoop:control.getAttribute('aria-pressed')==='true'}:{scoreMetronome:control.getAttribute('aria-pressed')==='true'});};
  speed.onchange=()=>{if(enabled)options();context.state?.update({scoreSpeed:Number(speed.value)});};
  zoom.onchange=()=>{api.settings.display.scale=Number(zoom.value);api.updateSettings();api.render();context.state?.update({scoreZoom:Number(zoom.value)});};
  layout.onchange=()=>{api.settings.display.layoutMode=layout.value==='horizontal'?alpha.LayoutMode.Horizontal:alpha.LayoutMode.Page;api.updateSettings();api.render();context.state?.update({scoreLayout:layout.value as 'page'|'horizontal'});};
  tracks.onchange=()=>{if(api.score){const selected=tracks.value==='all'?api.score.tracks:[api.score.tracks[Number(tracks.value)]];if(selected.every(Boolean)){api.renderTracks(selected);if(enabled)options();context.state?.update({scoreTrack:tracks.value==='all'?'all':Number(tracks.value)});}}};
  await mounted.ready;if(signal.aborted)return;
  if(api.score){
    tracks.replaceChildren(new Option('全部音轨','all'));
    for(const track of api.score.tracks)tracks.add(new Option(track.name||'音轨 '+(track.index+1),String(track.index)));
    tracks.disabled=api.score.tracks.length<2;
    api.score.stylesheet.singleTrackTrackNamePolicy=alpha.model.TrackNamePolicy.FirstSystem;
    const selected=typeof saved.scoreTrack==='number'&&api.score.tracks[saved.scoreTrack]?[api.score.tracks[saved.scoreTrack]]:api.score.tracks;
    fitOnRender=!!context.embedded&&!saved.height;api.renderTracks(selected);renderedTracks();
  }
  api.error.on(()=>{if(!signal.aborted){play.disabled=false;pendingPlay=false;status.textContent='播放失败，可重试';}});
  play.disabled=false;
  let seen=saved;
  const applyState=()=>{
    const next=context.state?.get()||{},previous=seen;seen=next;let render=false;
    if(next.scoreZoom!==undefined&&Number(zoom.value)!==next.scoreZoom){value(zoom,String(next.scoreZoom));api.settings.display.scale=next.scoreZoom;render=true;}
    if(next.scoreLayout&&layout.value!==next.scoreLayout){layout.value=next.scoreLayout;api.settings.display.layoutMode=next.scoreLayout==='horizontal'?alpha.LayoutMode.Horizontal:alpha.LayoutMode.Page;render=true;}
    if(next.scoreSpeed!==undefined)value(speed,String(next.scoreSpeed));if(next.scoreVolume!==undefined)volume.value=String(next.scoreVolume);
    if(next.scoreLoop!==undefined)loop.setAttribute('aria-pressed',String(next.scoreLoop));if(next.scoreMetronome!==undefined)metronome.setAttribute('aria-pressed',String(next.scoreMetronome));
    const trackChanged=next.scoreTrack!==undefined&&String(next.scoreTrack)!==tracks.value;
    if(render)api.updateSettings();
    if(trackChanged&&api.score){const selected=next.scoreTrack==='all'?api.score.tracks:[api.score.tracks[Number(next.scoreTrack)]];if(selected.every(Boolean))api.renderTracks(selected);}
    else if(render)api.render();
    if(enabled)options();
    if(next.scorePosition!==previous.scorePosition&&next.scorePosition!==undefined&&api.isReadyForPlayback&&Math.abs(api.timePosition-next.scorePosition)>1)api.timePosition=Math.min(next.scorePosition,api.endTime);
  };
  const unsubscribe=context.state?.subscribe(applyState);applyState();
  // The renderer must measure the content width, without counting outer
  // padding or a stale pre-scrollbar width retained by a previous layout.
  let width=0,frame=0;
  const resize=new ResizeObserver(()=>{
    const next=Math.floor(sheet.clientWidth);if(next<=0||next===width)return;width=next;
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(signal.aborted||!api.score)return;if(Math.abs(api.renderer.width-width)>1){api.renderer.width=width;api.renderer.resizeRender();}});
  });resize.observe(viewport);
  signal.addEventListener('abort',()=>{unsubscribe?.();resize.disconnect();cancelAnimationFrame(frame);void context.state?.flush().catch(reportAttachmentViewError);},{once:true});
  return mounted;
}
