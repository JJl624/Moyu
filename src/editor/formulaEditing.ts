import {TextSelection} from '@milkdown/kit/prose/state';
import {closeHistory} from '@milkdown/kit/prose/history';
import type {EditorView} from '@milkdown/kit/prose/view';
import {parseInline,type InlineAst} from '../inlineSyntax';
import type {FormulaSession} from '../formulaSession';
import {focusEditorSelection,readNativeSelection} from './selectionOwnership';

/** A formula dialog owns a draft and one immutable document snapshot, never DOM offsets. */
export function prepareFormula(view:EditorView,target?:HTMLElement):FormulaSession|null{
  if(view.isDestroyed||!view.editable||view.composing)return null;
  if(!target)readNativeSelection(view);
  const doc=view.state.doc,selection=view.state.selection;
  let from=selection.from,to=selection.to,value='',display=false,found=false,inline=false;
  doc.descendants((node,pos)=>{
    if(found)return false;
    const dom=view.nodeDOM(pos),clicked=target&&dom instanceof Element&&(dom===target||dom.contains(target));
    const selected=!target&&selection.from>=pos&&selection.to<=pos+node.nodeSize;
    if((node.type.name==='math_block'||node.type.name==='code_block'&&/^(latex|math)$/i.test(node.attrs.language||''))&&(clicked||selected)){
      from=pos+1;to=pos+node.nodeSize-1;value=node.textContent;display=true;found=true;return false;
    }
    if(node.type.name!=='resource_link'||!(clicked||selected))return;
    const candidates:InlineAst[]=[];
    const walk=(ast:InlineAst)=>{if(ast.type==='inlineMath')candidates.push(ast);else ast.children?.forEach(walk);};
    parseInline(node.textContent)?.nodes.forEach(walk);
    const pointed=target?.closest<HTMLElement>('[data-source-offset]')?.dataset.sourceOffset;
    const offset=pointed===undefined?selection.head-pos-1:Number(pointed);
    const formula=candidates.find(ast=>offset>=(ast.position?.start.offset||0)&&offset<=(ast.position?.end.offset||0))||candidates[0];
    if(formula){from=pos+1+formula.position!.start.offset!;to=pos+1+formula.position!.end.offset!;value=formula.value||'';inline=true;found=true;return false;}
  });
  const insideSource=selection.$from.parent.type.name==='resource_link';
  if(!found){
    if(target||!selection.$from.sameParent(selection.$to)||!selection.$from.parent.inlineContent||selection.$from.parent.type.spec.code&&!insideSource||insideSource&&parseInline(selection.$from.parent.textContent)?.kind==='inlineCode')return null;
    value=doc.textBetween(from,to);inline=true;
  }
  let expected=doc,used=false;
  return {value,display,
    restore(){if(!view.isDestroyed&&view.state.doc===expected)focusEditorSelection(view,'restore');},
    apply(latex){
      if(used||view.isDestroyed||!view.editable||view.composing||view.state.doc!==doc)return false;
      used=true;
      if(found&&latex===value)return true;
      const text=display?latex:latex.replace(/\r?\n/g,' '),replacement=inline?'$'+text+'$':text;
      if(found&&doc.textBetween(from,to)===replacement)return true;
      const tr=closeHistory(view.state.tr);
      if(!found&&!insideSource){const node=doc.type.schema.nodes.resource_link.create(null,doc.type.schema.text(replacement));tr.replaceWith(from,to,node);}
      else tr.insertText(replacement,from,to);
      const head=Math.min(tr.doc.content.size,from+replacement.length+(!found&&!insideSource?1:0));
      tr.setSelection(TextSelection.near(tr.doc.resolve(head)));view.dispatch(tr);
      expected=view.state.doc;focusEditorSelection(view,'restore');return true;
    },
  };
}
