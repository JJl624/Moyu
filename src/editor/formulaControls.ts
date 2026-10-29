import type {CodeMirrorBlock} from '@milkdown/kit/component/code-block';
import {prepareFormula} from './formulaEditing';
import {requestFormula} from '../formulaSession';

/** The stock node view creates and tears down its toolbar as it enters/leaves
 * the viewport. Keep our action in that toolbar's normal layout and lifecycle. */
export function formulaControls(block:CodeMirrorBlock){
  const button=document.createElement('button');button.type='button';button.className='formula-assist-trigger';button.textContent='辅助输入';button.title='公式辅助输入';button.setAttribute('aria-label','公式辅助输入');button.contentEditable='false';
  button.onmousedown=event=>event.preventDefault();button.onclick=()=>requestFormula(prepareFormula(block.view,block.dom));
  let destroyed=false;
  const attach=()=>{
    if(destroyed)return;
    const group=block.dom.querySelector('.tools-button-group');
    button.disabled=!block.view.editable;
    if(group){if(button.parentElement!==group)group.prepend(button);}
    else button.remove();
  };
  // Observe host children only: text edits inside CodeMirror need no scanning.
  const observer=new MutationObserver(attach);observer.observe(block.dom,{childList:true});attach();
  const destroy=block.destroy.bind(block);
  block.destroy=()=>{destroyed=true;observer.disconnect();button.remove();destroy();};
  return block;
}
