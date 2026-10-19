import {$prose} from '@milkdown/kit/utils';
import {commandsCtx,type Editor} from '@milkdown/kit/core';
import {Plugin,TextSelection,type Command} from '@milkdown/kit/prose/state';
import {toggleStrongCommand,toggleEmphasisCommand,toggleInlineCodeCommand,toggleLinkCommand,isMarkSelectedCommand} from '@milkdown/kit/preset/commonmark';
import {toggleStrikethroughCommand} from '@milkdown/kit/preset/gfm';
import {parseInline} from '../inlineSyntax';
import {readNativeSelection} from './nativeSelection';
import {toggleLinkCommand as toolbarLinkCommand} from '@milkdown/kit/component/link-tooltip';
import {attachmentMarkdown} from '../attachmentLinks';

function delimiter(kind:string,raw:string){
  if(kind==='strong')return '**';
  if(kind==='emphasis')return raw.startsWith('_')?'_':'*';
  if(kind==='delete')return '~~';
  const ticks=Math.max(0,...[...raw.matchAll(/`+/g)].map(m=>m[0].length));return '`'.repeat(ticks+1);
}
export function formatInline(kind:string,href=''):Command{return(state,dispatch)=>{
  const {selection}=state,{$from,$to,from,to}=selection;
  if(!$from.sameParent($to)||$from.parent.type.spec.code&&$from.parent.type.name!=='resource_link')return false;
  const parent=$from.parent,inSource=parent.type.name==='resource_link',parsed=inSource?parseInline(parent.textContent):null;
  if(inSource&&parsed?.kind===kind&&kind!=='link'){
    const raw=parent.textContent,mark=kind==='inlineCode'?raw.match(/^`+/)?.[0]||'`':delimiter(kind,raw),inner=raw.slice(mark.length,-mark.length);
    const pos=$from.before(),decorated=parseInline(inner)?.decorated,replacement=inner?decorated?parent.type.create(null,state.schema.text(inner)):state.schema.text(inner):[],tr=state.tr.replaceWith(pos,pos+parent.nodeSize,replacement);dispatch?.(tr.setSelection(TextSelection.create(tr.doc,Math.min(pos+inner.length+(decorated?1:0),tr.doc.content.size))).scrollIntoView());return true;
  }
  const text=state.doc.textBetween(from,to),marker=delimiter(kind,text),raw=kind==='link'?attachmentMarkdown({type:'link',url:href,children:[{type:'text',value:text}]}):marker+text+marker;
  const tr=state.tr;
  const offset=kind==='link'?raw.lastIndexOf('](')+2:marker.length+(text?text.length:0);
  if(inSource){tr.insertText(raw,from,to);const head=from+offset;dispatch?.(tr.setSelection(TextSelection.create(tr.doc,head)).scrollIntoView());}
  else {const node=state.schema.nodes.resource_link.create(null,state.schema.text(raw));tr.replaceWith(from,to,node);const head=from+1+offset;dispatch?.(tr.setSelection(TextSelection.create(tr.doc,head)).scrollIntoView());}
  return true;
};}

// Reuse Milkdown's command keys, so its shortcuts, floating toolbar and our
// toolbar all insert editable Markdown rather than creating invisible marks.
export function installInlineCommands(ctx:Parameters<Parameters<Editor['action']>[0]>[0]){
  const manager=ctx.get(commandsCtx);
  for(const [plugin,kind] of [[toggleStrongCommand,'strong'],[toggleEmphasisCommand,'emphasis'],[toggleInlineCodeCommand,'inlineCode'],[toggleStrikethroughCommand,'delete']] as const)manager.create(plugin.key,()=>formatInline(kind));
  manager.create(toggleLinkCommand.key,payload=>formatInline('link',payload?.href||''));
  manager.create(toolbarLinkCommand.key,()=>formatInline('link'));
  manager.create(isMarkSelectedCommand.key,mark=>state=>{const names:Record<string,string>={strong:'strong',emphasis:'emphasis',inlineCode:'inlineCode',strike_through:'delete',link:'link'};const kind=parseInline(state.selection.$from.parent.textContent)?.kind;return state.selection.$from.parent.type.name==='resource_link'&&kind===names[mark?.name||''];});
}
export const inlineFormatting=$prose(()=>new Plugin({props:{handleDOMEvents:{keydown(view,event){
  if(!event.ctrlKey&&!event.metaKey||event.altKey||event.isComposing)return false;
  const kind=event.key.toLowerCase()==='b'?'strong':event.key.toLowerCase()==='i'?'emphasis':event.key==='`'?'inlineCode':undefined;
  if(kind)readNativeSelection(view);
  if(!kind||!formatInline(kind)(view.state,view.dispatch,view))return false;event.preventDefault();return true;
}}}}));
