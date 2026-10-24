import {ChevronRight,FolderOpen,Settings2,Trash2,Upload,type LucideIcon} from 'lucide-react';
import {useId,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {themes} from '../themes';
import type {SavePolicy} from '../useWorkspace';
import mobileBuild from '../../shared/mobile-build.json';
import {MobileSelect} from './MobileSelect';
import {MobileUpdateSettings} from './MobileUpdateSettings';
import type {MobileUpdateController} from './useMobileUpdates';
const themeNames:Record<string,string>={frame:'Frame',nord:'Nord',paper:'Paper',github:'GitHub',dracula:'Dracula',solarized:'Solarized',forest:'Forest',rose:'Rosé Pine'};

export interface MobilePreferences {
  themeChoice:string;preset:string;uiSize:number;fontSize:number;codeFontSize:number;codeWrap:boolean;lineHeight:number;tableZoom:number;savePolicy:SavePolicy;
}
function Group({title,children}:{title:string;children:ReactNode}){
  const id=useId();
  return <section className='mobile-settings-group' aria-labelledby={id}><h2 id={id}>{title}</h2><div className='mobile-settings-section'>{children}</div></section>;
}
function Range({label,value,min,max,step=1,display,change}:{label:string;value:number;min:number;max:number;step?:number;display:string;change(value:number):void}){
  const id=useId(),gesture=useRef<{x:number;y:number;axis:'pending'|'horizontal'|'vertical';value:number}|null>(null),[preview,setPreview]=useState<number|null>(null);
  const shown=preview??value;
  return <label className='mobile-setting-row'><span>{label}</span><div className='mobile-setting-range'><input id={id} aria-label={label} aria-valuetext={display} type='range' min={min} max={max} step={step} value={shown} style={{'--range-progress':100*(shown-min)/(max-min)+'%',touchAction:'pan-y'} as CSSProperties}
    onPointerDown={event=>{if(event.pointerType==='touch')gesture.current={x:event.clientX,y:event.clientY,axis:'pending',value};}}
    onPointerMove={event=>{const drag=gesture.current;if(!drag)return;const dx=Math.abs(event.clientX-drag.x),dy=Math.abs(event.clientY-drag.y);if(drag.axis==='pending'&&Math.max(dx,dy)>8)drag.axis=dx>dy?'horizontal':'vertical';if(drag.axis==='horizontal'){const box=event.currentTarget.getBoundingClientRect();drag.value=Number((min+Math.round(Math.max(0,Math.min(1,(event.clientX-box.left-6)/(box.width-12)))*(max-min)/step)*step).toFixed(4));setPreview(drag.value);}}}
    onPointerUp={()=>{const drag=gesture.current;gesture.current=null;setPreview(null);if(drag?.axis==='horizontal')change(drag.value);}}
    onPointerCancel={()=>{gesture.current=null;setPreview(null);}}
    onChange={event=>{if(!gesture.current)change(Number(event.target.value));}}/><output htmlFor={id}>{display}</output></div></label>;
}
function Link({label,value,icon:Icon,click,ariaLabel=label}:{label:string;value?:string;icon:LucideIcon;click():void;ariaLabel?:string}){
  return <button className='mobile-setting-link' aria-label={ariaLabel} onClick={click}><Icon size={19} aria-hidden='true'/><span>{label}</span>{value&&<small title={value}>{value}</small>}<ChevronRight size={17} aria-hidden='true'/></button>;
}
export function MobileSettings({value,change,vaultName,syncStatus,vault,sync,shortcuts,trash,licenses,updates}:{
  value:MobilePreferences;change(patch:Partial<MobilePreferences>):void;vaultName:string;syncStatus:string;
  vault():void;sync():void;shortcuts():void;trash():void;licenses():void;
  updates:MobileUpdateController;
}){
  return <div className='mobile-settings' aria-label='偏好设置'>
    <div className='mobile-list-heading'><h1>设置</h1></div>
    <Group title='界面'>
      <MobileSelect label='外观' value={value.themeChoice} change={themeChoice=>change({themeChoice})} options={[{value:'system',label:'跟随系统'},{value:'light',label:'浅色'},{value:'dark',label:'深色'}]}/>
      <MobileSelect label='配色' value={value.preset} change={preset=>change({preset})} options={themes.map(theme=>({value:theme.id,label:themeNames[theme.id]}))}/>
      <Range label='界面字号' value={value.uiSize} min={10} max={24} display={value.uiSize+' px'} change={uiSize=>change({uiSize})}/>
    </Group>
    <Group title='字体与排版'>
      <Range label='正文字号' value={value.fontSize} min={10} max={24} display={value.fontSize+' px'} change={fontSize=>change({fontSize})}/>
      <Range label='代码块字号' value={value.codeFontSize} min={10} max={24} display={value.codeFontSize+' px'} change={codeFontSize=>change({codeFontSize})}/>
      <label className='mobile-setting-row mobile-setting-toggle'><span>代码块自动换行</span><input aria-label='代码块自动换行' type='checkbox' role='switch' checked={value.codeWrap} onChange={event=>change({codeWrap:event.target.checked})}/></label>
      <Range label='行高' value={value.lineHeight} min={1.4} max={2.4} step={.1} display={value.lineHeight.toFixed(1)+' 倍'} change={lineHeight=>change({lineHeight})}/>
      <Range label='表格缩放' value={value.tableZoom} min={50} max={150} step={10} display={value.tableZoom+'%'} change={tableZoom=>change({tableZoom})}/>
    </Group>
    <Group title='编辑'>
      <div className='mobile-save-setting'><MobileSelect label='保存方式' value={value.savePolicy} change={savePolicy=>change({savePolicy:savePolicy as SavePolicy})} options={[{value:'realtime',label:'自动保存'},{value:'close',label:'离开时保存'},{value:'manual',label:'手动保存'}]}/>
      <p className='mobile-setting-help'>{value.savePolicy==='realtime'?'停止输入、离开文档或进入后台时保存。':value.savePolicy==='close'?'离开文档或进入后台时保存。':'点击“保存”或确认保存后写入文档。草稿只保留在本机。'}</p></div>
      <Link label='编辑工具栏' icon={Settings2} click={shortcuts}/>
    </Group>
    <Group title='文件与同步'>
      <Link label='知识库' ariaLabel='选择知识库' value={vaultName} icon={FolderOpen} click={vault}/>
      <Link label='WebDAV 同步' value={syncStatus} icon={Upload} click={sync}/>
      <Link label='回收站' icon={Trash2} click={trash}/>
    </Group>
    <Group title='软件更新'><MobileUpdateSettings updates={updates}/></Group>
    <footer className='mobile-about'><span>墨屿 Android <span>{mobileBuild.version}</span></span><button onClick={licenses}>开源许可</button></footer>
  </div>;
}
