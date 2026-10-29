import {autoUpdate,computePosition,flip,shift} from '@floating-ui/dom';
import type {CodeMirrorBlock} from '@milkdown/kit/component/code-block';
import {keepCodeControlFocus} from './controlFocus';
import {isComposingKey} from '../keyboardComposition';
import {registerControlOverlay} from '../controlOverlay';
import './codeLanguageMenu.css';

type Language={name:string;alias:readonly string[]};

/** Ordinary and HTML fences use the same language control and selection path. */
export function codeLanguageMenu(block:CodeMirrorBlock,languages:readonly Language[]){
  const dom=block.dom,doc=dom.ownerDocument;
  let menu:HTMLDivElement|undefined,trigger:HTMLButtonElement|undefined,positionCleanup:(()=>void)|undefined,releaseOverlay:(()=>void)|undefined;
  const mobile=()=>!!dom.closest('.mobile-app');
  const close=()=>{
    positionCleanup?.();positionCleanup=undefined;
    trigger?.setAttribute('data-expanded','false');trigger?.setAttribute('aria-expanded','false');
    doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',escape,true);
    releaseOverlay?.();releaseOverlay=undefined;window.removeEventListener('moyu-mobile-pause',close);
    menu?.remove();menu=undefined;trigger=undefined;
  };
  const outside=(event:Event)=>{if(!menu?.contains(event.target as Node)&&!trigger?.contains(event.target as Node))close();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!isComposingKey(event)){event.preventDefault();event.stopPropagation();const previous=trigger;close();previous?.focus({preventScroll:true});}};
  const guard=(event:Event)=>{
    const target=event.target as Element;
    if(target.closest('.tools,.code-language-menu')&&!target.closest('input,textarea,select'))keepCodeControlFocus(dom,event);
  };
  const open=(button:HTMLButtonElement)=>{
    close();trigger=button;button.dataset.expanded='true';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','true');
    menu=doc.createElement('div');menu.className='code-language-menu';menu.contentEditable='false';
    const search=doc.createElement('input');search.type='search';search.placeholder='搜索语言';search.setAttribute('aria-label','搜索代码语言');search.autocomplete='off';search.spellcheck=false;
    const list=doc.createElement('div');list.className='language-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','代码语言');
    const selected=String(block.node.attrs.language||'text').toLowerCase();
    const render=()=>{
      const query=search.value.trim().toLowerCase();list.replaceChildren();
      const selectedLanguage=languages.find(item=>item.name.toLowerCase()===selected||item.alias.some(alias=>alias.toLowerCase()===selected));
      const matches=languages.filter(item=>item.name.toLowerCase().includes(query)||item.alias.some(alias=>alias.toLowerCase().includes(query)));
      if(selectedLanguage&&matches.includes(selectedLanguage)){matches.splice(matches.indexOf(selectedLanguage),1);matches.unshift(selectedLanguage);}
      for(const language of matches){
        const option=doc.createElement('button');option.type='button';option.className='language-list-item';option.dataset.language=language.name;option.textContent=language.name;
        option.setAttribute('role','option');option.setAttribute('aria-selected',String(language===selectedLanguage));
        option.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();close();if(block.view.editable)block.setLanguage(language.name);});
        list.append(option);
      }
      if(!matches.length){const empty=doc.createElement('div');empty.className='language-no-result';empty.textContent='无匹配语言';list.append(empty);}
    };
    search.addEventListener('input',render);
    menu.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp','Enter'].includes(event.key)||isComposingKey(event))return;
      const options=[...list.querySelectorAll<HTMLButtonElement>('.language-list-item')];if(!options.length)return;
      const current=options.indexOf(doc.activeElement as HTMLButtonElement);
      if(event.key==='Enter'){event.preventDefault();options[Math.max(0,current)].click();return;}
      event.preventDefault();const next=options[current<0?(event.key==='ArrowDown'?0:options.length-1):(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length];next.focus({preventScroll:true});
      const bounds=list.getBoundingClientRect(),box=next.getBoundingClientRect();if(box.bottom>bounds.bottom)list.scrollTop+=box.bottom-bounds.bottom;else if(box.top<bounds.top)list.scrollTop-=bounds.top-box.top;
    });
    menu.append(search,list);dom.append(menu);render();
    const current=menu;
    positionCleanup=autoUpdate(button,current,()=>{void computePosition(button,current,{strategy:'fixed',placement:'bottom-start',middleware:[flip({padding:8}),shift({padding:8})]}).then(({x,y})=>{if(current.isConnected)Object.assign(current.style,{left:x+'px',top:y+'px'});});});
    doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',escape,true);
    releaseOverlay=registerControlOverlay(close);window.addEventListener('moyu-mobile-pause',close);
    // On a phone the search field is an explicit typing action, not a side
    // effect of opening a language menu. Desktop keyboard search stays ready.
    if(!mobile())search.focus({preventScroll:true});
  };
  const click=(event:MouseEvent)=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button.language-button');
    if(!button||!dom.contains(button))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(trigger===button){close();return;}
    if(block.view.editable)open(button);
  };
  dom.addEventListener('pointerdown',guard,true);dom.addEventListener('mousedown',guard,true);dom.addEventListener('click',click,true);
  return()=>{close();dom.removeEventListener('pointerdown',guard,true);dom.removeEventListener('mousedown',guard,true);dom.removeEventListener('click',click,true);};
}
