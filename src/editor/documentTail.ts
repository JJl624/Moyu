import { Plugin, TextSelection,type Transaction } from '@milkdown/kit/prose/state';
import type {EditorView} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import {touchSettings} from '../touchSettings';
import {focusEditorSelection} from './selectionOwnership';

function selectParagraph(view:EditorView,tr:Transaction,position:number){
  const doc=view.dom.ownerDocument,active=doc.activeElement;
  if(active instanceof HTMLElement&&active.closest('.cm-editor'))active.blur();
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc,position)).scrollIntoView());focusEditorSelection(view, 'edit');
}

export const documentTail = $prose(() => new Plugin({
  view(view) {
    const parent = view.dom.parentElement!, scope = view.dom.closest('.document-scroll') || parent;
    let touch:{at:number;x:number;y:number;moved:boolean}|undefined,handledTouch=false;
    const down=(event:PointerEvent)=>{handledTouch=false;touch=event.pointerType==='touch'?{at:performance.now(),x:event.clientX,y:event.clientY,moved:false}:undefined;};
    const move=(event:PointerEvent)=>{if(touch&&Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>touchSettings().touchSlop)touch.moved=true;};
    const cancel=()=>{touch=undefined;handledTouch=false;};
    const tail = (event: MouseEvent) => {
      const target=event.target;
      if(event.type==='mousedown'&&touch){if(handledTouch){event.preventDefault();event.stopPropagation();}return;}
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        || view.composing || !view.editable
        || !(target instanceof HTMLElement)
        || touch&&(touch.moved||performance.now()-touch.at>=touchSettings().longPressTimeout)) return;
      const outer=[scope,parent,view.dom].includes(target);
      if(!outer&&(!view.dom.contains(target)||!target.matches('.content-dom,.children,.list-item,.milkdown-list-item-block,.milkdown-code-block,.codemirror-host')))return;
      const doc = view.state.doc, last = doc.lastChild;
      if (!last) return;
      // The visual gap below a resource can still belong to its list item or
      // quote. Materialize that paragraph before the browser starts input;
      // leaving the inner code editor focused can consume the first character.
      let continuation:{position:number;insert:boolean;distance:number}|undefined;
      doc.descendants((node,pos)=>{
        if(!['code_block','math_block','table'].includes(node.type.name))return;
        const dom=view.nodeDOM(pos);if(!(dom instanceof HTMLElement)||!outer&&!target.contains(dom)&&!dom.contains(target))return false;
        const rect=dom.getBoundingClientRect();
        const inner=target===dom||target.classList.contains('codemirror-host')?dom.querySelector<HTMLElement>('.tabs-frame,.cm-editor'):null;
        const distance=event.clientY-(inner||dom).getBoundingClientRect().bottom;
        const line=parseFloat(getComputedStyle(view.dom).lineHeight)||24;
        if(distance<=2||distance>line*1.5||event.clientX<rect.left||event.clientX>rect.right)return false;
        const at=doc.resolve(pos),index=at.index()+1,next=at.parent.maybeChild(index);
        if(next&&!(next.type.name==='paragraph'&&!next.content.size))return false;
        if(!at.parent.canReplaceWith(index,index,view.state.schema.nodes.paragraph))return false;
        if(!continuation||distance<continuation.distance)continuation={position:pos+node.nodeSize,insert:!next,distance};
        return false;
      });
      if(continuation){
        handledTouch=event.type==='pointerup';
        event.preventDefault();event.stopPropagation();
        const tr=view.state.tr;
        if(continuation.insert)tr.insert(continuation.position,view.state.schema.nodes.paragraph.create());
        selectParagraph(view,tr,continuation.position+1);return;
      }
      if(!outer)return;
      const dom = view.nodeDOM(doc.content.size - last.nodeSize);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect(), body = view.dom.getBoundingClientRect();
      if (event.clientY <= rect.bottom + 2 || event.clientX < body.left || event.clientX > body.right) return;
      handledTouch=event.type==='pointerup';
      event.preventDefault();
      event.stopPropagation();
      const tr = view.state.tr;
      if (last.type.name === 'paragraph' && !last.content.size) {
        tr.setSelection(TextSelection.create(doc, doc.content.size - 1));
      } else {
        tr.insert(doc.content.size, view.state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
      }
      selectParagraph(view,tr,tr.selection.head);
    };
    const up=(event:PointerEvent)=>{if(event.pointerType==='touch')tail(event);};
    // pointerup does not cancel touchend's native caret placement in Gecko.
    // Once we have created and selected a real paragraph, keep the browser
    // from placing its caret back in the non-editable code footer afterward.
    const end=(event:TouchEvent)=>{if(handledTouch&&event.cancelable)event.preventDefault();};
    scope.addEventListener('pointerdown',down as EventListener,true);
    scope.addEventListener('pointermove',move as EventListener,true);
    scope.addEventListener('pointercancel',cancel,true);
    scope.addEventListener('pointerup',up as EventListener,true);
    scope.addEventListener('touchend',end as EventListener,{capture:true,passive:false});
    scope.addEventListener('mousedown', tail as EventListener,true);
    return { destroy: () => {scope.removeEventListener('mousedown',tail as EventListener,true);scope.removeEventListener('pointerdown',down as EventListener,true);scope.removeEventListener('pointermove',move as EventListener,true);scope.removeEventListener('pointercancel',cancel,true);scope.removeEventListener('pointerup',up as EventListener,true);scope.removeEventListener('touchend',end as EventListener,true);} };
  },
}));
