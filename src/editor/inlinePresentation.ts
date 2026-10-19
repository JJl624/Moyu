import {$prose} from '@milkdown/kit/utils';
import {Plugin,type EditorState} from '@milkdown/kit/prose/state';
import {Decoration,DecorationSet} from '@milkdown/kit/prose/view';
import {parseInline,type InlineAst} from '../inlineSyntax';

function presentation(state:EditorState){
  const decorations:Decoration[]=[];
  state.doc.descendants((node,pos)=>{
    if(node.type.name!=='resource_link')return;
    const raw=node.textContent,parsed=parseInline(raw);if(!parsed)return false;
    const add=(from:number,to:number,kind:string)=>{if(to>from)decorations.push(Decoration.inline(pos+1+from,pos+1+to,{class:'moyu-source-'+kind}));};
    const walk=(ast:InlineAst)=>{
      const from=ast.position?.start.offset,to=ast.position?.end.offset;if(from===undefined||to===undefined)return;
      let bodyFrom=from,bodyTo=to;
      if(['strong','emphasis','delete','highlight','underline'].includes(ast.type)){bodyFrom=ast.children?.[0]?.position?.start.offset??from;bodyTo=ast.children?.at(-1)?.position?.end.offset??to;}
      else if(ast.type==='inlineCode'){const ticks=raw.slice(from,to).match(/^`+/)?.[0].length||1;bodyFrom=from+ticks;bodyTo=to-ticks;}
      else if(ast.type==='inlineMath'){bodyFrom=from+1;bodyTo=to-1;}
      else if(['link','image'].includes(ast.type)){bodyFrom=from+(ast.type==='image'?2:1);const close=raw.indexOf('](',bodyFrom);bodyTo=close<0?to:close;}
      if(bodyFrom>from||bodyTo<to){add(from,bodyFrom,'marker');add(bodyTo,to,'marker');add(bodyFrom,bodyTo,ast.type);}
      ast.children?.forEach(walk);
    };parsed.nodes.forEach(walk);return false;
  });return DecorationSet.create(state.doc,decorations);
}
export const inlinePresentation=$prose(()=>new Plugin<DecorationSet>({
  state:{init:(_config,state)=>presentation(state),apply:(tr,previous,_old,state)=>tr.docChanged?presentation(state):previous},
  props:{decorations(state){return this.getState(state);}},
}));
