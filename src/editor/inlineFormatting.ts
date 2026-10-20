import {$prose} from '@milkdown/kit/utils';
import {commandsCtx,type Editor} from '@milkdown/kit/core';
import {AllSelection,Plugin,TextSelection,type Command} from '@milkdown/kit/prose/state';
import {toggleStrongCommand,toggleEmphasisCommand,toggleInlineCodeCommand,toggleLinkCommand,isMarkSelectedCommand} from '@milkdown/kit/preset/commonmark';
import {toggleStrikethroughCommand} from '@milkdown/kit/preset/gfm';
import {readNativeSelection} from './nativeSelection';
import {toggleLinkCommand as toolbarLinkCommand} from '@milkdown/kit/component/link-tooltip';
import {attachmentMarkdown} from '../attachmentLinks';
import { inlineCodeSource } from './inlineActions';
import { richFormatState } from './richFormatState';
import { inlineKinds, withoutInlineFormat } from './inlineFormatState';
import { closeHistory } from '@milkdown/kit/prose/history';
import { inlineShortcut } from './inlineShortcut';

function selectedInlineText(state:Parameters<Command>[0],from:number,to:number,kind:string){
  const slice=state.doc.slice(from,to);
  const text=(node:import('@milkdown/kit/prose/model').Node):string=>{
    if(node.type.name==='resource_link')return withoutInlineFormat(node.textContent,kind);
    if(node.isText)return node.text||'';
    if(node.type.name==='hardbreak')return '\n';
    let value='';node.forEach(child=>value+=text(child));return value;
  };
  let value='';slice.content.forEach(node=>value+=text(node));
  return state.selection.$from.parent.type.name==='resource_link'?withoutInlineFormat(value,kind):value;
}
function delimiter(kind:string,raw:string){
  if(kind==='strong')return '**';
  if(kind==='emphasis')return raw.startsWith('_')?'_':'*';
  if(kind==='delete')return '~~';
  if(kind==='highlight')return '==';
  if(kind==='underline')return '__';
  if(kind==='inlineMath')return '$';
  const ticks=Math.max(0,...[...raw.matchAll(/`+/g)].map(m=>m[0].length));return '`'.repeat(ticks+1);
}
export function formatInline(kind:string,href=''):Command{return(state,dispatch)=>{
  if(dispatch){const send=dispatch;dispatch=tr=>send(closeHistory(tr));}
  const current=richFormatState(state,kind);
  if(current.active){if(dispatch)dispatch(current.remove()!);return true;}
  const {selection}=state,{$from,$to,to}=selection;
  let from=selection.from;
  if(!$from.sameParent($to)||!$from.parent.inlineContent){
    const ranges:{from:number;to:number}[]=[];
    let unsupported=false;
    state.doc.nodesBetween(from,to,(node,pos)=>{
      if(node.type.spec.code&&node.type.name!=='resource_link'){unsupported=true;return false;}
      if(node.isTextblock){
        const prefix=node.type.name==='heading'?node.textContent.match(/^#{1,6}[ \t]+/)?.[0].length||0:0;
        const start=Math.max(from,pos+1+prefix),end=Math.min(to,pos+node.nodeSize-1);
        if(end>start)ranges.push({from:start,to:end});
        return false;
      }
    });
    if(unsupported||!ranges.length)return false;
    if(!dispatch)return true;
    const tr=state.tr;
    const last=ranges.at(-1)!;
    let lastOffset=0;
    for(const range of ranges.reverse()){
      const text=selectedInlineText(state,range.from,range.to,kind),marker=delimiter(kind,text);
      const code=kind==='inlineCode'?inlineCodeSource(text):undefined;
      const raw=code?.raw??(kind==='link'?attachmentMarkdown({type:'link',url:href,children:[{type:'text',value:text}]}):marker+text+marker);
      if(range===last)lastOffset=code?.offset??(kind==='link'?raw.lastIndexOf('](')+2:marker.length+text.length);
      tr.replaceWith(range.from,range.to,state.schema.nodes.resource_link.create(null,state.schema.text(raw)));
    }
    const head=tr.mapping.map(last.from,-1)+1+lastOffset;
    dispatch(tr.setSelection(TextSelection.create(tr.doc,head)).scrollIntoView());return true;
  }
  if(!$from.sameParent($to)||$from.parent.type.spec.code&&$from.parent.type.name!=='resource_link')return false;
  if($from.parent.type.name==='heading'){
    const prefix=$from.parent.textContent.match(/^#{1,6}[ \t]+/)?.[0].length||0;
    from=Math.min(to,Math.max(from,$from.start()+prefix));
    if(selection.from!==selection.to&&from===to)return false;
  }
  const inSource=$from.parent.type.name==='resource_link';
  if(!dispatch)return true;
  const text=selectedInlineText(state,from,to,kind),marker=delimiter(kind,text),code=kind==='inlineCode'?inlineCodeSource(text):undefined,
    raw=code?.raw??(kind==='link'?attachmentMarkdown({type:'link',url:href,children:[{type:'text',value:text}]}):marker+text+marker);
  const tr=state.tr;
  const offset=code?.offset??(kind==='link'?raw.lastIndexOf('](')+2:marker.length+(text?text.length:0));
  if(inSource){tr.insertText(raw,from,to);const head=from+offset;dispatch?.(tr.setSelection(TextSelection.create(tr.doc,head)).scrollIntoView());}
  else {const node=state.schema.nodes.resource_link.create(null,state.schema.text(raw));tr.replaceWith(from,to,node);const head=from+1+offset;dispatch?.(tr.setSelection(TextSelection.create(tr.doc,head)).scrollIntoView());}
  return true;
};}

// Keep shortcuts and toolbar commands inserting editable Markdown.
export function installInlineCommands(ctx:Parameters<Parameters<Editor['action']>[0]>[0]){
  const manager=ctx.get(commandsCtx);
  for(const [plugin,kind] of [[toggleStrongCommand,'strong'],[toggleEmphasisCommand,'emphasis'],[toggleInlineCodeCommand,'inlineCode'],[toggleStrikethroughCommand,'delete']] as const)manager.create(plugin.key,()=>formatInline(kind));
  manager.create(toggleLinkCommand.key,payload=>formatInline('link',payload?.href||''));
  manager.create(toolbarLinkCommand.key,()=>formatInline('link'));
  manager.create(isMarkSelectedCommand.key,mark=>state=>{const names:Record<string,string>={strong:'strong',emphasis:'emphasis',inlineCode:'inlineCode',strike_through:'delete',link:'link'};return !!names[mark?.name||'']&&richFormatState(state,names[mark?.name||'']).active;});
}
export const inlineFormatting=$prose(()=>new Plugin({props:{handleDOMEvents:{keydown(view,event){
  if((event.target as Element)?.closest('.cm-editor'))return false;
  if(!event.ctrlKey&&!event.metaKey||!view.editable)return false;
  const action=inlineShortcut(event);
  if(event.isComposing)return !!action;
  if(event.key.toLowerCase()==='a'&&!event.shiftKey&&!event.altKey){
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    view.focus();event.preventDefault();return true;
  }
  const kind=action?inlineKinds[action]:undefined;
  if(kind)readNativeSelection(view);
  if(!kind||!formatInline(kind)(view.state,view.dispatch,view))return false;event.preventDefault();return true;
}}}}));
