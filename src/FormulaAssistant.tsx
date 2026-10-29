import {useEffect,useRef,useState} from 'react';
import {ChevronRight,Code2} from 'lucide-react';
import type {MathfieldElement} from 'mathlive';
import {Modal} from './Modal';
import type {FormulaSession} from './formulaSession';
import './formulaAssistant.css';

export default function FormulaAssistant(){
  const [session,setSession]=useState<FormulaSession|null>(null),[value,setValue]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const host=useRef<HTMLDivElement>(null),keyboardHost=useRef<HTMLDivElement>(null),field=useRef<MathfieldElement|null>(null);
  useEffect(()=>{const open=(event:Event)=>{const next=(event as CustomEvent<FormulaSession>).detail;setValue(next.value);setError('');setReady(false);setSession(next);};window.addEventListener('moyu-edit-formula',open);return()=>window.removeEventListener('moyu-edit-formula',open);},[]);
  useEffect(()=>{
    if(!session)return;let alive=true,dispose=()=>{};
    void import('mathlive').then(({MathfieldElement})=>{
      if(!alive)return;
      MathfieldElement.fontsDirectory=new URL('vendor/mathlive/fonts/',document.baseURI).href;
      MathfieldElement.soundsDirectory=null;MathfieldElement.locale='zh-cn';
      const mf=new MathfieldElement();mf.mathVirtualKeyboardPolicy='manual';mf.value=session.value;mf.setAttribute('aria-label','可视公式输入');
      field.current=mf;host.current!.replaceChildren(mf);
      const vk=window.mathVirtualKeyboard;vk.container=keyboardHost.current;
      const geometry=()=>{if(keyboardHost.current){keyboardHost.current.style.height=vk.visible?vk.boundingRect.height+'px':'0px';keyboardHost.current.dataset.open=String(vk.visible);}};
      vk.addEventListener('geometrychange',geometry);vk.addEventListener('virtual-keyboard-toggle',geometry);
      const input=()=>{setError('');setValue(mf.value);};mf.addEventListener('input',input);setReady(true);mf.focus();
      dispose=()=>{vk.removeEventListener('geometrychange',geometry);vk.removeEventListener('virtual-keyboard-toggle',geometry);vk.hide();vk.container=null;mf.removeEventListener('input',input);mf.remove();field.current=null;};
    }).catch(reason=>{if(alive)setError('公式输入器加载失败：'+reason.message);});
    return()=>{alive=false;dispose();};
  },[session]);
  const close=()=>{setSession(null);session?.restore();};
  if(!session)return null;
  const apply=()=>{
    if(!ready||!value.trim())return;
    if(/\\placeholder\b/.test(value)){setError('请先填写公式中的空位。');return;}
    if(session.apply(value)){setSession(null);session.restore();}
    else setError('文档已改变，请关闭后重新打开公式。');
  };
  return <Modal title="公式" wide onClose={close} restoreFocus={false}>
    <div className="formula-assistant" onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();apply();}}}>
      <div className="formula-field" ref={host} aria-busy={!ready}/>
      <div className="formula-keyboard" ref={keyboardHost}/>
      <details className="formula-source" key={session.value}>
        <summary><Code2 size={14}/>LaTeX<ChevronRight size={13}/></summary>
        <textarea aria-label="公式 LaTeX" rows={3} value={value} spellCheck={false} onChange={event=>{setError('');setValue(event.target.value);field.current?.setValue(event.target.value,{silenceNotifications:true});}}/>
      </details>
      {error&&<p className="formula-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer"><button className="secondary-button" onClick={close}>取消</button><button className="primary-button" disabled={!ready||!value.trim()} title="应用 (Ctrl+Enter)" onClick={apply}>应用</button></div>
  </Modal>;
}
